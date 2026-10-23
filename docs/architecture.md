# Architecture

CacheNook separates discovery, validation and deletion.

```
targets / project roots
        |
        v
  scanner (read-only)
        |
        v
  safety validator
        |
        v
  preview in the renderer
        |
        v
  cleanup engine
```

## Main process

- `src/main/targets.js` declares the curated cleanup targets. A target is either a directory root or a command.
- `src/main/scan.js` measures directory targets with `du -skx` and runs command estimates.
- `src/main/projects.js` discovers project artifacts with `find` and measures them.
- `src/main/safety.js` owns path normalization, protected paths, bundle detection and project-root validation.
- `src/main/clean.js` removes directory contents through `/bin/rm -rf` only after the safety checks pass.
- `src/main/scheduler.js` owns the LaunchAgent, launcher script, status and manual runs.
- `src/main/migrate.js` moves the old MacSweep config and LaunchAgent to CacheNook on first launch.
- `src/main/ipc.js` is the only bridge between the renderer and these capabilities. Every path and list is validated.

## Renderer

The renderer is plain HTML, CSS and JavaScript. It never touches the filesystem directly. It receives sizes and metadata, renders escaped strings, and calls the preload bridge.

The preload exposes a narrow API with `contextIsolation`, `sandbox` and no Node integration.

## Safety model

- Directory targets must resolve inside the home folder. Protected paths and app bundles are rejected.
- Project roots must resolve inside the home folder and cannot be `~/Library` or `~/Applications`.
- Before deleting a project artifact, both the root and the artifact are resolved with `realpath`. The resolved artifact must stay inside the resolved root and inside the home folder.
- Symlinks are not followed by the scanner and are rejected for Trash operations.
- Scheduled cleanup additionally skips dirty git repos, `.cachenookignore` repositories and configured exclusions.

## Data files

- Config: `~/Library/Application Support/CacheNook/config.json`
- History: `~/Library/Application Support/CacheNook/history.json`
- Last scheduled result: `~/Library/Application Support/CacheNook/last-stale-clean.json`
- Scheduler launcher: `~/Library/Application Support/CacheNook/stale-clean-launch.sh`
- Logs: `~/Library/Logs/CacheNook/`
- LaunchAgent: `~/Library/LaunchAgents/com.cachenook.stale-clean.plist`
