#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  umask 077
  app_key=$(openssl rand -hex 32)
  setup_key=$(openssl rand -hex 24)
  cat > .env <<EOF
APP_SECRET=$app_key
SETUP_TOKEN=$setup_key
PORT=4318
COOKIE_SECURE=false
EOF
fi
docker compose up --build -d app
echo "Open http://localhost:4318 and initialize the administrator with SETUP_TOKEN from .env."
