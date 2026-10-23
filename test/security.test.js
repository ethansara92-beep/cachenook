'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { normalizeConfig } = require('../src/main/config');
const { HOME, isSafeProjectRoot } = require('../src/main/safety');

test('project roots must resolve inside the home folder', async () => {
  assert.equal(isSafeProjectRoot(path.join(HOME, 'Repositories')), true);
  assert.equal(isSafeProjectRoot(path.join(HOME, 'brand-new-folder')), true);
  assert.equal(isSafeProjectRoot(HOME), false);
  assert.equal(isSafeProjectRoot('/'), false);
  assert.equal(isSafeProjectRoot('/System'), false);
  assert.equal(isSafeProjectRoot('/etc'), false);
  assert.equal(isSafeProjectRoot('relative/path'), false);
  assert.equal(isSafeProjectRoot(path.join(HOME, 'Library')), false);
  assert.equal(isSafeProjectRoot(path.join(HOME, 'Library', 'Caches')), false);
  assert.equal(isSafeProjectRoot(path.join(HOME, 'Applications')), false);

  const link = path.join(HOME, `cachenook-security-link-${process.pid}`);
  await fs.rm(link, { force: true });
  await fs.symlink('/tmp', link);
  try {
    assert.equal(isSafeProjectRoot(link), false);
  } finally {
    await fs.rm(link, { force: true });
  }
});

test('config drops roots that escape the home folder', () => {
  const config = normalizeConfig({
    projectRoots: [
      '/',
      '/System',
      HOME,
      path.join(HOME, 'Library'),
      path.join(HOME, 'Repositories'),
      'relative',
      42,
      null,
    ],
    staleDays: 9_999,
  });

  assert.deepEqual(config.projectRoots, [path.join(HOME, 'Repositories')]);
  assert.equal(config.staleDays, 365);

  const ignored = normalizeConfig({
    projectRoots: [],
    autoCleanIgnore: ['/etc', 'relative', HOME, path.join(HOME, 'Repositories')],
  });
  assert.deepEqual(ignored.autoCleanIgnore, [path.join(HOME, 'Repositories')]);
});
