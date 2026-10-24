# Feature tour

CacheNook is built around one idea: a cleanup tool should understand the projects on your disk, not just the system caches Apple already knows about.

Screenshots come from the same build in different permission states. Cleanup shows the full System group with Full Disk Access. The large-file view is shown without access to Desktop, Documents and Downloads so personal files stay out of the docs. The Files screenshots use demo files with a search filter, so real personal filenames stay out of the docs.

## Cleanup

![Cleanup](screenshots/01-cleanup.png)

- The hero shows the total size of everything CacheNook can currently see.
- Each row has a checkbox, a risk label and an exact size.
- `Safe` items are rebuilt by the app. `Review` items contain data you may want to inspect first.
- The footer only appears when something is selected.
- System caches appear only after Full Disk Access is granted.

## Target details

![Target details](screenshots/02-cleanup-details.png)

Expand a row to see every root that belongs to a target and its exact size. `Reveal` opens that folder in Finder before you decide.

## Projects

![Projects](screenshots/03-projects.png)

CacheNook scans your configured project folders for regenerable build directories: `node_modules`, `.next`, `.venv`, `target`, `Pods`, `.dart_tool`, `coverage` and more.

- Nothing is selected by default.
- The group header shows the total per repository.
- `Ignore auto-clean` excludes a repository from the scheduled job.

## Project search

![Project search](screenshots/04-projects-search.png)

Search by repository, artifact or path. The counter shows how many matches are visible.

## Large files

![Large files](screenshots/05-large-files.png)

Files above the configured threshold, outside `~/Library`, `node_modules`, `.git` and app bundles.

- Search by name or folder.
- `Reveal` opens the file in Finder.
- Removal moves files to the Trash, so they stay recoverable.
- The threshold is configurable from Settings.
- This screenshot is taken without access to Desktop, Documents and Downloads. Those folders are skipped, not missing.

## Personal files

![Personal files](screenshots/15-personal.png)

The **Files** tab adds review-first profiles for Desktop, Downloads and Documents:

- **Screenshots** older than 30 days.
- **Installers** over 50 MB, older than 30 days.
- **Archives** over 10 MB, older than 90 days.
- **Temp files** such as `.crdownload`, `.part`, `.tmp`, `~$` Office locks and `.DS_Store`.
- **Stale downloads** over 10 MB, older than 90 days.
- **Large old files** over 500 MB, unchanged for 180 days.

Every profile is a rule, not an automatic delete. Nothing is selected by default. The profile chips and search narrow the list. The lock button keeps a file and adds it to **Personal file exclusions**. Removal always moves files to the Trash.

## AI suggestions

![AI suggestions](screenshots/16-personal-ai.png)

Smart sort is optional. Add an OpenAI-compatible endpoint and model in **Settings > AI suggestions**, for example a local Ollama or LM Studio server.

- Only file names, extensions, sizes, ages and folder paths are sent. File contents are never read or uploaded.
- Suggestions are `Keep`, `Review` or `Trash`. They are advisory; nothing is selected until you click **Select AI trash suggestions**.
- That selection is limited to the visible search and profile, so hidden files cannot be swept in by accident.
- Add an optional API key in **Settings > AI suggestions**. It is encrypted with the macOS Keychain and never sent to the renderer. `CACHENOOK_AI_API_KEY` also works for automation.
- The endpoint is off by default.

## Trash confirmation

![Personal trash confirmation](screenshots/17-personal-confirm.png)

The confirmation lists every file and size. Files go to the macOS Trash, so they stay recoverable. On iCloud Desktop or Documents, macOS may use the iCloud Trash.

## Settings

![Settings](screenshots/06-settings.png)

- Language: English or Vietnamese.
- Open at login.
- Project folders and the large file threshold.
- Automatic cleanup: day, time and inactivity window.
- Personal file exclusions.
- Optional AI endpoint, model and API key.
- Update manifest URL.

## Exclusions

![Exclusions](screenshots/07-exclusions.png)

A repository can be excluded from the scheduled job in two ways:

- `Ignore auto-clean` on the repository in Projects.
- An absolute path in **Auto-clean exclusions**.

The job also skips repositories with uncommitted changes and repositories containing `.cachenookignore` (legacy `.macsweepignore` works too).

## History

![History](screenshots/08-history.png)

CacheNook records every cleanup, manual or scheduled, with the freed size and the number of folders. The summary shows this month and all time.

## Deep clean

![Deep clean](screenshots/09-deep-clean.png)

- Review the Trash in Finder before emptying it.
- Find old `.dmg`, `.pkg`, `.zip` and `.iso` files in Downloads.
- Delete Time Machine local snapshots.

Snapshot deletion can require administrator approval. The other actions use the Trash.

## Updates

![Updates](screenshots/11-updates.png)

Add a JSON manifest URL:

```json
{
  "version": "1.2.0",
  "url": "https://example.com/CacheNook-1.2.0.dmg",
  "notes": "What changed"
}
```

`Check` compares versions and shows the notes. It does not silently install an update; that needs a signed app and a signed feed.

![Update check](screenshots/12-update-check.png)

## Scheduled preview

![Scheduled preview](screenshots/13-stale-preview.png)

The weekly job can be previewed before it runs. The preview lists the exact folders, sizes and how long they have been inactive. `Clean now` asks once more, then runs the same scanner and removes only what is still stale.

## Vietnamese

![Cleanup in Vietnamese](screenshots/14-cleanup-vi.png)

The whole interface, menu bar and scheduled notification switch between English and Vietnamese.

## Safety

- Project roots must resolve inside the home folder.
- Symlinks are resolved and rejected if they leave the root.
- Dirty git repositories never reach the scheduler.
- Cache roots only lose their contents, not the folder itself.
- Large files, personal files and installers go through the Trash.
- Personal files are never removed without selecting them and confirming.
- Smart sort sends only metadata to the endpoint you configure, and only when you press it.
- No telemetry and no network requests during a scan.

## Terminal

The scheduled cleanup is also available without the UI:

```bash
npm run stale:preview
npm run stale:apply
```

For a full list of targets, see the [README](../README.md#features).
