"""ドデカが曲に触れた記録を reco_events に集める（同期関数。呼ぶ側は asyncio.to_thread で）。

- play: イリーナで流れた曲（play_history）
- post: Discord のテキストチャンネルに貼られた曲（shared_links。過去分は scripts/backfill_reco_history.py が全チャンネルから）
- queue: 2024 年の bot チャンネル（URL を貼るとキューに入った時代）に貼られた曲。全員で聴いた曲なので「懐かしい」の芯
- box: アプリの曲置き箱
- skip: イリーナで流れて 30 秒以内に飛ばされた（その曲を 30 日出さず、アーティストを少し下げる）
ref は出どころごとに一意（"play:<id>" / "msg:<message_id>:<key>" / "box:<id>"）。同じものは二重に入らない
"""
import os
from typing import Any, Dict, List, Optional

from .. import db
from . import links, store

# URL を貼るとキューに入った時代の bot チャンネル（ドデカ）。ここへの貼り付けは「流した」と同じ重み
QUEUE_CHANNELS = {x.strip() for x in (os.getenv("IRINA_RECO_QUEUE_CHANNELS") or "1156255909446680676").split(",") if x.strip()}
SHELF_CHANNELS = {x.strip() for x in (os.getenv("IRINA_PUSH_SHELF_CHANNEL_IDS") or "1426606582606860428").split(",") if x.strip()}


def key_from_play(video_id: Optional[str], url: Optional[str]) -> Optional[str]:
    """play_history の 1 行 → key。ニコニコは video_id が空で記録されるので URL から読む"""
    keys = links.find_keys(url or "")
    if keys:
        return keys[0]
    v = (video_id or "").strip()
    if v[:2] in ("sm", "nm", "so") and v[2:].isdigit():
        return "nico:" + v
    if len(v) == 11:
        return "yt:" + v
    return None


def post_kind(channel_id: Optional[str]) -> str:
    return "queue" if channel_id in QUEUE_CHANNELS else "post"


def sync(guild_id: str) -> int:
    """play_history と shared_links の新しい行を reco_events に写す"""
    rows: List[Dict[str, Any]] = []
    last_play = int(store.kv_get(f"sync_play:{guild_id}") or 0)
    last_link = int(store.kv_get(f"sync_link:{guild_id}") or 0)
    with db._connect() as c:
        plays = c.execute("SELECT id, video_id, url, added_by_id, added_by_name, played_at FROM play_history "
                          "WHERE guild_id = ? AND id > ? ORDER BY id", (guild_id, last_play)).fetchall()
        posts = c.execute("SELECT id, channel_id, message_id, video_id, posted_by_id, posted_by_name, posted_at FROM shared_links "
                          "WHERE guild_id = ? AND id > ? ORDER BY id", (guild_id, last_link)).fetchall()
    for pid, vid, url, uid, uname, at in plays:
        k = key_from_play(vid, url)
        if k:
            rows.append({"guild_id": guild_id, "key": k, "kind": "play", "user_id": uid, "user_name": uname, "at": at, "ref": f"play:{pid}"})
    for lid, ch, mid, vid, uid, uname, at in posts:
        rows.append({"guild_id": guild_id, "key": "yt:" + vid, "kind": post_kind(ch), "user_id": uid, "user_name": uname, "at": at,
                     "channel_id": ch, "ref": f"msg:{mid}:yt:{vid}"})
    # 30 秒以内に飛ばされた曲（play_history の skipped / listened_sec。曲が終わってから書かれるので、直近 3 日を毎回見る）
    try:
        with db._connect() as c:
            skips = c.execute("SELECT id, video_id, url, added_by_id, played_at FROM play_history WHERE guild_id = ? AND skipped = 1 "
                              "AND listened_sec < 30 AND played_at >= ?", (guild_id, store.ago(3))).fetchall()
    except Exception:
        skips = []   # 列がまだ無い（voice が古い）
    for pid, vid, url, uid, at in skips:
        k = key_from_play(vid, url)
        if k:
            rows.append({"guild_id": guild_id, "key": k, "kind": "skip", "user_id": uid, "at": at, "ref": f"skip:{pid}"})
    if rows:
        store.ensure_tracks(r["key"] for r in rows)
    n = store.add_events(rows)
    if plays:
        store.kv_set(f"sync_play:{guild_id}", str(plays[-1][0]))
    if posts:
        store.kv_set(f"sync_link:{guild_id}", str(posts[-1][0]))
    return n


def guild_ids() -> List[str]:
    from ..services import game_shelf
    return sorted(game_shelf._ids("IRINA_RECO_GUILD_IDS", game_shelf.DODEKA))
