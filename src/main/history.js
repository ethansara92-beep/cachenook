'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_ENTRIES = 100;

function historyFile(userData) {
  return path.join(userData, 'history.json');
}

async function read(userData) {
  try {
    const parsed = JSON.parse(await fs.readFile(historyFile(userData), 'utf8'));
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.at === 'string')
      : [];
  } catch {
    return [];
  }
}

async function append(userData, entry) {
  const list = await read(userData);
  list.push({ ...entry, at: new Date().toISOString() });
  const trimmed = list.slice(-MAX_ENTRIES);

  await fs.mkdir(userData, { recursive: true });
  const target = historyFile(userData);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, target);
  return trimmed;
}

function summarize(list) {
  const now = new Date();
  const monthly = list.filter((entry) => {
    const date = new Date(entry.at);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });

  return {
    monthFreed: monthly.reduce((sum, entry) => sum + (Number(entry.freed) || 0), 0),
    monthRuns: monthly.length,
    totalFreed: list.reduce((sum, entry) => sum + (Number(entry.freed) || 0), 0),
    totalRuns: list.length,
  };
}

module.exports = { append, read, summarize };
