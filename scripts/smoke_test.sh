#!/bin/bash
# 本番スモークテスト: デプロイ後に毎回実行する
# usage: bash scripts/smoke_test.sh [API_BASE]
API="${1:-https://api.atoriba.jp}"
PI="als0028@192.168.11.13"
KEY="$HOME/.ssh/id_rsa_pi"
fail=0

check() {  # check <名前> <期待コード> <URL> [<本文に含まれるべき文字列>]
  body=$(curl -s -m 30 -w '\n%{http_code}' "$3")
  code=$(echo "$body" | tail -n1)
  content=$(echo "$body" | sed '$d')
  if [ "$code" != "$2" ]; then echo "FAIL $1 (got $code, want $2) ${content:0:120}"; fail=1; return; fi
  if [ -n "$4" ] && ! echo "$content" | grep -q "$4"; then echo "FAIL $1 (code ok, body lacks '$4') ${content:0:120}"; fail=1; return; fi
  echo "OK   $1 ($code)"
}

check "health"           200 "$API/"                                   '"status":"ok"'
check "bot-guilds"       200 "$API/bot-guilds"                         '"id"'
check "search all"       200 "$API/search?query=YOASOBI"               '"type":"song"'
check "search songs"     200 "$API/search?query=YOASOBI&filter=songs"  '"type":"song"'
check "search albums"    200 "$API/search?query=YOASOBI&filter=albums" '"type":"album"'
check "search artists"   200 "$API/search?query=YOASOBI&filter=artists" '"type":"artist"'
check "search playlists" 200 "$API/search?query=YOASOBI&filter=playlists" '"type":"playlist"'
check "related"          200 "$API/related/dQw4w9WgXcQ"                '"type":"song"'
check "recommendations"  200 "$API/recommendations"                    '"contents"'
check "mood-categories"  200 "$API/mood-categories"                    'params'
check "player-state"     200 "$API/player-state/1093915551174234212"  '"has_player"'
check "history"          200 "$API/history/1093915551174234212?limit=3"
check "history-stats"    200 "$API/history-stats/1093915551174234212"  '"total_plays"'
check "frontend"         200 "https://discord-music-app.vercel.app/"

# ルートの欠落検知（編集ミスでエンドポイントが消えていないか）
paths=$(curl -s -m 15 "$API/openapi.json" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin)["paths"].keys())))' 2>/dev/null)
for must in /bot-guilds /uploaded-audio-list/{guild_id} /add-url/{guild_id} /join-voice-channel/{guild_id}/{channel_id} /player-state/{guild_id} /history/{guild_id} /history-stats/{guild_id} /search /related/{video_id} /disconnect-voice-channel/{guild_id}; do
  if echo "$paths" | grep -q -- "$must"; then :; else echo "FAIL route missing: $must"; fail=1; fi
done
echo "OK   routes ($(echo "$paths" | wc -w) paths)"

echo "--- Pi service / recent errors (5 min) ---"
if [ -f "$KEY" ]; then
  ssh -i "$KEY" -o ConnectTimeout=10 "$PI" \
    "systemctl is-active discord-music-bot; journalctl -u discord-music-bot --since '5 minutes ago' --no-pager | grep -E 'ERROR|Traceback|500 Internal' | tail -5; true"
fi

if [ $fail -eq 0 ]; then echo "SMOKE TEST PASSED"; else echo "SMOKE TEST FAILED"; exit 1; fi
