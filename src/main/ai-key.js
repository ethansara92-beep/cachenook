'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { app, safeStorage } = require('electron');

function keyFile() {
  return path.join(app.getPath('userData'), 'ai-key');
}

function getKey() {
  let raw;
  try {
    raw = fs.readFileSync(keyFile());
  } catch {
    return '';
  }
  if (raw.length === 0 || !safeStorage.isEncryptionAvailable()) return '';

  try {
    return safeStorage.decryptString(raw).trim();
  } catch {
    return '';
  }
}

function hasKey() {
  return getKey().length > 0;
}

function clearKey() {
  fs.rmSync(keyFile(), { force: true });
  return true;
}

function setKey(input) {
  const key = String(input || '').trim();
  if (!key) return clearKey();
  if (key.length > 500) throw new Error('API key is too long');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this Mac');
  }

  const encrypted = safeStorage.encryptString(key);
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile(), encrypted, { mode: 0o600 });
  fs.chmodSync(keyFile(), 0o600);
  return true;
}

module.exports = { clearKey, getKey, hasKey, setKey };
