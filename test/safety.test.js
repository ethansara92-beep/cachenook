'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  HOME,
  assertInsideRoot,
  assertSafeCleanRoot,
  assertUserFile,
  isInside,
  isProtected,
  normalize,
} = require('../src/main/safety');

test('isInside respects path boundaries', () => {
  assert.equal(isInside('/Users/a/Library/Caches', '/Users/a'), true);
  assert.equal(isInside('/Users/a', '/Users/a'), true);
  assert.equal(isInside('/Users/ab/Caches', '/Users/a'), false);
  assert.equal(isInside('/Users/a', '/Users/a/Library'), false);
});

test('normalize rejects relative and empty paths', () => {
  assert.throws(() => normalize('Library/Caches'), /absolute/);
  assert.throws(() => normalize(''), /non-empty/);
  assert.throws(() => normalize('/tmp/../etc/passwd\0'), /null byte/);
});

test('protected paths are recognized', () => {
  assert.equal(isProtected('/System'), true);
  assert.equal(isProtected(HOME), true);
  assert.equal(isProtected(path.join(HOME, 'Library')), true);
  assert.equal(isProtected(path.join(HOME, 'Library', 'Caches')), false);
  assert.equal(isProtected(path.join(HOME, 'Library', 'Caches', 'CacheNook')), true);
  assert.equal(
    isProtected(path.join(HOME, 'Library', 'Application Support', 'MacSweep')),
    true,
  );
  assert.equal(isProtected('/etc/passwd'), false);
});

test('clean roots must be deep, private and inside the home folder', () => {
  assert.equal(
    assertSafeCleanRoot(path.join(HOME, 'Library', 'Caches')),
    path.join(HOME, 'Library', 'Caches'),
  );
  assert.equal(assertSafeCleanRoot(path.join(HOME, '.Trash')), path.join(HOME, '.Trash'));

  assert.throws(() => assertSafeCleanRoot(HOME), /protected/);
  assert.throws(() => assertSafeCleanRoot(path.join(HOME, 'Library')), /protected/);
  assert.throws(() => assertSafeCleanRoot(path.join(HOME, 'Downloads')), /protected/);
  assert.throws(() => assertSafeCleanRoot('/tmp'), /protected|outside/);
  assert.throws(() => assertSafeCleanRoot('/Users/other/Library/Caches'), /outside/);
  assert.throws(
    () => assertSafeCleanRoot(path.join(HOME, 'Library', 'Caches', 'CacheNook')),
    /protected/,
  );
});

test('child paths must stay inside their root', () => {
  const root = path.join(HOME, 'Library', 'Caches');
  assert.equal(assertInsideRoot(path.join(root, 'com.example.app'), root), path.join(root, 'com.example.app'));
  assert.throws(() => assertInsideRoot(root, root), /outside/);
  assert.throws(() => assertInsideRoot(path.join(HOME, 'Documents', 'a'), root), /outside/);
  assert.throws(() => assertInsideRoot(`${root}/../evil`, root), /outside/);
});

test('user files can be trashed but protected data cannot', () => {
  assert.equal(
    assertUserFile(path.join(HOME, 'Downloads', 'installer.dmg')),
    path.join(HOME, 'Downloads', 'installer.dmg'),
  );
  assert.throws(() => assertUserFile(HOME), /home directory/);
  assert.throws(() => assertUserFile('/etc/passwd'), /outside/);
  assert.throws(() => assertUserFile(path.join(HOME, 'Library')), /protected/);
  assert.throws(() => assertUserFile(path.join(HOME, '.ssh')), /protected/);
});
