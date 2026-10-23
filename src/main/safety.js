'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const SEP = path.sep;

// Exact paths that must never be deleted, even if a target definition is wrong.
const PROTECTED_PATHS = new Set([
  '/',
  '/Applications',
  '/Library',
  '/System',
  '/Users',
  '/Volumes',
  '/bin',
  '/cores',
  '/dev',
  '/etc',
  '/opt',
  '/private',
  '/sbin',
  '/tmp',
  '/usr',
  '/var',
  '/private/tmp',
  '/private/var',
]);

// Top level folders in the home directory that are never cleanup roots.
const PROTECTED_HOME_ENTRIES = new Set([
  '.gnupg',
  '.ssh',
  'Applications',
  'Desktop',
  'Documents',
  'Downloads',
  'Keychains',
  'Library',
  'Movies',
  'Music',
  'Pictures',
  'Public',
]);

// Top level home folders that are valid cleanup roots.
const ALLOWED_TOP_LEVEL = new Set(['.Trash']);

// CacheNook's own Chromium state. Deleting it while the app runs breaks the UI.
const OWN_STATE = [
  path.join(HOME, 'Library', 'Application Support', 'CacheNook'),
  path.join(HOME, 'Library', 'Caches', 'CacheNook'),
  path.join(HOME, 'Library', 'Caches', 'cachenook'),
  path.join(HOME, 'Library', 'Preferences', 'com.cachenook.app.plist'),
  // Old identity, kept protected so upgrades cannot delete its state.
  path.join(HOME, 'Library', 'Application Support', 'MacSweep'),
  path.join(HOME, 'Library', 'Caches', 'MacSweep'),
  path.join(HOME, 'Library', 'Caches', 'macsweep'),
  path.join(HOME, 'Library', 'Preferences', 'com.macsweep.app.plist'),
];

function normalize(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (input.includes('\0')) {
    throw new Error('Path contains a null byte');
  }
  if (!path.isAbsolute(input)) {
    throw new Error(`Path must be absolute: ${input}`);
  }
  return path.normalize(input);
}

function isInside(child, parent) {
  if (child === parent) return true;
  const base = parent.endsWith(SEP) ? parent : parent + SEP;
  return child.startsWith(base);
}

function isOwnState(target) {
  return OWN_STATE.some((p) => isInside(target, p));
}

const BUNDLE_SUFFIXES = [
  '.app',
  '.photoslibrary',
  '.fcpbundle',
  '.logicx',
  '.band',
  '.framework',
  '.bundle',
  '.xcodeproj',
  '.xcworkspace',
  '.sparsebundle',
  '.vmwarevm',
  '.pvm',
  '.utm',
  '.imovielibrary',
  '.aplibrary',
];

/** True when a path sits inside an app or media library bundle. */
function isBundlePath(input) {
  const p = normalize(input);
  const parts = p.split(SEP).filter(Boolean);
  return parts.some((part) => BUNDLE_SUFFIXES.some((suffix) => part.endsWith(suffix)));
}

function isProtected(target) {
  const p = normalize(target);
  if (PROTECTED_PATHS.has(p)) return true;
  if (p === HOME) return true;
  if (isOwnState(p)) return true;

  const rel = path.relative(HOME, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;

  const parts = rel.split(SEP);
  if (parts.length === 1 && PROTECTED_HOME_ENTRIES.has(parts[0])) return true;
  return false;
}

/**
 * Validate a directory whose entire contents may be removed.
 * The directory itself is kept, only its children are deleted.
 */
function assertSafeCleanRoot(input) {
  const p = normalize(input);
  if (isProtected(p)) {
    throw new Error(`Refusing to clean protected path: ${p}`);
  }
  if (path.dirname(p) === HOME && !ALLOWED_TOP_LEVEL.has(path.basename(p))) {
    throw new Error(`Refusing to clean a top level home folder: ${p}`);
  }
  if (!isInside(p, HOME)) {
    throw new Error(`Refusing to clean a path outside the home directory: ${p}`);
  }
  const depth = p.split(SEP).filter(Boolean).length;
  if (depth < 3) {
    throw new Error(`Refusing to clean a shallow path: ${p}`);
  }
  return p;
}

/** Validate that a path is a direct or nested child of an approved root. */
function assertInsideRoot(childInput, rootInput) {
  const child = normalize(childInput);
  const root = normalize(rootInput);
  if (!isInside(child, root) || child === root) {
    throw new Error(`Refusing to delete ${child}: outside ${root}`);
  }
  return child;
}

/**
 * Project roots must resolve to a real path inside the home folder. Symlinked
 * roots that point at system folders are rejected. A root that does not exist
 * yet is kept if its lexical path is safe, so new project folders can be added
 * ahead of time.
 */
function isSafeProjectRoot(input) {
  let normalized;
  try {
    normalized = normalize(input);
  } catch {
    return false;
  }

  let real = normalized;
  try {
    real = fs.realpathSync(normalized);
  } catch {
    // keep the lexical path for folders that do not exist yet
  }

  if (real === HOME) return false;
  if (!isInside(real, HOME)) return false;
  if (isProtected(real)) return false;
  if (isInside(real, path.join(HOME, 'Library'))) return false;
  if (isInside(real, path.join(HOME, 'Applications'))) return false;
  return true;
}

/** Validate a user file that is about to be moved to the Trash. */
function assertUserFile(input) {
  const p = normalize(input);
  if (p === HOME) throw new Error('Refusing to move the home directory to the Trash');
  if (isBundlePath(p)) throw new Error('Refusing to touch files inside an app or library bundle');
  if (isProtected(p)) throw new Error(`Refusing to touch protected path: ${p}`);
  if (!isInside(p, HOME)) {
    throw new Error(`Refusing to touch a path outside the home directory: ${p}`);
  }
  return p;
}

module.exports = {
  HOME,
  isBundlePath,
  isInside,
  isSafeProjectRoot,
  isProtected,
  normalize,
  assertSafeCleanRoot,
  assertInsideRoot,
  assertUserFile,
};
