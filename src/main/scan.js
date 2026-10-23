'use strict';

const fs = require('node:fs/promises');

const { duBytes, pathExists, pool, run } = require('./proc');
const { resolveRoots } = require('./targets');

const MOUNT = '/System/Volumes/Data';

function parseDf(stdout) {
  const lines = stdout.trim().split('\n');
  if (lines.length < 2) return null;
  const fields = lines[1].trim().split(/\s+/);
  if (fields.length < 4) return null;

  const total = Number(fields[1]) * 1024;
  const used = Number(fields[2]) * 1024;
  let available = null;
  for (const field of fields.slice(3)) {
    if (/^\d+$/.test(field)) {
      available = Number(field) * 1024;
      break;
    }
  }
  if (available === null) return null;
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;

  const accounted = used + available;
  return {
    total,
    used,
    available,
    capacity: accounted > 0 ? used / accounted : 0,
    mount: fields[fields.length - 1] || MOUNT,
  };
}

async function readDisk() {
  let result = await run('/bin/df', ['-kP', MOUNT], { timeout: 10_000 });
  if (result.code !== 0) {
    result = await run('/bin/df', ['-kP', '/'], { timeout: 10_000 });
  }
  if (result.code !== 0) return null;
  return parseDf(result.stdout);
}

async function inspectRoot(root, ctx) {
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  const bytes = await duBytes(root, ctx?.track);
  return { path: root, bytes };
}

async function measureDirectory(target, ctx) {
  const roots = await resolveRoots(target);
  const sizes = [];

  await pool(roots, 4, async (root) => {
    if (ctx?.cancelled) return;
    const size = await inspectRoot(root, ctx);
    if (size) sizes.push(size);
  });

  if (sizes.length === 0) {
    return { id: target.id, available: false, bytes: 0, note: 'Not found on this Mac', paths: [] };
  }

  sizes.sort((a, b) => b.bytes - a.bytes);
  const bytes = sizes.reduce((sum, item) => sum + item.bytes, 0);
  return {
    id: target.id,
    available: true,
    bytes,
    paths: sizes.map((item) => item.path),
    sizes,
  };
}

async function measureCommand(target, ctx) {
  let estimate;
  try {
    estimate = await target.estimate(ctx);
  } catch (error) {
    return { id: target.id, available: false, bytes: 0, note: error.message, paths: [] };
  }

  if (!estimate || estimate.available === false) {
    return {
      id: target.id,
      available: false,
      bytes: 0,
      note: estimate?.note || 'Not available',
      paths: [],
    };
  }

  return {
    id: target.id,
    available: true,
    bytes: Number.isFinite(estimate.bytes) ? estimate.bytes : 0,
    note: estimate.note || '',
    paths: [],
  };
}

async function measureTarget(target, ctx) {
  if (target.kind === 'command') return measureCommand(target, ctx);
  return measureDirectory(target, ctx);
}

async function measureAll(targets, ctx, onTarget) {
  const results = [];
  let completed = 0;

  await pool(targets, 3, async (target) => {
    if (ctx.cancelled) return;
    const result = await measureTarget(target, ctx);
    completed += 1;
    results.push(result);
    if (onTarget) onTarget(result, completed, targets.length);
  });

  return results;
}

module.exports = {
  measureAll,
  measureDirectory,
  measureTarget,
  parseDf,
  readDisk,
};
