'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { app, shell } = require('electron');

const { run } = require('./proc');

const HOME = os.homedir();
const UID = process.getuid();
const LABEL = 'com.cachenook.stale-clean';
const PLIST_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${LABEL}.plist`);
const LOG_DIR = path.join(HOME, 'Library', 'Logs', 'CacheNook');
const LOG_PATH = path.join(LOG_DIR, 'stale-clean.log');
const ERR_PATH = path.join(LOG_DIR, 'stale-clean.err.log');
const LAUNCHER = path.join(app.getPath('userData'), 'stale-clean-launch.sh');
const RESULT_PATH = path.join(app.getPath('userData'), 'last-stale-clean.json');
const SCRIPT = path.join(app.getAppPath(), 'bin', 'stale-clean.js');

function normalizeSchedule(input = {}) {
  const weekday = Number(input.weekday);
  const hour = Number(input.hour);
  const minute = Number(input.minute);

  return {
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 0,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 11,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function plistSource(schedule) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(LAUNCHER)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>${schedule.weekday}</integer>
    <key>Hour</key>
    <integer>${schedule.hour}</integer>
    <key>Minute</key>
    <integer>${schedule.minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(LOG_PATH)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(ERR_PATH)}</string>
</dict>
</plist>
`;
}

function launcherSource() {
  return `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
exec ${shellQuote(process.execPath)} ${shellQuote(SCRIPT)} --apply
`;
}

async function readSchedule() {
  try {
    const xml = await fsp.readFile(PLIST_PATH, 'utf8');
    const read = (key) => {
      const match = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(xml);
      return match ? Number(match[1]) : null;
    };
    const weekday = read('Weekday');
    const hour = read('Hour');
    const minute = read('Minute');
    if ([weekday, hour, minute].every(Number.isInteger)) return { weekday, hour, minute };
  } catch {
    // not installed or unreadable
  }
  return null;
}

async function readLastRun() {
  try {
    const parsed = JSON.parse(await fsp.readFile(RESULT_PATH, 'utf8'));
    return {
      finishedAt: parsed.finishedAt,
      startedAt: parsed.startedAt,
      totalFreed: parsed.totalFreed || 0,
      removed: Array.isArray(parsed.removed) ? parsed.removed.length : 0,
      days: parsed.days,
      dryRun: Boolean(parsed.dryRun),
      errors: Array.isArray(parsed.errors) ? parsed.errors.length : 0,
    };
  } catch {
    return null;
  }
}

async function getStatus() {
  const installed = fs.existsSync(PLIST_PATH);
  let loaded = false;

  if (installed) {
    const result = await run('/bin/launchctl', ['print', `gui/${UID}/${LABEL}`], {
      timeout: 10_000,
    });
    loaded = result.code === 0;
  }

  return {
    installed,
    loaded,
    schedule: installed ? await readSchedule() : null,
    lastRun: await readLastRun(),
    logPath: LOG_PATH,
  };
}

async function bootout() {
  await run('/bin/launchctl', ['bootout', `gui/${UID}`, PLIST_PATH], { timeout: 15_000 });
  await run('/bin/launchctl', ['bootout', `gui/${UID}/${LABEL}`], { timeout: 15_000 });
}

async function install(input) {
  const schedule = normalizeSchedule(input);

  await fsp.mkdir(PLIST_DIR, { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(LAUNCHER), { recursive: true });

  await fsp.writeFile(LAUNCHER, launcherSource(), { mode: 0o700 });
  await fsp.chmod(LAUNCHER, 0o700).catch(() => {});
  await fsp.writeFile(PLIST_PATH, plistSource(schedule), 'utf8');

  await bootout();
  const result = await run('/bin/launchctl', ['bootstrap', `gui/${UID}`, PLIST_PATH], {
    timeout: 20_000,
  });

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'Could not load the background job',
    );
  }

  return getStatus();
}

async function uninstall() {
  await bootout();
  await fsp.rm(PLIST_PATH, { force: true });
  await fsp.rm(LAUNCHER, { force: true });
  return getStatus();
}

async function runNow(apply) {
  const args = [SCRIPT, '--json'];
  if (apply) args.push('--apply');

  const result = await run(process.execPath, args, {
    env: { ELECTRON_RUN_AS_NODE: '1' },
    timeout: 600_000,
  });

  let summary = null;
  try {
    summary = JSON.parse(result.stdout);
  } catch {
    // handled below
  }

  if (result.code !== 0 || !summary) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Cleanup failed');
  }

  return summary;
}

async function refreshIfStale() {
  const status = await getStatus();
  if (!status.installed || !status.schedule) return false;

  let launcher = '';
  try {
    launcher = await fsp.readFile(LAUNCHER, 'utf8');
  } catch {
    // missing launcher, reinstall below
  }

  if (launcher.includes(process.execPath) && launcher.includes(SCRIPT)) return false;

  await install(status.schedule);
  return true;
}

async function showLog() {
  try {
    await fsp.access(LOG_PATH);
    shell.showItemInFolder(LOG_PATH);
  } catch {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    await shell.openPath(LOG_DIR);
  }
}

module.exports = {
  getStatus,
  install,
  normalizeSchedule,
  openLog: showLog,
  refreshIfStale,
  runNow,
  uninstall,
};
