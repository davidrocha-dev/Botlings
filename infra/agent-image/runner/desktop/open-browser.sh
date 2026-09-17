#!/usr/bin/env bash
# Opens the agent's browser through the runner, so the user and the agent share the same
# Chromium window and profile (launching Chromium directly would lock the profile).
# /browser/show is the only runner route accepted from inside the computer, without a token.
exec curl -fsS -X POST -H "Content-Type: application/json" -d '{}' http://127.0.0.1:8080/browser/show >/dev/null
