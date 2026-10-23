'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { app } = require('electron');

const { run } = require('./proc');
const scheduler = require('./scheduler');

const HOME = os.homedir();
const OLD_DATA = path.join(HOME, 'Library', 'Application Support', 'MacSweep');
const NEW_DATA = path.join(HOME, 'Library', 'Application Support', 'CacheNook');
const OLD_PLIST = path.join(
  HOME,
  'Library',
  'LaunchAgents',
  'com.macsweep.stale-clean.plist',
);
const NEW_PLIST = path.join(
  HOME,
  'Library',
  'LaunchAgents',
  'com.cachenook.stale-clean.plist',
);
const OLD_LAUNCHER = path.join(OLD_DATA, 'stale-clean-launch.sh');

async function readOldSchedule() {
  try {
    const xml = await fsp.readFile(OLD_PLIST, 'utf8');
    const read = (key) => {
      const match = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(xml);
      return match ? Number(match[1]) : null;
    };
    const weekday = read('Weekday');
    const hour = read('Hour');
    const minute = read('Minute');
    if ([weekday, hour, minute].every(Number.isInteger)) {
      return { weekday, hour, minute };
    }
  } catch {
    // unreadable old plist
  }
  return null;
}

/**
 * One-time migration from the old MacSweep identity. Copies config, history
 * and the last run, then removes the old LaunchAgent so it cannot keep running
 * against the old script path.
 */
async function migrate() {
  let copied = false;
  const oldConfig = path.join(OLD_DATA, 'config.json');
  const newConfig = path.join(NEW_DATA, 'config.json');

  if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
    await fsp.mkdir(NEW_DATA, { recursive: true });
    for (const file of ['config.json', 'history.json', 'last-stale-clean.json']) {
      const source = path.join(OLD_DATA, file);
      const target = path.join(NEW_DATA, file);
      if (fs.existsSync(source)) {
        await fsp.copyFile(source, target).catch(() => {});
      }
    }
    copied = true;
  }

  const hadOldJob = fs.existsSync(OLD_PLIST);
  const schedule = hadOldJob ? await readOldSchedule() : null;

  if (hadOldJob) {
    await run('/bin/launchctl', ['bootout', `gui/${process.getuid()}`, OLD_PLIST], {
      timeout: 10_000,
    });
    await run(
      '/bin/launchctl',
      ['bootout', `gui/${process.getuid()}/com.macsweep.stale-clean`],
      { timeout: 10_000 },
    );
    await fsp.rm(OLD_PLIST, { force: true });
    await fsp.rm(OLD_LAUNCHER, { force: true });

    if (schedule && !fs.existsSync(NEW_PLIST)) {
      try {
        await scheduler.install(schedule);
      } catch {
        // The user can turn the schedule on again from Settings.
      }
    }
  }

  return { copied, hadOldJob, schedule };
}

module.exports = { migrate };
