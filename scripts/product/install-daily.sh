#!/bin/bash
# Install a daily user-level launchd job; no running web server required.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then echo "macOS launchd is required" >&2; exit 1; fi
LABEL="works.robin.product-opportunities"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL; saved opportunities are untouched."
  exit 0
fi
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$(command -v node)"
LOGS="${ROBIN_DATA_DIR:-$HOME/.pi/robin}/logs"
mkdir -p "$(dirname "$PLIST")" "$LOGS"
# Escape filesystem paths interpolated into XML; no shell runs on a scheduled tick.
xml() { local value="$1"; value="${value//&/\&amp;}"; value="${value//</\&lt;}"; value="${value//>/\&gt;}"; printf '%s' "$value"; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$(xml "$NODE")</string><string>$(xml "$REPO/scripts/product/daily.mjs")</string></array>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
<key>StandardOutPath</key><string>$(xml "$LOGS/opportunities.log")</string>
<key>StandardErrorPath</key><string>$(xml "$LOGS/opportunities.err.log")</string>
$(if [[ -n "${ROBIN_DATA_DIR:-}" ]]; then printf '<key>EnvironmentVariables</key><dict><key>ROBIN_DATA_DIR</key><string>%s</string></dict>' "$(xml "$ROBIN_DATA_DIR")"; fi)
</dict></plist>
EOF
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
echo "Installed $LABEL: daily at 09:00 local time, including when pi-web is closed."
