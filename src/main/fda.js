'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Reading the TCC database is only possible with Full Disk Access, and the
// failed attempt does not raise a permission prompt. This is the same probe
// used by other macOS tools to detect the grant.
const PROBE = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');

async function hasFullDiskAccess() {
  let handle = null;
  try {
    handle = await fs.open(PROBE, 'r');
    const buffer = Buffer.alloc(16);
    await handle.read(buffer, 0, 16, 0);
    return true;
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = { hasFullDiskAccess };
