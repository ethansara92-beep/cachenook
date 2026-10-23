'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isSafeProjectRoot } = require('./safety');

const HOME = os.homedir();
const MIN_LARGE_FILE_MB = 50;
const MAX_LARGE_FILE_MB = 100_000;
const MIN_STALE_DAYS = 7;
const MAX_STALE_DAYS = 365;

function defaultConfig() {
  return {
    projectRoots: ['Repositories', 'Developer', 'Projects', 'Code', 'src', 'Work'].map((name) =>
      path.join(HOME, name),
    ),
    largeFileMinMB: 300,
    staleDays: 30,
    staleWeekday: 0,
    staleHour: 11,
    staleMinute: 0,
    autoCleanIgnore: [],
    language: 'en',
    updateUrl: '',
  };
}

function normalizeConfig(input) {
  const defaults = defaultConfig();
  const config = { ...defaults };
  if (!input || typeof input !== 'object') return config;

  if (Array.isArray(input.projectRoots)) {
    const roots = input.projectRoots
      .filter((root) => typeof root === 'string')
      .map((root) => root.trim())
      .filter((root) => root.startsWith('/'))
      .map((root) => path.normalize(root))
      .filter((root, index, list) => list.indexOf(root) === index)
      .filter(isSafeProjectRoot)
      .slice(0, 20);
    config.projectRoots = roots;
  }

  const min = Number(input.largeFileMinMB);
  if (Number.isFinite(min)) {
    config.largeFileMinMB = Math.min(MAX_LARGE_FILE_MB, Math.max(MIN_LARGE_FILE_MB, Math.round(min)));
  }

  const stale = Number(input.staleDays);
  if (Number.isFinite(stale)) {
    config.staleDays = Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, Math.round(stale)));
  }

  const weekday = Number(input.staleWeekday);
  if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
    config.staleWeekday = weekday;
  }

  const hour = Number(input.staleHour);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
    config.staleHour = hour;
  }

  const minute = Number(input.staleMinute);
  if (Number.isInteger(minute) && minute >= 0 && minute <= 59) {
    config.staleMinute = minute;
  }

  if (input.language === 'vi' || input.language === 'en') {
    config.language = input.language;
  }

  if (typeof input.updateUrl === 'string') {
    const url = input.updateUrl.trim();
    config.updateUrl = /^https?:\/\//i.test(url) ? url.slice(0, 500) : '';
  }

  if (Array.isArray(input.autoCleanIgnore)) {
    config.autoCleanIgnore = input.autoCleanIgnore
      .filter((item) => typeof item === 'string' && path.isAbsolute(item))
      .map((item) => path.normalize(item))
      .filter(isSafeProjectRoot)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 50);
  }

  return config;
}

function createStore(userDataDir) {
  const file = path.join(userDataDir, 'config.json');

  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return defaultConfig();
    }
  }

  function save(input) {
    const config = normalizeConfig(input);
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return config;
  }

  return { file, load, save };
}

module.exports = {
  MAX_LARGE_FILE_MB,
  MAX_STALE_DAYS,
  MIN_LARGE_FILE_MB,
  MIN_STALE_DAYS,
  createStore,
  defaultConfig,
  normalizeConfig,
};
