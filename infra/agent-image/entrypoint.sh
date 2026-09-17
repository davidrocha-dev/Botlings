#!/usr/bin/env bash
# Container entrypoint. Starts as root only to install the network firewall, then permanently
# drops to the "botling" user with no capabilities (they cannot be regained: no-new-privileges
# and an empty bounding set).
set -euo pipefail

if ! /usr/local/bin/firewall.sh; then
  echo "[entrypoint] could not apply the network firewall; refusing to start" >&2
  exit 1
fi

exec setpriv --reuid=botling --regid=botling --init-groups \
  --inh-caps=-all --bounding-set=-all \
  env HOME=/home/botling USER=botling LOGNAME=botling \
  /usr/local/bin/start-desktop.sh
