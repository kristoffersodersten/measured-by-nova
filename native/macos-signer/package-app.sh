#!/bin/bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: package-app.sh BINARY OUTPUT_DIR VERSION BUILD" >&2
  exit 64
fi

binary="$1"
output_dir="$2"
version="$3"
build="$4"
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
app="$output_dir/Measured Publication Signer.app"

[[ -f "$binary" && -x "$binary" ]] || { echo "native_signer_binary_invalid" >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "native_signer_version_invalid" >&2; exit 1; }
[[ "$build" =~ ^[0-9]+$ ]] || { echo "native_signer_build_invalid" >&2; exit 1; }
[[ ! -e "$app" ]] || { echo "native_signer_output_exists" >&2; exit 1; }

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/measured-publication-signer"
sed -e "s/__VERSION__/$version/g" -e "s/__BUILD__/$build/g" "$script_dir/Info.plist.template" > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist" >/dev/null
chmod 0755 "$app/Contents/MacOS/measured-publication-signer"
printf 'APPL????' > "$app/Contents/PkgInfo"
echo "$app"
