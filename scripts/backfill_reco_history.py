#!/usr/bin/env python3
"""ドデカのおすすめ（reco）の過去分: すべてのテキストチャンネルの履歴から、曲のリンク（YouTube / ニコニコ）を reco_events に入れる。

Pi 上で 1 回だけ実行する（読み取りのみ。DB は backend/uploaded_songs.db。動いている web/voice と同時でよい）:
  cd ~/discord-music-app/backend && set -a && . ./.env && set +a && \
  .venv/bin/python ../scripts/backfill_reco_history.py 1093915551174234212

- 本文は保存しない（どの曲が・いつ・どのチャンネルに・誰に貼られたかだけ。名前は表示のときに今のメンバー一覧から引く）
- bot の投稿と NSFW チャンネルは対象外
- bot チャンネル（IRINA_RECO_QUEUE_CHANNELS、既定はドデカの bot 専用）への貼り付けは kind=queue（2024 年は貼るとキューに入った）
- 何度実行しても同じ（ref = msg:<message_id>:<key> で重複しない。shared_links から写す分とも同じ ref）
"""
import os
import sys
import time

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.reco import links, sources, store  # noqa: E402

API = "https://discord.com/api/v10"


def get(s: requests.Session, path: str, **params):
    for _ in range(8):
        r = s.get(API + path, params=params, timeout=30)
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 1)) + 0.3)
            continue
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"rate limited: {path}")


def main() -> None:
    guild = sys.argv[1]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bot {os.environ['DISCORD_TOKEN']}", "User-Agent": "DiscordBot (irina reco backfill, 1.0)"})
    store.init()
    chans = [c for c in (get(s, f"/guilds/{guild}/channels") or []) if c.get("type") in (0, 2, 5) and not c.get("nsfw")]
    chans += (get(s, f"/guilds/{guild}/threads/active") or {}).get("threads", [])
    total = 0
    for ch in chans:
        rows = []
        last = 0
        n_msgs = 0
        while True:
            batch = get(s, f"/channels/{ch['id']}/messages", limit=100, after=last)
            if not batch:
                break
            batch.sort(key=lambda m: int(m["id"]))
            for m in batch:
                n_msgs += 1
                a = m.get("author") or {}
                if a.get("bot"):
                    continue
                text = (m.get("content") or "") + " " + " ".join(e.get("url") or "" for e in m.get("embeds") or [])
                for k in links.find_keys(text):
                    rows.append({"guild_id": guild, "key": k, "kind": sources.post_kind(ch["id"]), "user_id": a.get("id"),
                                 "at": m["timestamp"], "channel_id": ch["id"], "ref": f"msg:{m['id']}:{k}"})
            last = int(batch[-1]["id"])
            if len(batch) < 100:
                break
        if rows:
            store.ensure_tracks(r["key"] for r in rows)
        added = store.add_events(rows)
        total += added
        if rows:
            print(f"#{ch.get('name')}: messages {n_msgs}, links {len(rows)}, new {added}")
    print(f"done: {total} new events")


if __name__ == "__main__":
    main()
