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

if git merge-base --is-ancestor "$REMOTE_HASH" "$LOCAL_HASH"; then
  echo "[deploy] Local is ahead of origin/main (un-pushed changes exist). Skip auto-update."
  echo "[deploy] Local:  $LOCAL_HASH"
  echo "[deploy] Remote: $REMOTE_HASH"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy] Local repository has uncommitted changes. Skip auto-reset to avoid overwrite."
  echo "$REMOTE_HASH available on origin/main"
  exit 1
fi

git reset --hard origin/main
NEW_HASH="$(git rev-parse HEAD)"

echo "[deploy] Installing dependencies..."
export PATH="$HOME/.local/bin:$PATH"
cd backend
uv sync --frozen

# --- どのプロセスを再起動するか（無停止アップデート②） ---
# Pi では voice プロセス（discord-music-bot: bot + MusicPlayer, :8081）と
# web プロセス（discord-music-web: 公開 API :8080, bot 依存ルートは voice へ中継）に分かれている。
# 音声に関係するファイルが変わった時だけ voice を再起動し（＝数秒無音→レジューム）、
# それ以外の backend 変更は web だけ再起動する（音楽は止まらない）。
# 例外: コミットメッセージに [restart-voice] があれば voice も再起動する。
WEB_SERVICE="discord-music-web"
VOICE_PATTERN='^backend/(app/(bot\.py|services/|db\.py|config\.py|logging\.py|api/voice\.py|__init__\.py)|pyproject\.toml|uv\.lock)'
CHANGED_FILES="$(git diff --name-only "$LOCAL_HASH" "$NEW_HASH")"
restart_voice=0
if echo "$CHANGED_FILES" | grep -Eq "$VOICE_PATTERN"; then restart_voice=1; fi
if git log --format=%B "$LOCAL_HASH".."$NEW_HASH" | grep -q '\[restart-voice\]'; then restart_voice=1; fi

if systemctl is-enabled --quiet "$WEB_SERVICE" 2>/dev/null; then
    services_to_restart="$WEB_SERVICE"
    if [ "$restart_voice" = 1 ]; then services_to_restart="$SERVICE_NAME $WEB_SERVICE"; fi
else
    # 分割前（単一プロセス）の構成: 従来どおり bot サービスだけ
    services_to_restart="$SERVICE_NAME"
fi
echo "[deploy] Changed files:"; echo "$CHANGED_FILES" | sed 's/^/[deploy]   /'
echo "[deploy] Restarting: $services_to_restart (voice restart needed: $restart_voice)"
for svc in $services_to_restart; do
    sudo systemctl restart "$svc"
done

echo "[deploy] Waiting for startup..."
sleep 3
ok=1
for svc in $services_to_restart; do
    if systemctl is-active --quiet "$svc"; then
        echo "[deploy] $svc is running."
    else
        echo "[deploy] $svc failed to start. Checking logs..."
        journalctl -u "$svc" --no-pager -n 20
        ok=0
    fi
done
if [ "$ok" = 1 ]; then
    echo "[deploy] Deploy successful!"
else
    exit 1
fi
