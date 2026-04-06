#!/bin/bash
set -e

APP_DIR="$HOME/discord-music-app"
SERVICE_NAME="discord-music-bot"

echo "[deploy] Pulling latest code..."
cd "$APP_DIR"
git fetch origin main
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
