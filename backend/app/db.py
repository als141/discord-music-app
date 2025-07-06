# db.py

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
    full_path: str  # 音声ファイルの絶対パスを保存

def init_db():
    """起動時に1回だけ呼び出してテーブルが無ければ作成(ALTER TABLEなどは適宜手動で行う)"""
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    # 初回だけテーブル作成する例
    # すでにテーブルを作っている場合は、もしfull_pathが無ければ
    #   ALTER TABLE uploaded_songs ADD COLUMN full_path TEXT
    cur.execute("""
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
    conn.commit()
    conn.close()

def add_uploaded_song(song: UploadedSong):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute("""
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
    conn.commit()
    conn.close()

def get_uploaded_songs_in_guild(guild_id: str) -> List[UploadedSong]:
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute("""
    SELECT
      id, guild_id, title, artist, filename, thumbnail_filename, uploader_id, uploader_name, full_path
    FROM uploaded_songs
    WHERE guild_id = ?
    ORDER BY rowid ASC
    """, (guild_id,))
    rows = cur.fetchall()
    conn.close()

    results = []
    for row in rows:
        results.append(UploadedSong(
            id=row[0],
            guild_id=row[1],
            title=row[2],
            artist=row[3],
            filename=row[4],
            thumbnail_filename=row[5],
            uploader_id=row[6],
            uploader_name=row[7],
            full_path=row[8]
        ))
    return results

def find_uploaded_song_by_id(guild_id: str, song_id: str) -> Optional[UploadedSong]:
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute("""
    SELECT
      id, guild_id, title, artist, filename, thumbnail_filename, uploader_id, uploader_name, full_path
    FROM uploaded_songs
    WHERE guild_id = ? AND id = ?
    """, (guild_id, song_id))
    row = cur.fetchone()
    conn.close()
    if row:
        return UploadedSong(
            id=row[0],
            guild_id=row[1],
            title=row[2],
            artist=row[3],
            filename=row[4],
            thumbnail_filename=row[5],
            uploader_id=row[6],
            uploader_name=row[7],
            full_path=row[8]
        )
    return None

def update_uploaded_song(song: UploadedSong):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute("""
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
    conn.commit()
    conn.close()

def delete_uploaded_song(guild_id: str, song_id: str):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute("""
    DELETE FROM uploaded_songs
    WHERE guild_id = ? AND id = ?
    """, (guild_id, song_id))
    conn.commit()
    conn.close()
