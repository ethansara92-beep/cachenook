'use strict';

const os = require('node:os');
const path = require('node:path');

const { duBytes, pool, run, which } = require('./proc');

const HOME = os.homedir();
const join = (...parts) => path.join(HOME, ...parts);

/** Parse strings like "2.7GB", "34.6MB", "512B", "1.2 kB" into bytes. */
function parseHumanBytes(text) {
  if (typeof text !== 'string') return 0;
  const match = /([\d]+(?:[.,][\d]+)?)\s*([kmgtp]?)i?b/i.exec(text);
  if (!match) return 0;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  const powers = { '': 0, k: 1, m: 2, g: 3, t: 4, p: 5 };
  const power = powers[match[2].toLowerCase()] ?? 0;
  return Math.round(value * 1000 ** power);
}

async function brewEstimate(ctx) {
  const brew = await which('brew');
  if (!brew) return { available: false, note: 'Homebrew is not installed' };

  const env = {
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ANALYTICS: '1',
    NONINTERACTIVE: '1',
  };
  const result = await run(brew, ['cleanup', '-n'], {
    env,
    timeout: 90_000,
    track: ctx?.track,
  });

  if (result.code !== 0) {
    return { available: false, note: 'Homebrew cleanup check failed' };
  }

  const summary = /would free approximately\s+([\d.,]+\s*[kmgtp]?i?b)/i.exec(result.stdout);
  let bytes = summary ? parseHumanBytes(summary[1]) : 0;
  if (!bytes) {
    for (const match of result.stdout.matchAll(/\(([\d.,]+\s*[kmgtp]?i?b)\)/gi)) {
      bytes += parseHumanBytes(match[1]);
    }
  }
  return { available: true, bytes, note: 'Old versions and stale downloads' };
}

async function brewClean() {
  const brew = await which('brew');
  if (!brew) throw new Error('Homebrew is not installed');
  const result = await run(brew, ['cleanup', '--prune=all'], {
    env: {
      HOMEBREW_NO_AUTO_UPDATE: '1',
      HOMEBREW_NO_ANALYTICS: '1',
      NONINTERACTIVE: '1',
    },
    timeout: 600_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `brew cleanup exited with ${result.code}`);
  }
  const summary = /freed approximately\s+([\d.,]+\s*[kmgtp]?i?b)/i.exec(result.stdout);
  return {
    freed: summary ? parseHumanBytes(summary[1]) : null,
    note: 'Removed outdated Homebrew versions',
  };
}

async function dockerEstimate(ctx) {
  const docker = await which('docker');
  if (!docker) return { available: false, note: 'Docker is not installed' };

  const result = await run(docker, ['system', 'df', '--format', '{{json .}}'], {
    timeout: 20_000,
    track: ctx?.track,
  });
  if (result.code !== 0) {
    return { available: false, note: 'Docker is not running' };
  }

  let bytes = 0;
  let hadRows = false;
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const row = JSON.parse(trimmed);
      hadRows = true;
      bytes += parseHumanBytes(row.Reclaimable || row.Size || '');
    } catch {
      // ignore malformed rows
    }
  }
  if (!hadRows) return { available: false, note: 'Docker returned no usage data' };
  return { available: true, bytes, note: 'Unused images, containers and build cache' };
}

async function dockerClean() {
  const docker = await which('docker');
  if (!docker) throw new Error('Docker is not installed');
  const result = await run(docker, ['system', 'prune', '-af', '--volumes'], {
    timeout: 900_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `docker prune exited with ${result.code}`);
  }
  const summary = /Total reclaimed space:\s*([\d.,]+\s*[kmgtp]?i?b)/i.exec(result.stdout);
  return {
    freed: summary ? parseHumanBytes(summary[1]) : null,
    note: 'Pruned unused Docker data',
  };
}

async function simulatorDevices() {
  const xcrun = await which('xcrun');
  if (!xcrun) return { available: false, note: 'Xcode command line tools are not installed' };

  const result = await run(xcrun, ['simctl', 'list', 'devices', 'unavailable', '-j'], {
    timeout: 30_000,
  });
  if (result.code !== 0) {
    return { available: false, note: 'Simulator tools require a full Xcode install' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { available: false, note: 'Could not read the simulator list' };
  }

  const udids = [];
  for (const devices of Object.values(parsed.devices || {})) {
    for (const device of devices || []) {
      if (device && device.isAvailable === false && device.udid) udids.push(device.udid);
    }
  }
  return { available: true, udids };
}

async function simulatorEstimate(ctx) {
  const devices = await simulatorDevices();
  if (!devices.available) return devices;
  if (devices.udids.length === 0) {
    return { available: true, bytes: 0, note: 'No unavailable simulators' };
  }

  const dirs = devices.udids.map((udid) =>
    join('Library', 'Developer', 'CoreSimulator', 'Devices', udid),
  );
  let bytes = 0;
  await pool(dirs, 4, async (dir) => {
    bytes += await duBytes(dir, ctx?.track);
  });
  return {
    available: true,
    bytes,
    note: `${devices.udids.length} outdated simulator${devices.udids.length === 1 ? '' : 's'}`,
  };
}

async function simulatorClean() {
  const devices = await simulatorDevices();
  if (!devices.available) throw new Error(devices.note);
  if (devices.udids.length === 0) return { freed: 0, note: 'No unavailable simulators' };

  const xcrun = await which('xcrun');
  const result = await run(xcrun, ['simctl', 'delete', 'unavailable'], { timeout: 300_000 });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Could not delete unavailable simulators');
  }
  return {
    freed: null,
    note: `Deleted ${devices.udids.length} outdated simulator${devices.udids.length === 1 ? '' : 's'}`,
  };
}

module.exports = {
  brewClean,
  brewEstimate,
  dockerClean,
  dockerEstimate,
  parseHumanBytes,
  simulatorClean,
  simulatorEstimate,
};
