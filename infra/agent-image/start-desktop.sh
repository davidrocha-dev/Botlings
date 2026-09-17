#!/usr/bin/env bash
# Runs as the unprivileged "botling" user: virtual display, window manager, VNC bridge and the
# control API.
set -euo pipefail

mkdir -p "$HOME/workspace" "$HOME/.botlings"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

# Only the runner gets the control token; desktop programs (and anything started from them) do not.
TOKEN="$BOTLINGS_RUNNER_TOKEN"
unset BOTLINGS_RUNNER_TOKEN

Xvfb :1 -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp &
for _ in $(seq 1 50); do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.1; done

# Window manager config is rewritten on every boot so image updates reach existing home volumes.
mkdir -p "$HOME/.fluxbox"
cp /opt/runner/desktop/fluxbox-menu "$HOME/.fluxbox/menu"
cp /opt/runner/desktop/fluxbox-init "$HOME/.fluxbox/init"
# "background: none" stops fluxbox from calling fbsetbg (which pops up a warning).
echo "background: none" > "$HOME/.fluxbox/overlay"
xsetroot -solid "#16161d"

fluxbox >/dev/null 2>&1 &
# VNC is only reachable inside the container; websockify/noVNC is the published port.
x11vnc -display :1 -forever -shared -nopw -localhost -rfbport 5900 -quiet >/dev/null 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

BOTLINGS_RUNNER_TOKEN="$TOKEN" exec node /opt/runner/server.mjs
