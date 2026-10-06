#!/usr/bin/env bash
# Wrap the web extension in a macOS app so Loupe stays installed in Safari
# (temporary extensions are removed after 24 hours or when Safari quits).
#
# Run on a Mac with Xcode 26 or later:
#   ./scripts/build-safari-app.sh                 # unsigned build
#   DEVELOPMENT_TEAM=ABCDE12345 ./scripts/build-safari-app.sh   # signed with your team
#
# Unsigned builds need Safari Settings › Developer › "Allow unsigned extensions",
# which Safari turns off again on every launch. A build signed with your Apple ID
# team (a free Personal Team works) stays enabled.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="Loupe SEO"
BUNDLE_ID="${BUNDLE_ID:-ca.agenceflores.loupe-seo}"
OUT="build/safari"

if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  TOOL=safari-web-extension-packager
else
  TOOL=safari-web-extension-converter
fi

rm -rf "$OUT"
xcrun "$TOOL" extension \
  --project-location "$OUT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

PROJECT="$(find "$OUT" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
echo "Xcode project: $PROJECT"

# The packager names the app target's bundle id after --app-name
# (ca.agenceflores.Loupe-SEO) but gives the extension the id we passed
# (ca.agenceflores.loupe-seo.Extension). xcodebuild then refuses to embed an
# extension whose id is not prefixed by its app's. Give the app our id, then
# check that every target's id is ours or starts with it.
PBXPROJ="$PROJECT/project.pbxproj"
sed -i '' -E "/PRODUCT_BUNDLE_IDENTIFIER = /{/\.Extension\"?;/!s/(PRODUCT_BUNDLE_IDENTIFIER = ).*;/\1\"$BUNDLE_ID\";/;}" "$PBXPROJ"
while IFS= read -r id; do
  case "$id" in
    "$BUNDLE_ID" | "$BUNDLE_ID".*) ;;
    *) echo "Bundle id $id does not start with $BUNDLE_ID in $PBXPROJ" >&2; exit 1 ;;
  esac
done < <(sed -nE 's/.*PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;.*/\1/p' "$PBXPROJ" | sort -u)

SIGNING=()
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  SIGNING=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
else
  SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO)
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$OUT/DerivedData" \
  "${SIGNING[@]}" \
  build

APP="$OUT/DerivedData/Build/Products/Release/$APP_NAME.app"
echo
echo "Built: $APP"

# Install a copy in /Applications (override with INSTALL_DIR) so the extension
# survives a clean of build/, then unregister the build copy so Safari lists
# the extension once.
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
INSTALLED="$INSTALL_DIR/$APP_NAME.app"
osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
rm -rf "$INSTALLED"
ditto "$APP" "$INSTALLED"
pluginkit -r "$APP/Contents/PlugIns/$APP_NAME Extension.appex" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" >/dev/null 2>&1 || true
echo "Installed: $INSTALLED"
echo "Opening it once registers the extension. Then enable it in Safari Settings › Extensions."
open "$INSTALLED"
