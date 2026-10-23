'use strict';

const path = require('node:path');

const { duBytes, pathExists, pool, run } = require('./proc');

const ARTIFACTS = [
  { name: 'node_modules', risk: 'safe' },
  { name: '.next', risk: 'safe' },
  { name: '.nuxt', risk: 'safe' },
  { name: '.svelte-kit', risk: 'safe' },
  { name: '.turbo', risk: 'safe' },
  { name: '.parcel-cache', risk: 'safe' },
  { name: '.expo', risk: 'safe' },
  { name: '.venv', risk: 'safe' },
  { name: 'venv', risk: 'safe' },
  { name: '__pycache__', risk: 'safe' },
  { name: '.pytest_cache', risk: 'safe' },
  { name: 'target', risk: 'caution' },
  { name: '.dart_tool', risk: 'safe' },
  { name: '.gradle', risk: 'caution' },
  { name: '.terraform', risk: 'caution' },
  { name: '.angular', risk: 'safe' },
  { name: '.nx', risk: 'safe' },
  { name: '.vite', risk: 'safe' },
  { name: '.nyc_output', risk: 'safe' },
  { name: '.mypy_cache', risk: 'safe' },
  { name: '.ruff_cache', risk: 'safe' },
  { name: '.tox', risk: 'safe' },
  { name: '.nox', risk: 'safe' },
  { name: 'coverage', risk: 'caution' },
  { name: '.build', risk: 'caution' },
  { name: 'Pods', risk: 'caution' },
  { name: 'DerivedData', risk: 'caution' },
  { name: '.swiftpm', risk: 'caution' },
  { name: 'vendor', risk: 'caution' },
  { name: 'dist', risk: 'caution' },
  { name: 'build', risk: 'caution' },
  { name: 'out', risk: 'caution' },
];

const MAX_ARTIFACTS = 300;
const MIN_ARTIFACT_BYTES = 1_000_000;

function findArgs(root) {
  const names = [];
  ARTIFACTS.forEach((artifact, index) => {
    if (index > 0) names.push('-o');
    names.push('-name', artifact.name);
  });
  return [
    root,
    '-maxdepth',
    '8',
    '-type',
    'd',
    '(',
    ...names,
    ')',
    '-prune',
    '-print',
  ];
}

function repoPathFor(root, artifactPath) {
  const relative = path.relative(root, artifactPath);
  if (!relative || relative.startsWith('..')) return root;
  const first = relative.split(path.sep)[0];
  return first ? path.join(root, first) : root;
}

function repoName(root, artifactPath) {
  const relative = path.relative(root, artifactPath);
  if (!relative || relative.startsWith('..')) return path.basename(root);
  const first = relative.split(path.sep)[0];
  return first || path.basename(root);
}

async function discoverArtifacts(roots, ctx) {
  const found = [];
  const seen = new Set();

  for (const root of roots) {
    if (ctx.cancelled) break;
    if (!(await pathExists(root))) continue;

    const result = await run('/usr/bin/find', findArgs(root), {
      timeout: 240_000,
      track: ctx.track,
    });

    for (const line of result.stdout.split('\n')) {
      const artifactPath = line.trim();
      if (!artifactPath || seen.has(artifactPath)) continue;
      if (found.length >= MAX_ARTIFACTS * 2) break;
      seen.add(artifactPath);
      const artifact = ARTIFACTS.find((entry) => artifactPath.endsWith(path.sep + entry.name));
      found.push({
        path: artifactPath,
        artifact: path.basename(artifactPath),
        repo: repoName(root, artifactPath),
        repoPath: repoPathFor(root, artifactPath),
        root,
        risk: artifact?.risk || 'caution',
        bytes: 0,
      });
    }
  }

  return found;
}

async function scanProjects({ roots, ctx, onProgress }) {
  const discovered = await discoverArtifacts(roots, ctx);
  let done = 0;

  await pool(discovered, 6, async (item) => {
    if (ctx.cancelled) return;
    item.bytes = await duBytes(item.path, ctx.track);
    done += 1;
    if (onProgress) onProgress({ done, total: discovered.length, path: item.path });
  });

  const items = discovered
    .filter((item) => item.bytes >= MIN_ARTIFACT_BYTES)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_ARTIFACTS);

  return {
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    found: items.length,
    roots,
  };
}

module.exports = { ARTIFACTS, discoverArtifacts, scanProjects };
