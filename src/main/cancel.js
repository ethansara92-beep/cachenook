'use strict';

function createCancellation() {
  const children = new Set();

  const ctx = {
    cancelled: false,
    track(child) {
      children.add(child);
      child.once('close', () => children.delete(child));
      if (ctx.cancelled) {
        try {
          child.kill('SIGTERM');
        } catch {
          // already gone
        }
      }
    },
    cancel() {
      ctx.cancelled = true;
      for (const child of children) {
        try {
          child.kill('SIGTERM');
        } catch {
          // already gone
        }
      }
    },
  };

  return ctx;
}

module.exports = { createCancellation };
