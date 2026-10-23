'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { normalizeConfig } = require('../src/main/config');
const { compareVersions } = require('../src/main/update');

const HOME = os.homedir();

test('version comparison handles numeric segments', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('v1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 0);
});

test('config keeps language, update URL and exclusions in shape', () => {
  const config = normalizeConfig({
    projectRoots: [path.join(HOME, 'Repositories'), '/System'],
    language: 'vi',
    updateUrl: 'https://example.com/cachenook.json',
    autoCleanIgnore: [path.join(HOME, 'Repositories', 'keep-me'), '/etc'],
  });

  assert.deepEqual(config.projectRoots, [path.join(HOME, 'Repositories')]);
  assert.equal(config.language, 'vi');
  assert.equal(config.updateUrl, 'https://example.com/cachenook.json');
  assert.deepEqual(config.autoCleanIgnore, [path.join(HOME, 'Repositories', 'keep-me')]);

  const invalid = normalizeConfig({ language: 'fr', updateUrl: 'file:///tmp/x' });
  assert.equal(invalid.language, 'en');
  assert.equal(invalid.updateUrl, '');
});
