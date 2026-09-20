"""「棚」: テキストチャンネルに貼られた YouTube リンクを黙って集める。

- `collect(message)` を on_message の先頭で呼ぶ（irina_chat より前）。**絶対に send / reply しない**
- 保存するのは URL・動画 ID・投稿者・時刻・チャンネルだけ。メッセージ本文は保存しない
- bot 専用チャンネル（イリーナが応答する場所）と bot の投稿は対象外
- タイトル/アーティスト/サムネは ytmusicapi で後追い解決（`resolve_pending`。失敗しても 3 回で諦める）
- 過去分は scripts/backfill_shared_links.py（Pi 上で 1 回）
"""
import asyncio
import os
import re
from datetime import timezone
from typing import List, Optional

import discord

from .. import db
from . import irina_chat

YOUTUBE_ID_RE = re.compile(
    r"(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?(?:[^\s]*?&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)
FALLBACK_THUMBNAIL = "https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

_ytmusic = None
_resolve_lock: Optional[asyncio.Lock] = None


def extract_video_ids(text: str) -> List[str]:
    seen: List[str] = []
    for m in YOUTUBE_ID_RE.finditer(text or ""):
        vid = m.group(1)
        if vid not in seen:
            seen.append(vid)
    return seen


def _avatar_url(user) -> str:
    try:
        return str(user.display_avatar.url) if getattr(user, "display_avatar", None) else ""
    except Exception:
        return ""


async def collect(message: discord.Message) -> int:
    """保存した件数を返す。例外は握りつぶす（収集の失敗で bot を止めない）"""
    try:
        if message.guild is None:
            return 0
        if message.author.bot and os.getenv("IRINA_SHELF_ALLOW_BOTS") != "1":  # 許可はローカルテスト用
            return 0
        if irina_chat.is_chat_channel(message.channel):
            return 0
        ids = extract_video_ids(message.content or "")
        if not ids:
            return 0
        posted_at = message.created_at.astimezone(timezone.utc).isoformat()
        channel_name = getattr(message.channel, "name", None)
        saved = 0
        for vid in ids:
            ok = await asyncio.to_thread(
                db.add_shared_link,
                guild_id=str(message.guild.id), channel_id=str(message.channel.id), channel_name=channel_name,
                message_id=str(message.id), video_id=vid, url=f"https://www.youtube.com/watch?v={vid}",
                posted_by_id=str(message.author.id), posted_by_name=getattr(message.author, "display_name", None) or message.author.name,
                posted_by_image=_avatar_url(message.author), posted_at=posted_at,
            )
            saved += 1 if ok else 0
        if saved:
            print(f"[shelf] {saved} link(s) from #{channel_name} ({message.guild.name})")
            asyncio.create_task(resolve_pending())
        return saved
    except Exception as e:
        print(f"[shelf] collect failed: {type(e).__name__}: {e}")
        return 0


def _get_ytmusic():
    global _ytmusic
    if _ytmusic is None:
        from ytmusicapi import YTMusic
        _ytmusic = YTMusic(language="en", location="JP")  # ja は上流バグがあるので使わない（CLAUDE.md 参照）
    return _ytmusic


def _resolve_one(video_id: str) -> Optional[dict]:
    """ytmusicapi.get_song → (title, artist, thumbnail)。取れなければ None"""
    info = _get_ytmusic().get_song(video_id)
    details = (info or {}).get("videoDetails") or {}
    title = details.get("title")
    if not title:
        return None
    thumbs = ((details.get("thumbnail") or {}).get("thumbnails")) or []
    thumbnail = thumbs[-1].get("url") if thumbs else FALLBACK_THUMBNAIL.format(video_id=video_id)
    return {"title": title, "artist": details.get("author") or None, "thumbnail": thumbnail}


async def resolve_pending(limit: int = 20) -> int:
    """未解決のリンクのメタ情報を埋める。同時に 1 つだけ走る"""
    global _resolve_lock
    if _resolve_lock is None:
        _resolve_lock = asyncio.Lock()
    if _resolve_lock.locked():
        return 0
    async with _resolve_lock:
        try:
            pending = await asyncio.to_thread(db.list_unresolved_shared_links, limit)
        except Exception as e:
            print(f"[shelf] list_unresolved failed: {e}")
            return 0
        done = 0
        for row in pending:
            try:
                meta = await asyncio.to_thread(_resolve_one, row["video_id"])
            except Exception as e:
                print(f"[shelf] resolve {row['video_id']} failed: {type(e).__name__}: {e}")
                meta = None
            try:
                if meta:
                    await asyncio.to_thread(db.update_shared_link_meta, row["id"], title=meta["title"], artist=meta["artist"], thumbnail=meta["thumbnail"], ok=True)
                    done += 1
                else:
                    await asyncio.to_thread(db.update_shared_link_meta, row["id"], title=None, artist=None, thumbnail=None, ok=False)
            except Exception as e:
                print(f"[shelf] update meta failed: {e}")
            await asyncio.sleep(0.3)  # YouTube への連打を避ける
        if done:
            print(f"[shelf] resolved {done} link(s)")
        return done


async def resolver_loop(interval_sec: int = 600) -> None:
    """起動後と 10 分ごとに未解決分を処理（バックフィル直後などのため）"""
    await asyncio.sleep(20)
    while True:
        try:
            await resolve_pending(limit=40)
        except Exception as e:
            print(f"[shelf] resolver_loop error: {e}")
        await asyncio.sleep(interval_sec)
