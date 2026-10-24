# Contributing

Thanks for helping CacheNook. The project is a small Electron app with a dangerous job: deleting files. Safety and review matter more than feature count.

## Setup

```bash
npm install
npm start
npm test
```

Node 20 or newer is required for development. macOS 13 or newer is the supported target.

## Before you open a PR

- Run `npm test` and `npm run check`.
- If you change cleanup behavior, add or update a test in `test/`.
- If you add a new cleanup target, declare its risk (`safe` or `caution`), keep the root outside protected paths, and make it visible in the preview.
- If you add a new project artifact, update both `src/main/projects.js` and the scheduled cleanup allowlist in `bin/stale-clean.js`.
- Keep the app local only. No telemetry, no analytics, no background network calls. Smart sort may call the endpoint the user configured, only after they press it.
- Do not add a dependency that can delete data without going through the safety validator.

## Safety rules

- Never delete a path that is not inside an allowlisted root or a configured project root.
- Never follow symlinks out of a root.
- Never delete a top-level home folder.
- Never delete MacSweep/CacheNook's own state while the app is running.
- Large user files and personal files in Desktop, Downloads and Documents go through the macOS Trash.
- Personal file profiles are review-first. Do not add a silent delete path.
- AI suggestions are advisory. Never auto-select or auto-delete from a model response.
- Smart sort may send file metadata only. Never send file contents or read files for the model.
- Store an AI API key with Electron `safeStorage`, never in config or renderer state, and never log it.
- Preview before destructive actions. Do not add a silent delete path.

## Code style

- CommonJS in the main process and preload.
- Plain JavaScript in the renderer, no framework.
- Keep renderer text escaped with `esc()` or `tt()`.
- Keep IPC handlers validating their inputs.
- No em dashes in user-facing copy. Use a plain hyphen.

## Commits

Use short, concrete messages. Do not add an AI co-author.

## License

By contributing, you agree that your changes are licensed under the MIT license.
