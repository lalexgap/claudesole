#!/bin/bash
# Generates build/icon.icns from build/icon.svg
# Requires: macOS (uses sips + iconutil, both built-in)
# Optional: brew install librsvg  (for better SVG rendering)

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVG="$ROOT/build/icon.svg"
ICONSET="$ROOT/build/icon.iconset"
MASTER="$ROOT/build/icon_master.png"

mkdir -p "$ICONSET"

echo "→ Converting SVG to PNG..."

if command -v rsvg-convert &>/dev/null; then
  rsvg-convert -w 1024 -h 1024 "$SVG" -o "$MASTER"
elif command -v convert &>/dev/null; then
  convert -background none -size 1024x1024 "$SVG" "$MASTER"
else
  # macOS Quick Look fallback
  TMP=$(mktemp -d)
  qlmanage -t -s 1024 -o "$TMP" "$SVG" >/dev/null 2>&1
  PNG=$(find "$TMP" -name "*.png" | head -1)
  if [ -z "$PNG" ]; then
    echo "✗ SVG conversion failed."
    echo "  Install librsvg for best results:  brew install librsvg"
    rm -rf "$TMP"
    exit 1
  fi
  cp "$PNG" "$MASTER"
  rm -rf "$TMP"
fi

echo "→ Generating iconset sizes..."

# Standard macOS icon sizes: 16 32 128 256 512 and their @2x variants
declare -a SIZES=(16 32 128 256 512)
for SIZE in "${SIZES[@]}"; do
  sips -z $SIZE $SIZE        "$MASTER" --out "$ICONSET/icon_${SIZE}x${SIZE}.png"      >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z $DOUBLE $DOUBLE    "$MASTER" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png"   >/dev/null
done

echo "→ Creating .icns..."
iconutil -c icns "$ICONSET" -o "$ROOT/build/icon.icns"

# Cleanup intermediates
rm -rf "$ICONSET" "$MASTER"

echo "✓ Done: build/icon.icns"
