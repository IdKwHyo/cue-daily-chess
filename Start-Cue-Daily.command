#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Cue Daily needs Node.js 22 or newer. Install it from https://nodejs.org, then reopen this launcher.'
  read -r -p 'Press Enter to close.' _cue_reply
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Please update Node.js to version 22 or newer.'
  exit 1
fi
if [ ! -d node_modules/electron/dist ]; then
  npm ci
fi
npm start
