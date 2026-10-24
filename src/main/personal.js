'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { parseStatLines } = require('./files');
const { pathExists, run } = require('./proc');
const { HOME, isBundlePath, isInside, isProtected, normalize } = require('./safety');

const DAY = 86_400_000;
const MAX_ITEMS = 500;

const PROFILES = [
  {
    id: 'screenshots',
    name: 'Screenshots',
    icon: 'photo',
    ageDays: 30,
    risk: 'safe',
    description: 'Screenshot images older than 30 days.',
  },
  {
    id: 'installers',
    name: 'Installers',
    icon: 'package',
    ageDays: 30,
    risk: 'safe',
    description: 'Disk images and package installers over 50 MB, older than 30 days.',
  },
  {
    id: 'archives',
    name: 'Archives',
    icon: 'archive',
    ageDays: 90,
    risk: 'caution',
    description: 'ZIP, RAR and 7z archives over 10 MB, older than 90 days.',
  },
  {
    id: 'temp',
    name: 'Temp files',
    icon: 'file',
    ageDays: 0,
    risk: 'safe',
    description: 'Partial downloads, Office lock files and .DS_Store.',
  },
  {
    id: 'stale-downloads',
    name: 'Stale downloads',
    icon: 'folder',
    ageDays: 90,
    risk: 'caution',
    description: 'Files over 10 MB left in Downloads for more than 90 days.',
  },
  {
    id: 'large-old',
    name: 'Large old files',
    icon: 'file',
    ageDays: 180,
    risk: 'caution',
    description: 'Files over 500 MB that have not changed in 180 days.',
  },
];

const PROFILE_IDS = new Set(PROFILES.map((profile) => profile.id));
const ROOTS = [
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Documents'),
];
const DOWNLOADS = path.join(HOME, 'Downloads');

const BUNDLE_NAMES = [
  '*.app',
  '*.photoslibrary',
  '*.fcpbundle',
  '*.logicx',
  '*.band',
  '*.framework',
  '*.bundle',
  '*.xcodeproj',
  '*.xcworkspace',
  '*.sparsebundle',
  '*.vmwarevm',
  '*.pvm',
  '*.utm',
  '*.imovielibrary',
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.heic', '.tiff']);
const INSTALLER_EXTENSIONS = new Set(['.dmg', '.pkg', '.mpkg', '.iso']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz']);

function findArgs(root) {
  const args = [root, '-xdev', '(', '-type', 'd', '(', '-name', '.*'];
  for (const name of BUNDLE_NAMES) args.push('-o', '-name', name);
  args.push(
    ')',
    '-prune',
    ')',
    '-o',
    '-type',
    'f',
    '-exec',
    '/usr/bin/stat',
    '-f',
    '%z|%m|%N',
    '{}',
    '+',
  );
  return args;
}

function isScreenshot(file) {
  if (!IMAGE_EXTENSIONS.has(file.ext)) return false;
  return /(?:screenshot|screen[\s_-]?shot|cleanshot|snip|bildschirmfoto|截屏|屏幕快照)/i.test(
    file.name,
  );
}

function isTemp(file) {
  const name = file.name;
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.crdownload') ||
    lower.endsWith('.part') ||
    lower.endsWith('.download') ||
    lower.endsWith('.tmp') ||
    name.startsWith('~$') ||
    name === '.DS_Store'
  );
}

function matchProfiles(file) {
  const profiles = [];
  const age = file.ageDays;

  if (isScreenshot(file) && age >= 30) profiles.push('screenshots');
  if (INSTALLER_EXTENSIONS.has(file.ext) && file.bytes >= 50_000_000 && age >= 30) {
    profiles.push('installers');
  }
  if (ARCHIVE_EXTENSIONS.has(file.ext) && file.bytes >= 10_000_000 && age >= 90) {
    profiles.push('archives');
  }
  if (isTemp(file)) profiles.push('temp');

  if (
    profiles.length === 0 &&
    isInside(file.path, DOWNLOADS) &&
    file.bytes >= 10_000_000 &&
    age >= 90
  ) {
    profiles.push('stale-downloads');
  }
  if (profiles.length === 0 && file.bytes >= 500_000_000 && age >= 180) {
    profiles.push('large-old');
  }

  return profiles;
}

function isExcluded(filePath, exclusions) {
  return exclusions.some((excluded) => filePath === excluded || isInside(filePath, excluded));
}

async function scanPersonal({ exclude = [], ctx } = {}) {
  const exclusions = exclude
    .filter((item) => typeof item === 'string' && path.isAbsolute(item))
    .map((item) => path.normalize(item));

  const counts = Object.fromEntries(
    PROFILES.map((profile) => [profile.id, { count: 0, bytes: 0 }]),
  );
  const items = [];

  for (const root of ROOTS) {
    if (ctx?.cancelled) break;
    if (!(await pathExists(root))) continue;

    const result = await run('/usr/bin/find', findArgs(root), {
      timeout: 180_000,
      track: ctx?.track,
    });

    if (
      result.code !== 0 &&
      /Operation not permitted|Permission denied/i.test(result.stderr)
    ) {
      return { available: false, reason: 'fda' };
    }

    for (const parsed of parseStatLines(result.stdout)) {
      if (ctx?.cancelled) break;
      if (!parsed.bytes || parsed.bytes <= 0) continue;
      if (parsed.name.endsWith('.icloud')) continue;
      if (isExcluded(parsed.path, exclusions)) continue;
      if (isProtected(parsed.path) || isBundlePath(parsed.path)) continue;

      const ext = path.extname(parsed.name).toLowerCase();
      const ageDays = Math.max(
        0,
        Math.floor((Date.now() - (parsed.mtime || Date.now())) / DAY),
      );
      const file = { ...parsed, ext, ageDays };
      const profiles = matchProfiles(file);
      if (profiles.length === 0) continue;

      items.push({
        path: file.path,
        name: file.name,
        dir: file.dir,
        bytes: file.bytes,
        mtime: file.mtime,
        ageDays,
        profiles,
      });

      for (const id of profiles) {
        counts[id].count += 1;
        counts[id].bytes += file.bytes;
      }
    }
  }

  items.sort((left, right) => right.bytes - left.bytes || right.ageDays - left.ageDays);

  return {
    available: true,
    roots: ROOTS,
    profiles: PROFILES,
    counts,
    items: items.slice(0, MAX_ITEMS),
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    found: items.length,
  };
}

async function assertPersonalFile(input) {
  const target = normalize(input);
  const root = ROOTS.find((candidate) => isInside(target, candidate));
  if (!root || target === root) throw new Error('Outside Desktop, Downloads and Documents');
  if (isProtected(target)) throw new Error('Refusing to touch a protected path');
  if (isBundlePath(target)) throw new Error('Refusing to touch a bundle');
  if (target.endsWith('.icloud')) throw new Error('Refusing to touch an iCloud placeholder');

  const stat = await fs.lstat(target);
  if (stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Only regular files can be moved to the Trash');
  }

  const real = await fs.realpath(target);
  if (!ROOTS.some((candidate) => isInside(real, candidate))) {
    throw new Error('Resolved path escapes the personal folders');
  }
  if (isBundlePath(real)) throw new Error('Refusing to touch a bundle');

  return real;
}

module.exports = {
  PROFILES,
  PROFILE_IDS,
  ROOTS,
  assertPersonalFile,
  matchProfiles,
  scanPersonal,
};
