'use strict';

const os = require('node:os');
const path = require('node:path');

const { shell } = require('electron');

const { parseStatLines } = require('./files');
const { run } = require('./proc');

const HOME = os.homedir();

async function listSnapshots() {
  const result = await run('/usr/bin/tmutil', ['listlocalsnapshots', '/'], {
    timeout: 20_000,
  });
  if (result.code !== 0) return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('com.apple.TimeMachine.'))
    .map((line) =>
      line.replace(/^com\.apple\.TimeMachine\./, '').replace(/\.local$/, ''),
    );
}

async function getStatus() {
  const snapshots = await listSnapshots();
  return { snapshots: snapshots.length };
}

async function deleteSnapshots() {
  const dates = await listSnapshots();
  const errors = [];
  let deleted = 0;

  for (const date of dates) {
    const result = await run('/usr/bin/tmutil', ['deletelocalsnapshots', date], {
      timeout: 60_000,
    });
    if (result.code === 0) {
      deleted += 1;
    } else {
      errors.push({
        date,
        message: result.stderr.trim() || result.stdout.trim() || 'Could not delete snapshot',
      });
    }
  }

  const remaining = await listSnapshots();
  return { deleted, remaining: remaining.length, errors };
}

async function scanInstallers() {
  const downloads = path.join(HOME, 'Downloads');
  const args = [
    downloads,
    '-xdev',
    '-maxdepth',
    '2',
    '-type',
    'f',
    '(',
    '-iname',
    '*.dmg',
    '-o',
    '-iname',
    '*.pkg',
    '-o',
    '-iname',
    '*.zip',
    '-o',
    '-iname',
    '*.iso',
    ')',
    '-mtime',
    '+30',
    '-size',
    '+50M',
    '-exec',
    '/usr/bin/stat',
    '-f',
    '%z|%m|%N',
    '{}',
    '+',
  ];

  const result = await run('/usr/bin/find', args, { timeout: 120_000 });
  const items = parseStatLines(result.stdout)
    .map((file) => ({
      ...file,
      ageDays: Math.floor((Date.now() - (file.mtime || Date.now())) / 86_400_000),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 50);

  return {
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
  };
}

async function openTrash() {
  await shell.openPath(path.join(HOME, '.Trash'));
  return true;
}

module.exports = {
  deleteSnapshots,
  getStatus,
  openTrash,
  scanInstallers,
};
