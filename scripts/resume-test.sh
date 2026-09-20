#!/bin/bash
# デプロイ跨ぎレジュームの実機テスト（テストサーバー限定）
#   join → 2曲追加 → 再生 → 40秒後に bot 再起動 → join → 同じ曲の途中から再開するか
# usage: bash scripts/resume-test.sh
set -u
API="${API_BASE:-https://api.atoriba.jp}"
G="${TEST_GUILD_ID:-1080511818658762752}"; CH="${TEST_CHANNEL_ID:-1080511819103346828}"
PI="als0028@192.168.11.13"; KEY="$HOME/.ssh/id_rsa_pi"
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "OK   $1"; }; ng(){ fail=$((fail+1)); echo "FAIL $1"; }
state(){ curl -s -m 15 "$API/player-state/$G" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(((d.get("current_track") or {}).get("title") or "-")+"|"+",".join(q["track"]["title"] for q in d["queue"] if not q.get("isCurrent"))+"|"+str(d["is_playing"]))'; }
add(){ curl -s -m 20 -X POST "$API/add-url/$G" -H 'content-type: application/json' -d "{\"url\":\"$1\",\"user\":{\"id\":\"0\",\"name\":\"resume-test\",\"image\":\"\"}}" >/dev/null; }

if curl -s -m 10 "$API/bot-voice-status/$G" | grep -q '"channel_id":"'; then
  curl -s -m 20 -X POST "$API/disconnect-voice-channel/$G" >/dev/null; sleep 2
fi
curl -s -m 20 -X POST "$API/join-voice-channel/$G/$CH" | grep -q Joined && ok "join" || ng "join"
add "https://music.youtube.com/watch?v=by4SYYWlhEs"; add "https://music.youtube.com/watch?v=m9SMT5ipbxk"
for i in $(seq 1 30); do s=$(state); [[ "$s" == *"|True" ]] && break; sleep 3; done
[[ "$s" == 夜に駆ける\|アイドル\|True ]] && ok "再生中: $s" || ng "再生状態が想定外: $s"
T0=$(date +%s); sleep 40
ssh -i "$KEY" "$PI" "sudo systemctl restart discord-music-bot"
until curl -s -m 10 "$API/bot-guilds" 2>/dev/null | grep -q '"id"'; do sleep 5; done
sleep 3
ssh -i "$KEY" "$PI" "journalctl -u discord-music-bot --since '3 minutes ago' --no-pager | grep -q 'プレイヤー状態を保存'" && ok "再起動時に状態を保存" || ng "再起動時の保存ログなし"
curl -s -m 20 -X POST "$API/join-voice-channel/$G/$CH" >/dev/null
for i in $(seq 1 20); do s=$(state); [[ "$s" == *"|True" ]] && break; sleep 3; done
log=$(ssh -i "$KEY" "$PI" "journalctl -u discord-music-bot --since '2 minutes ago' --no-pager | grep -E '保存済みキューを復元|再生位置レジューム' | grep -v INFO:app | tail -2")
echo "$log" | sed 's/^/     /'
echo "$log" | grep -q '保存済みキューを復元: 2曲' && ok "2曲復元" || ng "復元件数が想定外"
off=$(echo "$log" | grep -oE 'レジューム: .*\(([0-9]+)秒' | grep -oE '[0-9]+秒' | tr -d '秒')
[[ -n "${off:-}" && "$off" -ge 30 && "$off" -le 90 ]] && ok "再生位置レジューム ${off}秒（期待 40±）" || ng "レジューム位置が想定外: '${off:-none}'"
[[ "$s" == 夜に駆ける\|アイドル\|True ]] && ok "再起動後も同じ曲・同じキュー: $s" || ng "再起動後の状態が想定外: $s"
curl -s -m 20 -X POST "$API/disconnect-voice-channel/$G" >/dev/null; sleep 1
ssh -i "$KEY" "$PI" "cd ~/discord-music-app/backend && .venv/bin/python -c \"import sqlite3;print(sqlite3.connect('uploaded_songs.db').execute('select count(*) from player_state where guild_id=?',('$G',)).fetchone()[0])\"" | grep -q '^0$' && ok "切断で保存状態クリア" || ng "切断後も保存状態が残っている"
echo; echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
