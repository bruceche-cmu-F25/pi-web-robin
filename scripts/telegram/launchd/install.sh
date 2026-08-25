#!/bin/bash
#
# Install the Robin services as launchd user agents.
#
# The bridge is an always-on process whose failure is silent: when it dies, the
# briefings, the reminders and the replies all stop, and nothing says so. That
# is the gap this closes — `KeepAlive` restarts it, and the logs say why.
#
# User agents, never daemons: these run as you, need your login keychain and
# your home directory, and have no business running before you log in.
#
#   ./install.sh              # the bridge only (assumes you run pi-web yourself)
#   ./install.sh --with-pi-web   # supervise pi-web too, via the published CLI
#   ./install.sh --uninstall     # remove both
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$REPO/scripts/telegram/launchd"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="${ROBIN_DATA_DIR:-$HOME/.pi/robin}/logs"

BRIDGE_LABEL="works.robin.bridge"
PIWEB_LABEL="works.robin.pi-web"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "launchd is macOS only. On Linux, the same two units work as systemd" >&2
  echo "user services with Restart=always." >&2
  exit 1
fi

uninstall_one() {
  local label="$1"
  local plist="$AGENTS/$label.plist"
  if [[ -f "$plist" ]]; then
    # `bootout` on a service that is not loaded exits non-zero; that is fine.
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "removed $label"
  fi
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall_one "$BRIDGE_LABEL"
  uninstall_one "$PIWEB_LABEL"
  echo "Done. Your data in ${ROBIN_DATA_DIR:-$HOME/.pi/robin} is untouched."
  exit 0
fi

NODE="$(command -v node || true)"
NPX="$(command -v npx || true)"
if [[ -z "$NODE" ]]; then
  echo "node is not on PATH. Install Node 22.19.0 or newer first." >&2
  exit 1
fi

# launchd hands a service a bare PATH, so node's own directory has to be named
# explicitly or nothing it shells out to will resolve.
SERVICE_PATH="$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$AGENTS" "$LOGS"

render() {
  local template="$1" out="$2" label="$3"
  sed \
    -e "s|__LABEL__|$label|g" \
    -e "s|__REPO__|$REPO|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__NPX__|$NPX|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__LOGS__|$LOGS|g" \
    -e "s|__PATH__|$SERVICE_PATH|g" \
    "$template" > "$out"
}

load_one() {
  local label="$1" plist="$AGENTS/$label.plist"
  # Boot it out first: `bootstrap` refuses a label that is already loaded, so a
  # re-run of this script would otherwise fail rather than update.
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/$label"
  echo "loaded $label"
}

render "$HERE/works.robin.bridge.plist.template" "$AGENTS/$BRIDGE_LABEL.plist" "$BRIDGE_LABEL"
load_one "$BRIDGE_LABEL"

if [[ "${1:-}" == "--with-pi-web" ]]; then
  if [[ -z "$NPX" ]]; then
    echo "npx is not on PATH; skipping the pi-web service." >&2
  else
    render "$HERE/works.robin.pi-web.plist.template" "$AGENTS/$PIWEB_LABEL.plist" "$PIWEB_LABEL"
    load_one "$PIWEB_LABEL"
  fi
fi

cat <<INFO

Installed. Useful commands:

  launchctl print gui/$(id -u)/$BRIDGE_LABEL   # state, exit code, last run
  tail -f $LOGS/bridge.log                     # what it is doing
  tail -f $LOGS/bridge.err.log                 # why it stopped
  $HERE/install.sh --uninstall                 # remove

The bridge needs pi-web reachable at \$PI_WEB_URL (default
http://127.0.0.1:30141). Send /status to your bot to check both from the phone.
INFO
