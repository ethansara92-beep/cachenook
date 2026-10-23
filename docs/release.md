# Release

## Build

```bash
npm ci
npm test
npm run check
npm run pack
npm run dmg
```

The DMG is written to `dist/CacheNook-<version>.dmg` with a SHA-256 file next to it.

## Signed and notarized release

You need a paid Apple Developer account and a **Developer ID Application** certificate. Set:

```bash
export DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

Import the certificate into a temporary keychain, then:

```bash
# Sign the app. Do this before building the DMG.
codesign --force --deep --options runtime \
  --sign "$DEVELOPER_ID_APPLICATION" \
  dist/CacheNook-darwin-arm64/CacheNook.app

codesign --verify --deep --strict --verbose=2 \
  dist/CacheNook-darwin-arm64/CacheNook.app

# Build the DMG without repacking over the signed app.
SKIP_PACK=1 bash scripts/build-dmg.sh

# Notarize and staple.
xcrun notarytool submit "dist/CacheNook-$(node -p "require('./package.json').version").dmg" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait

xcrun stapler staple "dist/CacheNook-$(node -p "require('./package.json').version").dmg"
```

## GitHub release

The release workflow is manual (`workflow_dispatch`) and builds an unsigned DMG unless the signing secrets are configured:

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `DEVELOPER_ID_APPLICATION`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Store them under Settings > Secrets and variables > Actions.

## Version

Update `version` in `package.json`, commit, then create a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 dist/CacheNook-1.0.0.dmg dist/CacheNook-1.0.0.dmg.sha256
```

The app's update checker can use a manifest hosted anywhere, for example:

```json
{
  "version": "1.0.1",
  "url": "https://example.com/CacheNook-1.0.1.dmg",
  "notes": "Security and cleanup fixes"
}
```
