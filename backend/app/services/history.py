"""再生履歴（SQLite）を API のレスポンス型（QueueItem）に変換する共通処理。

`/history` エンドポイント（web プロセス）と、WebSocket の状態ペイロード（voice プロセス）の
両方から使うので、どちらのプロセスにも属さないここに置く。
"""
import asyncio
from typing import List, Optional

from ..db import get_play_history
from ..schemas import QueueItem, Track, User


def history_entry_to_queue_item(entry, position: int) -> QueueItem:
    added_by = None
    if entry.added_by_id:
        added_by = User(id=entry.added_by_id, name=entry.added_by_name or "Unknown", image=entry.added_by_image or "")
    return QueueItem(
        track=Track(
            title=entry.title,
            artist=entry.artist or "Unknown Artist",
            thumbnail=entry.thumbnail or "",
            url=entry.url,
            added_by=added_by,
            played_at=entry.played_at,
        ),
        position=position,
        isCurrent=False,
    )


async def load_history_queue_items(guild_id: str, limit: int = 50, user_id: Optional[str] = None) -> List[QueueItem]:
    """サーバーごとの再生履歴を古い→新しい順で返す（frontend 側で reverse して表示している）。"""
    entries = await asyncio.to_thread(get_play_history, guild_id, limit, user_id)
    entries = list(reversed(entries))
    return [history_entry_to_queue_item(e, i) for i, e in enumerate(entries)]
