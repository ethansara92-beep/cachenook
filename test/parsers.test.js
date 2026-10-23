'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const HOME = os.homedir();

const { parseHumanBytes } = require('../src/main/commands');
const { buildArgs, parseStatLines } = require('../src/main/files');
const { parseDf } = require('../src/main/scan');
const { normalizeConfig } = require('../src/main/config');

test('parseHumanBytes understands the units used by brew and docker', () => {
  assert.equal(parseHumanBytes('2.7GB'), 2_700_000_000);
  assert.equal(parseHumanBytes('34.6MB'), 34_600_000);
  assert.equal(parseHumanBytes('512B'), 512);
  assert.equal(parseHumanBytes('1.2 kB'), 1_200);
  assert.equal(parseHumanBytes('0B'), 0);
  assert.equal(parseHumanBytes('not a size'), 0);
  assert.equal(parseHumanBytes(null), 0);
});

test('parseDf reads macOS df -kP output', () => {
  const output = [
    'Filesystem   1024-blocks      Used Available Capacity  Mounted on',
    '/dev/disk3s5   239362496 138249796  67905556    68%    /System/Volumes/Data',
  ].join('\n');

  const disk = parseDf(output);
  assert.ok(disk);
  assert.equal(disk.total, 239_362_496 * 1024);
  assert.equal(disk.used, 138_249_796 * 1024);
  assert.equal(disk.available, 67_905_556 * 1024);
  assert.equal(disk.mount, '/System/Volumes/Data');
  assert.ok(disk.capacity > 0.6 && disk.capacity < 0.8);
});

test('parseDf returns null for malformed output', () => {
  assert.equal(parseDf(''), null);
  assert.equal(parseDf('Filesystem 1K-blocks Used Available\n/dev/x'), null);
});

test('parseStatLines handles spaces and pipes in file names', () => {
  const output = [
    '900000000|1700000000|/Users/example/Movies/Big Clip 1.mkv',
    '250000000|1690000000|/Users/example/Downloads/name|with|pipes.zip',
    'garbage line',
  ].join('\n');

  const files = parseStatLines(output);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, 'Big Clip 1.mkv');
  assert.equal(files[1].path, '/Users/example/Downloads/name|with|pipes.zip');
  assert.equal(files[1].bytes, 250_000_000);
});

test('large file find arguments exclude system folders', () => {
  const args = buildArgs(HOME, 300);
  const text = args.join(' ');
  assert.match(text, /-size \+300M/);
  assert.match(text, /-name Library/);
  assert.match(text, /-name node_modules/);
  assert.match(text, /-prune/);
  assert.match(text, /-xdev/);
});

test('large file find can exclude protected folders', () => {
  const args = buildArgs(HOME, 300, [path.join(HOME, 'Downloads'), path.join(HOME, 'Documents')]);
  const text = args.join(' ');
  assert.ok(text.includes(`-path ${path.join(HOME, 'Downloads')}`));
  assert.ok(text.includes(`-path ${path.join(HOME, 'Documents')}`));
});

test('config normalization keeps valid roots and clamps the threshold', () => {
  const config = normalizeConfig({
    projectRoots: [path.join(HOME, 'Repositories'), 'relative/path', path.join(HOME, 'Repositories'), '  '],
    largeFileMinMB: 5,
  });
  assert.deepEqual(config.projectRoots, [path.join(HOME, 'Repositories')]);
  assert.equal(config.largeFileMinMB, 50);

  const high = normalizeConfig({ projectRoots: [], largeFileMinMB: 999_999 });
  assert.equal(high.largeFileMinMB, 100_000);

  const stale = normalizeConfig({ projectRoots: [], staleDays: 3 });
  assert.equal(stale.staleDays, 7);
  const staleHigh = normalizeConfig({ projectRoots: [], staleDays: 9_999 });
  assert.equal(staleHigh.staleDays, 365);
  assert.equal(normalizeConfig({}).staleDays, 30);
});
