#!/bin/bash
# Git polling による自動デプロイ
# mainブランチに新しいコミットがあれば deploy.sh を実行

APP_DIR="$HOME/discord-music-app"
LOCK_FILE="/tmp/discord-music-bot-deploy.lock"
LOG_FILE="$APP_DIR/deploy.log"
export PATH="$HOME/.local/bin:$PATH"

# 二重実行防止
if [ -f "$LOCK_FILE" ]; then
    exit 0
fi
touch "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

cd "$APP_DIR" || exit 1

# リモートの最新情報を取得
git fetch origin main --quiet 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] New commit detected: $REMOTE" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploying..." >> "$LOG_FILE"

# backend/ に変更があるかチェック
CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")
if echo "$CHANGED_FILES" | grep -q "^backend/"; then
    bash "$APP_DIR/deploy.sh" >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy completed (exit: $?)" >> "$LOG_FILE"
else
    # backend以外の変更のみ → git pullだけ
    git reset --hard origin/main >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Non-backend change, pulled only" >> "$LOG_FILE"
fi
