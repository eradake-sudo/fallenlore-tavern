#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — add your XAI_API_KEY before the DM can speak."
fi
python3 app.py
