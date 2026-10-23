# Privacy

CacheNook is local only.

- No telemetry, analytics, crash reporting or user accounts.
- No network request is made during a scan or cleanup.
- The only network request is an update check, and only when you configure an update manifest URL and press **Check**.
- The update check fetches a JSON manifest and compares versions. It never uploads your data.
- Configuration, history and logs stay on your Mac.
- Full Disk Access is used only to read and clean the folders you selected.

Uninstalling the app does not remove your config or logs. Delete these folders if you want a clean removal:

```bash
rm -rf ~/Library/Application\ Support/CacheNook
rm -rf ~/Library/Logs/CacheNook
rm -f ~/Library/LaunchAgents/com.cachenook.stale-clean.plist
```
