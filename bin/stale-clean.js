#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createStore,
  MAX_STALE_DAYS,
  MIN_STALE_DAYS,
} = require('../src/main/config');
const history = require('../src/main/history');
const { discoverArtifacts } = require('../src/main/projects');
const { duBytes, pool, rmrf, run } = require('../src/main/proc');
const {
  HOME,
  isBundlePath,
  isInside,
  isProtected,
  isSafeProjectRoot,
} = require('../src/main/safety');

// Only clearly regenerable build folders. dist/build/out are deliverables and
// are never touched by the scheduled job.
const AUTO_ARTIFACTS = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.expo',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'target',
  '.dart_tool',
  '.gradle',
  '.terraform',
  '.angular',
  '.nx',
  '.vite',
  '.nyc_output',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  'coverage',
  '.build',
  'DerivedData',
  '.swiftpm',
]);

const CONFIG_DIR = path.join(HOME, 'Library', 'Application Support', 'CacheNook');
const RESULT_FILE = path.join(CONFIG_DIR, 'last-stale-clean.json');
const APP_DIR = path.resolve(__dirname, '..');
const DAY = 86_400_000;
const MIN_AUTO_BYTES = 1_000_000;
const GIT = '/usr/bin/git';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  const value = n / 1000 ** index;
  const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 1 ? (index >= 3 ? 1 : 0) : 2;
  return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[index]}`;
}

function parseArgs(argv) {
  const options = { apply: false, json: false, days: null, roots: [], help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--days') {
      index += 1;
      options.days = Number(argv[index]);
    } else if (arg === '--root') {
      index += 1;
      options.roots.push(argv[index]);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node bin/stale-clean.js [options]',
    '',
    '  --apply        delete stale folders (default: preview only)',
    '  --days N       override the configured inactivity window',
    '  --root PATH    override the configured project roots (repeatable)',
    '  --json         print a JSON summary',
    '  --help         show this help',
  ].join('\n');
}

async function hasRecentFile(dir, days, pruneNames = []) {
  const args = [dir, '-xdev'];

  if (pruneNames.length > 0) {
    args.push('(');
    pruneNames.forEach((name, index) => {
      if (index > 0) args.push('-o');
      args.push('-name', name);
    });
    args.push(')', '-prune', '-o');
  }

  args.push('-type', 'f', '-mtime', `-${days}`, '-print', '-quit');

  const result = await run('/usr/bin/find', args, { timeout: 180_000 });
  if (result.code !== 0 && !result.stdout) return true;
  return result.stdout.trim().length > 0;
}

async function repoGuard(repoPath, ignores, cache) {
  if (cache.has(repoPath)) return cache.get(repoPath);

  let reason = null;
  const realRepo = await fsp.realpath(repoPath).catch(() => repoPath);

  for (const ignore of ignores) {
    const realIgnore = await fsp.realpath(ignore).catch(() => ignore);
    if (isInside(realRepo, realIgnore) || isInside(realIgnore, realRepo)) {
      reason = 'ignored';
      break;
    }
  }

  if (!reason) {
    for (const ignoreName of ['.cachenookignore', '.macsweepignore']) {
      try {
        await fsp.access(path.join(realRepo, ignoreName));
        reason = 'ignored';
        break;
      } catch {
        // try the next legacy name
      }
    }
  }

  if (!reason && fs.existsSync(GIT)) {
    const git = await run(GIT, ['-C', realRepo, 'status', '--porcelain'], {
      timeout: 20_000,
    });
    if (git.code === 0 && git.stdout.trim()) {
      reason = 'dirty';
    } else if (git.code !== 0 && fs.existsSync(path.join(realRepo, '.git'))) {
      // If git cannot read a repo, err on the safe side.
      reason = 'dirty';
    }
  }

  cache.set(repoPath, reason);
  return reason;
}

async function measureStale(candidate, days, repoPrunes, activityCache, guardCache, ignores) {
  const guard = await repoGuard(candidate.repoPath, ignores, guardCache);
  if (guard) return { ...candidate, active: true, skipReason: guard };

  const artifactActive = await hasRecentFile(candidate.path, days);

  let repoActive = activityCache.get(candidate.repoPath);
  if (repoActive === undefined) {
    repoActive = await hasRecentFile(candidate.repoPath, days, repoPrunes);
    activityCache.set(candidate.repoPath, repoActive);
  }

  if (artifactActive || repoActive) return { ...candidate, active: true };

  const bytes = await duBytes(candidate.path);
  const stat = await fsp.stat(candidate.path).catch(() => null);
  const dirDays = stat ? Math.floor((Date.now() - stat.mtimeMs) / DAY) : null;

  return { ...candidate, active: false, bytes, dirDays };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const store = createStore(CONFIG_DIR);
  const config = store.load();

  let days = Number.isFinite(options.days) ? options.days : config.staleDays;
  if (!Number.isFinite(days)) days = 30;
  days = Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, Math.round(days)));

  const requestedRoots = options.roots.length > 0 ? options.roots : config.projectRoots;
  const roots = requestedRoots
    .filter((root) => typeof root === 'string' && path.isAbsolute(root))
    .map((root) => path.normalize(root))
    .filter(isSafeProjectRoot)
    .filter((root) => fs.existsSync(root));

  const startedAt = new Date();
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    dryRun: !options.apply,
    days,
    roots,
    candidates: 0,
    stale: 0,
    removed: [],
    errors: [],
    totalFreed: 0,
    skippedActive: 0,
    skippedSmall: 0,
    skippedDirty: 0,
    skippedIgnored: 0,
  };

  if (roots.length === 0) {
    summary.finishedAt = new Date().toISOString();
    await writeResult(summary);
    console.log('No readable project folders configured.');
    return;
  }

  const found = await discoverArtifacts(roots, { cancelled: false, track() {} });
  const seen = new Set();
  const candidates = found.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);

    return (
      AUTO_ARTIFACTS.has(item.artifact) &&
      !isProtected(item.path) &&
      !isBundlePath(item.path) &&
      !isInside(item.path, APP_DIR) &&
      roots.some((root) => isInside(item.path, root))
    );
  });

  summary.candidates = candidates.length;

  const repoPrunes = [
    ...new Set(require('../src/main/projects').ARTIFACTS.map((artifact) => artifact.name)),
    '.git',
  ];
  const activityCache = new Map();
  const guardCache = new Map();
  const ignores = Array.isArray(config.autoCleanIgnore) ? config.autoCleanIgnore : [];
  const measured = await pool(candidates, 4, async (candidate) => {
    try {
      return await measureStale(
        candidate,
        days,
        repoPrunes,
        activityCache,
        guardCache,
        ignores,
      );
    } catch (error) {
      summary.errors.push({ path: candidate.path, message: error.message });
      return null;
    }
  });

  const staleCandidates = measured.filter((item) => item && !item.active);
  const stale = staleCandidates
    .filter((item) => item.bytes >= MIN_AUTO_BYTES)
    .sort((a, b) => b.bytes - a.bytes);

  summary.skippedActive = measured.filter((item) => item && item.active).length;
  summary.skippedDirty = measured.filter((item) => item?.skipReason === 'dirty').length;
  summary.skippedIgnored = measured.filter((item) => item?.skipReason === 'ignored').length;
  summary.skippedSmall = staleCandidates.length - stale.length;
  summary.stale = stale.length;

  if (!options.apply) {
    for (const item of stale) {
      summary.removed.push({
        path: item.path,
        repo: item.repo,
        artifact: item.artifact,
        bytes: item.bytes,
        dirDays: item.dirDays,
      });
      summary.totalFreed += item.bytes;
    }
  } else {
    for (const item of stale) {
      try {
        const stat = await fsp.lstat(item.path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error('Not a directory');
        }

        const realRoot = await fsp.realpath(item.root);
        const realTarget = await fsp.realpath(item.path);
        if (realTarget === realRoot || !isInside(realTarget, realRoot)) {
          throw new Error('Path escapes the project folder');
        }
        if (!isInside(realTarget, HOME) || isProtected(realTarget) || isBundlePath(realTarget)) {
          throw new Error('Refusing to delete outside the home folder');
        }
        if (path.basename(realTarget) !== item.artifact) {
          throw new Error('Resolved path is not the expected artifact');
        }

        const bytes = item.bytes || (await duBytes(realTarget));
        await rmrf(realTarget);
        summary.removed.push({
          path: item.path,
          repo: item.repo,
          artifact: item.artifact,
          bytes,
          dirDays: item.dirDays,
        });
        summary.totalFreed += bytes;
      } catch (error) {
        summary.errors.push({ path: item.path, message: error.message });
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  if (options.apply) {
    await writeResult(summary);
    if (summary.totalFreed > 0 || summary.removed.length > 0) {
      await history.append(CONFIG_DIR, {
        freed: summary.totalFreed,
        items: summary.removed.length,
        source: 'scheduled',
      });
    }
  }

  if (options.apply && summary.totalFreed > 0) {
    const vi = config.language === 'vi';
    const message = vi
      ? `Đã giải phóng ${formatBytes(summary.totalFreed)} từ ${summary.removed.length} thư mục`
      : `Freed ${formatBytes(summary.totalFreed)} from ${summary.removed.length} folder${
          summary.removed.length === 1 ? '' : 's'
        }`;
    const subtitle = vi ? 'Dọn dẹp tự động' : 'Scheduled cleanup';
    await run(
      '/usr/bin/osascript',
      [
        '-e',
        `display notification ${JSON.stringify(message)} with title "CacheNook" subtitle ${JSON.stringify(
          subtitle,
        )}`,
      ],
      { timeout: 10_000 },
    );
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary, options.apply);
  }

  for (const error of summary.errors) {
    console.error(`error: ${error.path}: ${error.message}`);
  }
}

async function writeResult(summary) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = `${RESULT_FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, RESULT_FILE);
}

function printSummary(summary, applied) {
  console.log(`CacheNook scheduled cleanup · ${new Date(summary.startedAt).toLocaleString()}`);
  console.log(`Roots: ${summary.roots.join(', ')}`);
  console.log(`Inactive for ${summary.days}+ days`);
  console.log(
    `Eligible folders: ${summary.candidates} · active ${summary.skippedActive} · dirty ${summary.skippedDirty} · excluded ${summary.skippedIgnored} · tiny ${summary.skippedSmall}`,
  );
  console.log('');

  if (summary.removed.length === 0) {
    console.log('Nothing to remove. Active projects and small folders are left alone.');
  } else {
    console.log(applied ? 'Removed:' : 'Would remove:');
    for (const item of summary.removed) {
      console.log(`  ${formatBytes(item.bytes).padStart(8)}  ${item.path}`);
    }
    console.log('');
    console.log(`${applied ? 'Freed' : 'Would free'}: ${formatBytes(summary.totalFreed)}`);
  }

  if (summary.errors.length > 0) {
    console.log(`Errors: ${summary.errors.length}`);
  }
  if (!applied) {
    console.log('Preview only. Pass --apply to delete.');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
