#!/usr/bin/env python3
"""「棚」の過去分バックフィル: テキストチャンネルの履歴から YouTube リンクだけを shared_links に入れる。

Pi 上で 1 回だけ実行する（DB は backend/uploaded_songs.db。voice/web プロセスが動いていても WAL なので同時アクセス可）:
  cd ~/discord-music-app/backend && set -a && . ./.env && set +a && \
  .venv/bin/python ../scripts/backfill_shared_links.py 1093915551174234212 --days 90

- bot 専用チャンネル（IRINA_CHAT_CHANNEL_IDS / irina_chat の既定）と bot の投稿は対象外
- メッセージ本文は保存しない（URL・動画ID・投稿者・時刻・チャンネルのみ）
- タイトル等の解決は voice プロセスの resolver（10 分ごと）が後追いで行う
"""
import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app import db  # noqa: E402
from app.services.shared_links import extract_video_ids  # noqa: E402
from app.services import irina_chat  # noqa: E402

API = "https://discord.com/api/v10"


def snowflake_after(dt: datetime) -> int:
    return ((int(dt.timestamp() * 1000) - 1420070400000) << 22)


def get(session: requests.Session, path: str, **params):
    for _ in range(5):
        r = session.get(API + path, params=params, timeout=30)
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 1)) + 0.2)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"rate limited: {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("guild_id")
    ap.add_argument("--days", type=int, default=90)
    args = ap.parse_args()
    token = os.environ["DISCORD_TOKEN"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bot {token}", "User-Agent": "DiscordBot (irina backfill, 1.0)"})

    db.init_db()
    skip_ids = irina_chat._chat_channel_ids()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    after_id = snowflake_after(since)
    channels = [c for c in get(s, f"/guilds/{args.guild_id}/channels") if c.get("type") in (0, 2) and int(c["id"]) not in skip_ids]
    total_msgs = total_links = 0
    for ch in channels:
        last = after_id
        n_msgs = n_links = 0
        while True:
            try:
                batch = get(s, f"/channels/{ch['id']}/messages", limit=100, after=last)
            except requests.HTTPError as e:
                print(f"  skip #{ch['name']}: {e.response.status_code}")
                break
            if not batch:
                break
            batch.sort(key=lambda m: int(m["id"]))
            for m in batch:
                n_msgs += 1
                if m.get("author", {}).get("bot"):
                    continue
                ids = extract_video_ids(m.get("content") or "")
                if not ids:
                    continue
                a = m["author"]
                avatar = f"https://cdn.discordapp.com/avatars/{a['id']}/{a['avatar']}.png" if a.get("avatar") else ""
                name = (m.get("member") or {}).get("nick") or a.get("global_name") or a.get("username")
                for vid in ids:
                    if db.add_shared_link(
                        guild_id=args.guild_id, channel_id=ch["id"], channel_name=ch["name"], message_id=m["id"], video_id=vid,
                        url=f"https://www.youtube.com/watch?v={vid}", posted_by_id=a["id"], posted_by_name=name, posted_by_image=avatar,
                        posted_at=m["timestamp"],
                    ):
                        n_links += 1
            last = int(batch[-1]["id"])
            if len(batch) < 100:
                break
        if n_links:
            print(f"  #{ch['name']}: {n_msgs} msgs → {n_links} links")
        total_msgs += n_msgs
        total_links += n_links
    print(f"done: {len(channels)} channels, {total_msgs} messages scanned, {total_links} links saved (last {args.days} days)")


if __name__ == "__main__":
    main()
