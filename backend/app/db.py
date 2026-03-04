import sqlite3
from typing import Optional, List
from pydantic import BaseModel

DB_NAME = "uploaded_songs.db"

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
    with sqlite3.connect(DB_NAME) as conn:
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

def add_uploaded_song(song: UploadedSong):
    with sqlite3.connect(DB_NAME) as conn:
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
    with sqlite3.connect(DB_NAME) as conn:
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
    with sqlite3.connect(DB_NAME) as conn:
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
    with sqlite3.connect(DB_NAME) as conn:
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
    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("""
        DELETE FROM uploaded_songs
        WHERE guild_id = ? AND id = ?
        """, (guild_id, song_id))
