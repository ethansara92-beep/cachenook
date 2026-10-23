'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { cleanDirectoryRoot } = require('../src/main/clean');

const HOME = os.homedir();
const CACHE_BASE = path.join(HOME, 'Library', 'Caches');

function tempRoot(label) {
  return path.join(CACHE_BASE, `cachenook-test-${label}-${process.pid}-${Date.now()}`);
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

test('cleaning a root removes its children but keeps the root', async () => {
  const root = tempRoot('children');
  await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(512 * 1024));
  await fs.writeFile(path.join(root, 'nested', 'b.bin'), Buffer.alloc(512 * 1024));

  try {
    const result = await cleanDirectoryRoot(root, { id: 'test', skipNames: [] }, null, 'test');
    assert.equal(result.removed, 2);
    assert.equal(result.errors.length, 0);
    assert.ok(result.before >= 1024 * 1024);
    assert.equal(result.after, 0);
    assert.deepEqual(await fs.readdir(root), []);
    assert.equal(await exists(root), true, 'the root directory survives');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('symlinked children are unlinked without deleting their target', async () => {
  const root = tempRoot('symlink');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cachenook-target-'));
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep me');

  await fs.mkdir(root, { recursive: true });
  await fs.symlink(outside, path.join(root, 'linked-folder'));

  try {
    const result = await cleanDirectoryRoot(root, { id: 'test', skipNames: [] }, null, 'test');
    assert.equal(result.errors.length, 0);
    assert.equal(await exists(path.join(outside, 'keep.txt')), true, 'target stays intact');
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('skipped names are preserved', async () => {
  const root = tempRoot('skip');
  await fs.mkdir(path.join(root, 'keep-me'), { recursive: true });
  await fs.writeFile(path.join(root, 'keep-me', 'data.bin'), Buffer.alloc(1024));
  await fs.writeFile(path.join(root, 'remove-me.bin'), Buffer.alloc(1024));

  try {
    const result = await cleanDirectoryRoot(
      root,
      { id: 'test', skipNames: ['keep-me'] },
      null,
      'test',
    );
    assert.equal(result.skipped, 1);
    assert.equal(result.removed, 1);
    assert.deepEqual(await fs.readdir(root), ['keep-me']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('paths outside the home directory are rejected', async () => {
  await assert.rejects(
    cleanDirectoryRoot('/private/tmp', { id: 'test' }, null, 'test'),
    /protected|outside/,
  );
});
