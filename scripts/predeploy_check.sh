#!/bin/bash
# backend を deploy（= bot 再起動）する前に、誰かが再生中でないかを確認する
# usage: bash scripts/predeploy_check.sh   → 再生中のギルドがあれば exit 1
API="${1:-https://api.atoriba.jp}"
busy=0
for gid in $(curl -s -m 15 "$API/bot-guilds" | python3 -c 'import json,sys; print(" ".join(g["id"] for g in json.load(sys.stdin)))'); do
  if ! curl -s -m 15 "$API/player-state/$gid" | python3 -c '
import json,sys
gid=sys.argv[1]; d=json.load(sys.stdin)
if d.get("has_player"):
    cur=(d.get("current_track") or {}).get("title")
    q=len([x for x in d.get("queue",[]) if not x.get("isCurrent")])
    print("BUSY  guild=%s playing=%s current=%r queue=%d" % (gid, d.get("is_playing"), cur, q))
    sys.exit(1)
' "$gid"; then busy=1; fi
done
if [ $busy -eq 1 ]; then echo "→ 再生中のギルドがあります。deploy（bot再起動）は待ってください"; exit 1; fi
echo "OK: 再生中のギルドなし。deploy して問題ありません"
