#!/bin/bash
set -e

APP_DIR="$HOME/discord-music-app"
SERVICE_NAME="discord-music-bot"

echo "[deploy] Pulling latest code..."
cd "$APP_DIR"
git fetch origin main

LOCAL_HASH="$(git rev-parse HEAD)"
REMOTE_HASH="$(git rev-parse origin/main)"

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
  echo "[deploy] No remote updates. Local hash matches origin/main: $LOCAL_HASH"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy] Local repository has uncommitted changes. Skip auto-reset to avoid overwrite."
  echo "$REMOTE_HASH available on origin/main"
  exit 1
fi

git reset --hard origin/main

echo "[deploy] Installing dependencies..."
export PATH="$HOME/.local/bin:$PATH"
cd backend
uv sync --frozen

echo "[deploy] Restarting service..."
sudo systemctl restart "$SERVICE_NAME"

echo "[deploy] Waiting for startup..."
sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "[deploy] Deploy successful! Service is running."
else
    echo "[deploy] Service failed to start. Checking logs..."
    journalctl -u "$SERVICE_NAME" --no-pager -n 20
    exit 1
fi
