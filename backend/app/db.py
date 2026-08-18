import sqlite3
import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

# 歴史的経緯でファイル名は uploaded_songs.db だが、アップロード曲と再生履歴の両方を保持する
# （Pi 上の既存ファイルとの互換のため名前は変えない。WorkingDirectory=backend/ 前提）
DB_NAME = "uploaded_songs.db"


def _connect() -> sqlite3.Connection:
    """WAL + busy_timeout 付きの接続。bot（単一プロセス）からの読み書きが競合しないようにする"""
    conn = sqlite3.connect(DB_NAME, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

class UploadedSong(BaseModel):
    id: str
    guild_id: str
    title: str
    artist: str
    filename: str
    thumbnail_filename: str
    uploader_id: str
    uploader_name: str
    full_path: str

def init_db():
    """起動時に1回だけ呼び出してテーブルが無ければ作成"""
    with _connect() as conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS uploaded_songs (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            filename TEXT NOT NULL,
            thumbnail_filename TEXT NOT NULL,
            uploader_id TEXT NOT NULL,
            uploader_name TEXT NOT NULL,
            full_path TEXT NOT NULL
        )
        """)
        # サーバーごとの再生履歴（誰が入れた曲か込み）。bot 再起動をまたいで残る
        conn.execute("""
        CREATE TABLE IF NOT EXISTS play_history (
            id            INTEGER PRIMARY KEY,
            guild_id      TEXT NOT NULL,
            video_id      TEXT,
            url           TEXT NOT NULL,
            title         TEXT NOT NULL,
            artist        TEXT,
            thumbnail     TEXT,
            added_by_id   TEXT,
            added_by_name TEXT,
            added_by_image TEXT,
            played_at     TEXT NOT NULL
        )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hist_guild_time ON play_history(guild_id, played_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hist_guild_user ON play_history(guild_id, added_by_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hist_guild_video ON play_history(guild_id, video_id)")


# ---------------------------------------------------------------------------
# 再生履歴
# ---------------------------------------------------------------------------

_VIDEO_ID_RE = re.compile(r"(?:v=|youtu\.be/|/watch/|/embed/|/shorts/)([0-9A-Za-z_-]{11})")


def extract_video_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = _VIDEO_ID_RE.search(url)
    return m.group(1) if m else None


class PlayHistoryEntry(BaseModel):
    id: int
    guild_id: str
    video_id: Optional[str] = None
    url: str
    title: str
    artist: Optional[str] = None
    thumbnail: Optional[str] = None
    added_by_id: Optional[str] = None
    added_by_name: Optional[str] = None
    added_by_image: Optional[str] = None
    played_at: str


def add_play_history(
    guild_id: str,
    *,
    url: str,
    title: str,
    artist: Optional[str],
    thumbnail: Optional[str],
    added_by_id: Optional[str] = None,
    added_by_name: Optional[str] = None,
    added_by_image: Optional[str] = None,
    played_at: Optional[datetime] = None,
) -> int:
    """再生開始を1件記録して id を返す（同期。呼び出し側は asyncio.to_thread で包む）"""
    ts = (played_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds")
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO play_history (guild_id, video_id, url, title, artist, thumbnail,
                                      added_by_id, added_by_name, added_by_image, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (guild_id, extract_video_id(url), url, title or "Unknown Title", artist, thumbnail,
             added_by_id, added_by_name, added_by_image, ts),
        )
        return int(cur.lastrowid)


def get_play_history(guild_id: str, limit: int = 50, user_id: Optional[str] = None) -> List[PlayHistoryEntry]:
    """新しい順に最大 limit 件"""
    limit = max(1, min(int(limit), 500))
    sql = "SELECT * FROM play_history WHERE guild_id = ?"
    params: List[Any] = [guild_id]
    if user_id:
        sql += " AND added_by_id = ?"
        params.append(user_id)
    sql += " ORDER BY played_at DESC, id DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
    return [PlayHistoryEntry(**dict(r)) for r in rows]


def get_top_tracks(guild_id: str, days: int = 30, limit: int = 10) -> List[Dict[str, Any]]:
    """期間内の再生回数ランキング（video_id 単位。無ければ url 単位）"""
    limit = max(1, min(int(limit), 100))
    days = max(1, min(int(days), 3650))
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT COALESCE(video_id, url) AS key,
                   MAX(url) AS url, MAX(title) AS title, MAX(artist) AS artist, MAX(thumbnail) AS thumbnail,
                   COUNT(*) AS play_count, MAX(played_at) AS last_played_at
            FROM play_history
            WHERE guild_id = ? AND played_at >= datetime('now', ?)
            GROUP BY key
            ORDER BY play_count DESC, last_played_at DESC
            LIMIT ?
            """,
            (guild_id, f"-{days} days", limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_history_stats(guild_id: str, days: int = 30) -> Dict[str, Any]:
    days = max(1, min(int(days), 3650))
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM play_history WHERE guild_id = ? AND played_at >= datetime('now', ?)",
            (guild_id, f"-{days} days"),
        ).fetchone()["c"]
        users = conn.execute(
            """
            SELECT added_by_id, MAX(added_by_name) AS added_by_name, MAX(added_by_image) AS added_by_image, COUNT(*) AS play_count
            FROM play_history
            WHERE guild_id = ? AND played_at >= datetime('now', ?) AND added_by_id IS NOT NULL
            GROUP BY added_by_id ORDER BY play_count DESC LIMIT 10
            """,
            (guild_id, f"-{days} days"),
        ).fetchall()
    return {"guild_id": guild_id, "days": days, "total_plays": total, "top_users": [dict(u) for u in users]}

def add_uploaded_song(song: UploadedSong):
    with _connect() as conn:
        conn.execute("""
        INSERT INTO uploaded_songs (
          id, guild_id, title, artist, filename, thumbnail_filename, uploader_id, uploader_name, full_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            song.id,
            song.guild_id,
            song.title,
            song.artist,
            song.filename,
            song.thumbnail_filename,
            song.uploader_id,
            song.uploader_name,
            song.full_path,
        ))

def get_uploaded_songs_in_guild(guild_id: str) -> List[UploadedSong]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
        SELECT
          id, guild_id, title, artist, filename, thumbnail_filename, uploader_id, uploader_name, full_path
        FROM uploaded_songs
        WHERE guild_id = ?
        ORDER BY rowid ASC
        """, (guild_id,)).fetchall()

    return [
        UploadedSong(
            id=row["id"],
            guild_id=row["guild_id"],
            title=row["title"],
            artist=row["artist"],
            filename=row["filename"],
            thumbnail_filename=row["thumbnail_filename"],
            uploader_id=row["uploader_id"],
            uploader_name=row["uploader_name"],
            full_path=row["full_path"],
        )
        for row in rows
    ]

def find_uploaded_song_by_id(guild_id: str, song_id: str) -> Optional[UploadedSong]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("""
        SELECT
          id, guild_id, title, artist, filename, thumbnail_filename, uploader_id, uploader_name, full_path
        FROM uploaded_songs
        WHERE guild_id = ? AND id = ?
        """, (guild_id, song_id)).fetchone()

    if row:
        return UploadedSong(
            id=row["id"],
            guild_id=row["guild_id"],
            title=row["title"],
            artist=row["artist"],
            filename=row["filename"],
            thumbnail_filename=row["thumbnail_filename"],
            uploader_id=row["uploader_id"],
            uploader_name=row["uploader_name"],
            full_path=row["full_path"],
        )
    return None

def update_uploaded_song(song: UploadedSong):
    with _connect() as conn:
        conn.execute("""
        UPDATE uploaded_songs
        SET title = ?, artist = ?, full_path = ?
        WHERE id = ? AND guild_id = ?
        """, (
            song.title,
            song.artist,
            song.full_path,
            song.id,
            song.guild_id
        ))

def delete_uploaded_song(guild_id: str, song_id: str):
    with _connect() as conn:
        conn.execute("""
        DELETE FROM uploaded_songs
        WHERE guild_id = ? AND id = ?
        """, (guild_id, song_id))
