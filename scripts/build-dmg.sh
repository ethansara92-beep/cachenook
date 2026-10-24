#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
APP="dist/CacheNook-darwin-arm64/CacheNook.app"
DMG="dist/CacheNook-${VERSION}.dmg"

if [[ "${SKIP_PACK:-0}" != "1" ]]; then
  npm run pack
fi

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP" >&2
  exit 1
fi

# electron-packager can leave the bundle linker-signed without sealed
# resources. macOS then reports the app as damaged. Re-sign the whole bundle
# (ad-hoc by default, or SIGN_IDENTITY for a local development certificate)
# and verify the seal before shipping it.
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
echo "Signing with: $SIGN_IDENTITY"
codesign --force --deep --sign "$SIGN_IDENTITY" --identifier com.cachenook.app "$APP"
codesign --verify --deep --strict "$APP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "CacheNook" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

shasum -a 256 "$DMG" | tee "${DMG}.sha256"
echo "Built $DMG"
