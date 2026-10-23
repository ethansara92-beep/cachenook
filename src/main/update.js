'use strict';

const { app, shell } = require('electron');

function compareVersions(left, right) {
  const a = String(left).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const av = a[index] || 0;
    const bv = b[index] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function check(url) {
  const current = app.getVersion();
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { configured: false, current };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': `CacheNook/${current}` },
    });
    if (!response.ok) throw new Error(`Update server returned ${response.status}`);

    const data = await response.json();
    const latest = String(data.version || '').replace(/^v/i, '');
    if (!latest) throw new Error('Update manifest has no version');

    return {
      configured: true,
      current,
      latest,
      available: compareVersions(latest, current) > 0,
      url: typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : '',
      notes: typeof data.notes === 'string' ? data.notes : '',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function open(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Refusing to open a non-http URL');
  }
  await shell.openExternal(url);
  return true;
}

module.exports = { check, compareVersions, open };
