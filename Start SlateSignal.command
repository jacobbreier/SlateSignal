#!/bin/zsh
cd "$(dirname "$0")"

if [ -f "config.env" ]; then
  set -a
  source "config.env"
  set +a
fi

if command -v node >/dev/null 2>&1; then
  if [ -z "$THE_ODDS_API_KEY" ]; then
    echo "Starting SlateSignal without sportsbook odds."
    echo "Paste a The Odds API key into config.env to show DraftKings/FanDuel odds."
  else
    echo "Starting SlateSignal with DraftKings/FanDuel odds."
  fi
  node server.js
elif [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  if [ -z "$THE_ODDS_API_KEY" ]; then
    echo "Starting SlateSignal without sportsbook odds."
    echo "Paste a The Odds API key into config.env to show DraftKings/FanDuel odds."
  else
    echo "Starting SlateSignal with DraftKings/FanDuel odds."
  fi
  /Applications/Codex.app/Contents/Resources/node server.js
else
  echo "Node.js is not installed."
  echo "Install Node.js from https://nodejs.org, then run this file again."
  read "?Press Enter to close."
fi
