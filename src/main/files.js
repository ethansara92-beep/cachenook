'use strict';

const path = require('node:path');

const { HOME } = require('./safety');
const { pathExists, run } = require('./proc');

const MAX_FILES = 400;

// Never surface files inside app or media-library bundles. Trashing an internal
// file would break the bundle.
const BUNDLE_EXCLUSIONS = [
  '*.app/*',
  '*.photoslibrary/*',
  '*.fcpbundle/*',
  '*.logicx/*',
  '*.band/*',
  '*.framework/*',
  '*.bundle/*',
  '*.xcodeproj/*',
  '*.xcworkspace/*',
  '*.sparsebundle/*',
  '*.vmwarevm/*',
  '*.pvm/*',
  '*.utm/*',
  '*.imovielibrary/*',
];

function buildArgs(root, minMB, exclusions = []) {
  const pruneNames = [
    '.*',
    'Library',
    'node_modules',
    'Applications',
    'venv',
    'env',
    'virtualenv',
    'site-packages',
    'dist-packages',
    'Pods',
    'DerivedData',
    'target',
    'build',
    'dist',
    'out',
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

  const args = [root, '-xdev', '('];
  let first = true;
  for (const name of pruneNames) {
    if (!first) args.push('-o');
    first = false;
    args.push('-type', 'd', '-name', name);
  }
  for (const dir of exclusions) {
    if (!first) args.push('-o');
    first = false;
    args.push('-path', dir);
  }
  args.push(
    ')',
    '-prune',
    '-o',
    '-type',
    'f',
    '-size',
    `+${minMB}M`,
    '-exec',
    '/usr/bin/stat',
    '-f',
    '%z|%m|%N',
    '{}',
    '+',
  );
  return args;
}

function parseStatLines(stdout) {
  const files = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const first = line.indexOf('|');
    const second = line.indexOf('|', first + 1);
    if (first <= 0 || second <= first) continue;

    const bytes = Number.parseInt(line.slice(0, first), 10);
    const mtime = Number.parseInt(line.slice(first + 1, second), 10);
    const filePath = line.slice(second + 1);
    if (!Number.isFinite(bytes) || !filePath) continue;
    if (!path.isAbsolute(filePath) || filePath.startsWith('..')) continue;

    files.push({
      path: filePath,
      name: path.basename(filePath),
      dir: path.dirname(filePath),
      bytes,
      mtime: Number.isFinite(mtime) ? mtime * 1000 : null,
    });
  }
  return files;
}

async function scanLargeFiles({ roots, minMB, ctx, exclusions = [], home = HOME }) {
  const scanRoots = roots && roots.length > 0 ? roots : [home];
  const all = [];
  let timedOut = false;

  for (const root of scanRoots) {
    if (ctx.cancelled) break;
    if (!(await pathExists(root))) continue;

    const result = await run('/usr/bin/find', buildArgs(root, minMB, exclusions), {
      timeout: 240_000,
      track: ctx.track,
    });
    if (result.signal) timedOut = true;
    all.push(...parseStatLines(result.stdout));
  }

  const seen = new Set();
  const items = all
    .filter((file) => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_FILES);

  return {
    items,
    totalBytes: items.reduce((sum, file) => sum + file.bytes, 0),
    minMB,
    timedOut,
  };
}

module.exports = { buildArgs, parseStatLines, scanLargeFiles };
