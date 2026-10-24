'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { app, ipcMain, shell } = require('electron');

const { createCancellation } = require('./cancel');
const ai = require('./ai');
const { createStore } = require('./config');
const deep = require('./deep');
const { cleanTargets } = require('./clean');
const { hasFullDiskAccess } = require('./fda');
const history = require('./history');
const personal = require('./personal');
const { scanLargeFiles } = require('./files');
const { ARTIFACTS, scanProjects } = require('./projects');
const { duBytes, rmrf } = require('./proc');
const {
  assertUserFile,
  HOME,
  isBundlePath,
  isInside,
  isProtected,
  isSafeProjectRoot,
} = require('./safety');
const { measureAll, readDisk } = require('./scan');
const scheduler = require('./scheduler');
const update = require('./update');
const { describeTargets, getTarget, TARGETS } = require('./targets');

function asStringArray(value, max) {
  if (!Array.isArray(value)) throw new Error('Expected a list of paths');
  const strings = value.filter((item) => typeof item === 'string');
  return strings.slice(0, max);
}

function registerIpc({ getWindow, onLanguageChange }) {
  const store = createStore(app.getPath('userData'));
  let scanCtx = null;
  let projectCtx = null;
  let filesCtx = null;
  let personalCtx = null;
  let cleaning = false;

  app.on('before-quit', () => {
    if (scanCtx) scanCtx.cancel();
    if (projectCtx) projectCtx.cancel();
    if (filesCtx) filesCtx.cancel();
    if (personalCtx) personalCtx.cancel();
  });

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle('app:state', async () => {
    const userData = app.getPath('userData');
    const historyEntries = await history.read(userData);

    return {
      targets: describeTargets(),
      disk: await readDisk(),
      config: store.load(),
      configPath: store.file,
      home: HOME,
      version: app.getVersion(),
      platform: process.platform,
      fullDiskAccess: await hasFullDiskAccess(),
      staleJob: await scheduler.getStatus(),
      history: historyEntries.slice(-8).reverse(),
      historySummary: history.summarize(historyEntries),
      deep: await deep.getStatus(),
      loginItem: app.getLoginItemSettings().openAtLogin,
    };
  });

  ipcMain.handle('schedule:set', async (_event, options) => {
    if (!options || typeof options !== 'object') throw new Error('Invalid schedule');
    if (options.enabled) return scheduler.install(options);
    return scheduler.uninstall();
  });

  ipcMain.handle('schedule:run', async (_event, apply) => {
    const summary = await scheduler.runNow(Boolean(apply));
    return { summary, status: await scheduler.getStatus() };
  });

  ipcMain.handle('schedule:show-log', () => scheduler.openLog());

  ipcMain.handle('update:check', (_event, url) =>
    update.check(typeof url === 'string' && url.trim() ? url.trim() : store.load().updateUrl),
  );
  ipcMain.handle('update:open', (_event, url) => update.open(url));
  ipcMain.handle('app:set-login', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('deep:delete-snapshots', () => deep.deleteSnapshots());
  ipcMain.handle('deep:scan-installers', () => deep.scanInstallers());
  ipcMain.handle('deep:open-trash', () => deep.openTrash());

  ipcMain.handle('app:open-fda', async () => {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
    return true;
  });

  ipcMain.handle('scan:start', async () => {
    if (scanCtx) throw new Error('A scan is already running');
    scanCtx = createCancellation();
    const ctx = scanCtx;
    const fullDiskAccess = await hasFullDiskAccess();
    const targets = TARGETS.filter((target) => fullDiskAccess || !target.protected);
    send('scan:event', { type: 'start', total: targets.length, fullDiskAccess });

    try {
      const results = await measureAll(targets, ctx, (result, completed, total) => {
        send('scan:event', { type: 'target', result, completed, total });
      });
      send('scan:event', {
        type: 'done',
        cancelled: ctx.cancelled,
        disk: await readDisk(),
        fullDiskAccess,
      });
      return { results, cancelled: ctx.cancelled, disk: await readDisk(), fullDiskAccess };
    } finally {
      if (scanCtx === ctx) scanCtx = null;
    }
  });

  ipcMain.handle('scan:cancel', () => {
    if (scanCtx) scanCtx.cancel();
    return true;
  });

  ipcMain.handle('clean:run', async (_event, ids) => {
    if (cleaning) throw new Error('A cleanup is already running');
    const requested = asStringArray(ids, 40);
    const valid = requested.filter((id, index) => getTarget(id) && requested.indexOf(id) === index);
    if (valid.length === 0) throw new Error('No valid cleanup targets selected');

    cleaning = true;
    try {
      const fullDiskAccess = await hasFullDiskAccess();
      const allowed = valid.filter((id) => fullDiskAccess || !getTarget(id).protected);
      const blocked = valid.filter((id) => !allowed.includes(id));

      send('clean:event', { type: 'start', ids: [...allowed, ...blocked] });
      const results = allowed.length
        ? await cleanTargets(allowed, (payload) => send('clean:event', payload))
        : [];

      for (const id of blocked) {
        const result = {
          id,
          freed: 0,
          removed: 0,
          skipped: 0,
          errors: [{ path: '', message: 'Full Disk Access is required for this location' }],
          errorCount: 1,
          note: 'Requires Full Disk Access',
        };
        results.push(result);
        send('clean:event', { type: 'done', ...result });
      }

      const freed = results.reduce((sum, item) => sum + (item.freed || 0), 0);
      const items = results.reduce((sum, item) => sum + (item.removed || 0), 0);
      if (freed > 0 || items > 0) {
        await history.append(app.getPath('userData'), { freed, items, source: 'manual' });
      }
      const disk = await readDisk();
      send('clean:event', { type: 'finished', freed, results, disk });
      return { freed, results, disk };
    } finally {
      cleaning = false;
    }
  });

  ipcMain.handle('projects:scan', async () => {
    if (projectCtx) throw new Error('A project scan is already running');
    projectCtx = createCancellation();
    const ctx = projectCtx;
    const config = store.load();
    const roots = config.projectRoots.filter(isSafeProjectRoot);
    send('projects:event', { type: 'start', roots });

    try {
      const result = await scanProjects({
        roots,
        ctx,
        onProgress: (payload) => send('projects:event', { type: 'progress', ...payload }),
      });

      // Never offer to delete the running app's own dependencies.
      const appRoot = app.getAppPath();
      const items = result.items.filter((item) => !isInside(item.path, appRoot));
      const filtered = {
        ...result,
        items,
        found: items.length,
        totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
      };

      send('projects:event', { type: 'done', ...filtered, cancelled: ctx.cancelled });
      return { ...filtered, cancelled: ctx.cancelled };
    } finally {
      if (projectCtx === ctx) projectCtx = null;
    }
  });

  ipcMain.handle('projects:cancel', () => {
    if (projectCtx) projectCtx.cancel();
    return true;
  });

  ipcMain.handle('files:scan', async () => {
    if (filesCtx) throw new Error('A file scan is already running');
    filesCtx = createCancellation();
    const ctx = filesCtx;
    const config = store.load();
    const fullDiskAccess = await hasFullDiskAccess();
    const exclusions = fullDiskAccess
      ? []
      : ['Desktop', 'Documents', 'Downloads'].map((name) => path.join(HOME, name));
    send('files:event', { type: 'start', minMB: config.largeFileMinMB, fullDiskAccess });

    try {
      const result = await scanLargeFiles({
        roots: [HOME],
        minMB: config.largeFileMinMB,
        ctx,
        exclusions,
      });
      send('files:event', {
        type: 'done',
        ...result,
        cancelled: ctx.cancelled,
        fullDiskAccess,
        exclusions,
      });
      return { ...result, cancelled: ctx.cancelled, fullDiskAccess, exclusions };
    } finally {
      if (filesCtx === ctx) filesCtx = null;
    }
  });

  ipcMain.handle('files:cancel', () => {
    if (filesCtx) filesCtx.cancel();
    return true;
  });

  ipcMain.handle('personal:scan', async () => {
    if (personalCtx) throw new Error('A personal file scan is already running');
    const fullDiskAccess = await hasFullDiskAccess();
    if (!fullDiskAccess) return { available: false, reason: 'fda' };

    personalCtx = createCancellation();
    const ctx = personalCtx;
    try {
      return await personal.scanPersonal({
        exclude: store.load().personalExclude,
        ctx,
      });
    } finally {
      if (personalCtx === ctx) personalCtx = null;
    }
  });

  ipcMain.handle('personal:cancel', () => {
    if (personalCtx) personalCtx.cancel();
    return true;
  });

  ipcMain.handle('personal:trash', async (_event, paths) => {
    const requested = asStringArray(paths, 500);
    const results = [];
    let freed = 0;
    let removed = 0;

    for (const input of requested) {
      try {
        const target = await personal.assertPersonalFile(input);
        const stat = await fs.stat(target);
        await shell.trashItem(target);
        freed += stat.size;
        removed += 1;
        results.push({ path: target, ok: true, bytes: stat.size });
      } catch (error) {
        results.push({ path: input, ok: false, error: error.message });
      }
    }

    if (removed > 0) {
      await history.append(app.getPath('userData'), {
        freed,
        items: removed,
        source: 'personal',
      });
    }

    return { results, freed, removed };
  });

  ipcMain.handle('personal:classify', async (_event, files) => {
    if (!Array.isArray(files)) throw new Error('Expected a list of files');
    const safe = files.slice(0, 200).filter(
      (file) =>
        file &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        typeof file.name === 'string' &&
        Number.isFinite(Number(file.bytes)) &&
        personal.ROOTS.some((root) => isInside(file.path, root)),
    );
    return ai.classify(safe, store.load());
  });

  ipcMain.handle('projects:clean', async (_event, paths) => {
    const requested = asStringArray(paths, 100);
    const roots = store.load().projectRoots.filter(isSafeProjectRoot);
    const appRoot = await fs.realpath(app.getAppPath()).catch(() => app.getAppPath());
    const results = [];

    for (const input of requested) {
      try {
        const target = path.resolve(input);
        if (isProtected(target)) throw new Error('Refusing to touch a protected path');
        if (isBundlePath(target)) throw new Error('Refusing to touch a bundle');

        const root = roots.find((candidate) => isInside(target, candidate));
        if (!root || target === root) {
          throw new Error('Outside the configured project folders');
        }
        if (!ARTIFACTS.some((artifact) => artifact.name === path.basename(target))) {
          throw new Error('Not a build artifact');
        }

        const stat = await fs.lstat(target);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error('Not a build artifact folder');
        }

        // Resolve symlinks before deleting. This blocks a path like
        // ~/Repositories/link-to-system/node_modules from escaping the root.
        const realRoot = await fs.realpath(root);
        const realTarget = await fs.realpath(target);
        if (realTarget === realRoot || !isInside(realTarget, realRoot)) {
          throw new Error('Path escapes the project folder');
        }
        if (!isInside(realTarget, HOME) || isProtected(realTarget) || isBundlePath(realTarget)) {
          throw new Error('Refusing to delete outside the home folder');
        }
        if (!ARTIFACTS.some((artifact) => artifact.name === path.basename(realTarget))) {
          throw new Error('Resolved path is not a build artifact');
        }
        if (isInside(realTarget, appRoot)) {
          throw new Error("Refusing to delete the running app's dependencies");
        }

        const before = await duBytes(realTarget);
        await rmrf(realTarget);
        results.push({ path: target, ok: true, freed: before });
      } catch (error) {
        results.push({ path: input, ok: false, error: error.message });
      }
    }

    return results;
  });

  ipcMain.handle('files:trash', async (_event, paths) => {
    const requested = asStringArray(paths, 100);
    const results = [];

    for (const input of requested) {
      try {
        const target = assertUserFile(input);
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) {
          throw new Error('Symlinks are not supported here');
        }
        if (stat.isDirectory()) {
          throw new Error('Folders are not supported here. Use Finder instead.');
        }

        const real = await fs.realpath(target);
        if (!isInside(real, HOME) || isProtected(real) || isBundlePath(real)) {
          throw new Error('Refusing to move a path outside the home folder');
        }

        await shell.trashItem(real);
        results.push({ path: target, ok: true });
      } catch (error) {
        results.push({ path: input, ok: false, error: error.message });
      }
    }

    return results;
  });

  ipcMain.handle('shell:reveal', async (_event, input) => {
    if (typeof input !== 'string' || !path.isAbsolute(input)) {
      throw new Error('Expected an absolute path');
    }

    const target = path.normalize(input);
    await fs.access(target);
    const real = await fs.realpath(target);
    if (!isInside(real, HOME) || isProtected(real) || isBundlePath(real)) {
      throw new Error('Refusing to reveal a protected path');
    }

    shell.showItemInFolder(real);
    return true;
  });

  ipcMain.handle('config:get', () => store.load());

  ipcMain.handle('config:set', (_event, input) => {
    const config = store.save(input);
    if (onLanguageChange) onLanguageChange(config.language);
    return config;
  });
}

module.exports = { registerIpc };
