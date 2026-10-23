'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 256 * 1024;

/**
 * Run a command without a shell. Never rejects: callers inspect the exit code.
 */
function run(command, args = [], options = {}) {
  const { timeout = 60_000, env, track } = options;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: -1, signal: null, stdout: '', stderr: error.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      }, timeout);
    }

    if (typeof track === 'function') track(child);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_STDOUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({ code: -1, signal: null, stdout, stderr: error.message });
    });
    child.on('close', (code, signal) => {
      finish({ code, signal, stdout, stderr });
    });
  });
}

async function which(bin) {
  if (bin.includes('/')) {
    try {
      await fs.access(bin, fs.constants.X_OK);
      return bin;
    } catch {
      return null;
    }
  }
  const dirs = (process.env.PATH || '').split(':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function pathIsDirectory(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Allocated size of a directory in bytes, via du -skx. Returns 0 on failure. */
async function duBytes(target, track) {
  const result = await run('/usr/bin/du', ['-skx', target], {
    timeout: 0,
    track,
  });
  if (result.code !== 0) return 0;
  const kb = Number.parseInt(result.stdout.trim().split(/\s+/)[0], 10);
  return Number.isFinite(kb) && kb > 0 ? kb * 1024 : 0;
}

function rmrf(target) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/rm', ['-rf', target], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rm exited with code ${code}`));
    });
  });
}

/** Run tasks with a bounded concurrency. Preserves result order. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

module.exports = {
  duBytes,
  pathExists,
  pathIsDirectory,
  pool,
  rmrf,
  run,
  which,
};
