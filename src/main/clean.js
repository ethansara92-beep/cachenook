'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { duBytes, pathExists, rmrf } = require('./proc');
const { assertInsideRoot, assertSafeCleanRoot, isProtected } = require('./safety');
const { measureTarget } = require('./scan');
const { getTarget, resolveRoots } = require('./targets');

async function cleanDirectoryRoot(root, target, emit, id) {
  const safeRoot = assertSafeCleanRoot(root);
  const stat = await fs.lstat(safeRoot).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    return { before: 0, after: 0, removed: 0, skipped: 0, errors: [] };
  }

  const before = await duBytes(safeRoot);
  const entries = await fs.readdir(safeRoot, { withFileTypes: true }).catch(() => []);
  const skipNames = new Set(target.skipNames || []);
  const errors = [];
  let removed = 0;
  let skipped = 0;
  let lastEmit = 0;

  for (const entry of entries) {
    const child = assertInsideRoot(path.join(safeRoot, entry.name), safeRoot);

    if (skipNames.has(entry.name) || isProtected(child)) {
      skipped += 1;
      continue;
    }

    try {
      await rmrf(child);
      removed += 1;
    } catch (error) {
      errors.push({ path: child, message: error.message });
    }

    const now = Date.now();
    if (emit && now - lastEmit > 200) {
      lastEmit = now;
      emit({ type: 'clean:progress', id, removed, current: entry.name });
    }
  }

  const after = await duBytes(safeRoot);
  return { before, after, removed, skipped, errors };
}

async function cleanDirectoryTarget(target, emit) {
  const roots = await resolveRoots(target);
  const errors = [];
  let freed = 0;
  let removed = 0;
  let skipped = 0;
  let found = 0;

  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    found += 1;
    try {
      const result = await cleanDirectoryRoot(root, target, emit, target.id);
      freed += Math.max(0, result.before - result.after);
      removed += result.removed;
      skipped += result.skipped;
      errors.push(...result.errors);
    } catch (error) {
      errors.push({ path: root, message: error.message });
    }
  }

  if (found === 0) {
    errors.push({ path: '', message: 'Nothing to clean, the path no longer exists' });
  }

  return {
    id: target.id,
    freed,
    removed,
    skipped,
    errors: errors.slice(0, 30),
    errorCount: errors.length,
    note: removed > 0 ? `Removed ${removed} item${removed === 1 ? '' : 's'}` : 'Nothing to remove',
  };
}

async function cleanCommandTarget(target, estimate, emit) {
  const result = await target.clean({ emit });
  const freed = Number.isFinite(result?.freed) ? result.freed : estimate.bytes;
  return {
    id: target.id,
    freed: Number.isFinite(freed) ? freed : 0,
    removed: 0,
    skipped: 0,
    errors: [],
    errorCount: 0,
    note: result?.note || 'Done',
  };
}

/**
 * Clean targets sequentially. Each target is measured again before and after
 * so the freed number reflects what actually left the disk.
 */
async function cleanTargets(ids, emit) {
  const results = [];

  for (const id of ids) {
    const target = getTarget(id);
    if (!target) {
      results.push({ id, freed: 0, errors: [{ path: '', message: 'Unknown target' }], errorCount: 1 });
      continue;
    }

    if (emit) emit({ type: 'clean:start', id, name: target.name });

    let estimate = { bytes: 0 };
    try {
      estimate = await measureTarget(target);
    } catch {
      // keep zero estimate
    }

    let outcome;
    try {
      if (target.kind === 'command') {
        outcome = await cleanCommandTarget(target, estimate, emit);
      } else {
        outcome = await cleanDirectoryTarget(target, emit);
      }
    } catch (error) {
      outcome = {
        id: target.id,
        freed: 0,
        removed: 0,
        skipped: 0,
        errors: [{ path: '', message: error.message }],
        errorCount: 1,
        note: 'Failed',
      };
    }

    results.push(outcome);
    if (emit) emit({ type: 'clean:done', ...outcome });
  }

  return results;
}

module.exports = { cleanDirectoryRoot, cleanTargets };
