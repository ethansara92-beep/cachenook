'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { matchProfiles } = require('../src/main/personal');
const { parseSuggestions } = require('../src/main/ai');
const { normalizeConfig } = require('../src/main/config');

const HOME = os.homedir();
const DAY = 86_400_000;

function file(name, dir, bytes, ageDays) {
  return {
    path: path.join(HOME, dir, name),
    name,
    dir: path.join(HOME, dir),
    ext: path.extname(name).toLowerCase(),
    bytes,
    ageDays,
  };
}

test('profile matching is conservative and age aware', () => {
  assert.deepEqual(
    matchProfiles(file('Screenshot 2026-01-01 at 10.00.00.png', 'Desktop', 2_000_000, 30)),
    ['screenshots'],
  );
  assert.deepEqual(
    matchProfiles(file('Screenshot now.png', 'Desktop', 2_000_000, 2)),
    [],
  );
  assert.deepEqual(
    matchProfiles(file('Tool-1.0.dmg', 'Downloads', 80_000_000, 31)),
    ['installers'],
  );
  assert.deepEqual(
    matchProfiles(file('Tool-1.0.dmg', 'Downloads', 80_000_000, 2)),
    [],
  );
  assert.deepEqual(
    matchProfiles(file('backup.zip', 'Documents', 20_000_000, 91)),
    ['archives'],
  );
  assert.deepEqual(
    matchProfiles(file('file.crdownload', 'Downloads', 1_000_000, 0)),
    ['temp'],
  );
  assert.deepEqual(
    matchProfiles(file('old-notes.pdf', 'Downloads', 20_000_000, 91)),
    ['stale-downloads'],
  );
  assert.deepEqual(
    matchProfiles(file('huge.mov', 'Documents', 600_000_000, 181)),
    ['large-old'],
  );
});

test('AI suggestions are validated against the batch', () => {
  const text = JSON.stringify({
    suggestions: [
      { id: 0, action: 'trash', reason: 'old installer' },
      { id: 1, action: 'keep', reason: 'current work' },
      { id: 2, action: 'delete-everything', reason: 'bad' },
      { id: 99, action: 'trash', reason: 'out of range' },
    ],
  });

  assert.deepEqual(parseSuggestions(text, 2), [
    { id: 0, action: 'trash', reason: 'old installer' },
    { id: 1, action: 'keep', reason: 'current work' },
  ]);
  assert.deepEqual(parseSuggestions('not json', 2), []);
  assert.deepEqual(
    parseSuggestions('```json\n{"suggestions":[{"id":0,"action":"review","reason":"maybe"}]}\n```', 1),
    [{ id: 0, action: 'review', reason: 'maybe' }],
  );
});


test('personal exclusions and AI settings are normalized', () => {
  const keep = path.join(HOME, 'Desktop', 'keep-this.png');
  const config = normalizeConfig({
    personalExclude: [
      keep,
      keep,
      'relative/path',
      '/tmp/outside',
      path.join(HOME, 'Library', 'keep-me'),
    ],
    aiEndpoint: 'http://127.0.0.1:11434/v1',
    aiModel: '  llama3.2  ',
  });

  assert.deepEqual(config.personalExclude, [keep]);
  assert.equal(config.aiEndpoint, 'http://127.0.0.1:11434/v1');
  assert.equal(config.aiModel, 'llama3.2');

  const invalid = normalizeConfig({
    aiEndpoint: 'file:///etc/passwd',
    aiModel: 'x'.repeat(200),
  });
  assert.equal(invalid.aiEndpoint, '');
  assert.equal(invalid.aiModel.length, 100);
});
