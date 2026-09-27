import sqlite3
import re
import json
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
        # デプロイ（bot再起動）をまたいでキュー・再生位置を引き継ぐためのスナップショット
        conn.execute("""
        CREATE TABLE IF NOT EXISTS player_state (
            guild_id   TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)
        # 「棚」: テキストチャンネルに貼られた YouTube リンク（本文は保存しない。URL とメタだけ）
        conn.execute("""
        CREATE TABLE IF NOT EXISTS shared_links (
            id               INTEGER PRIMARY KEY,
            guild_id         TEXT NOT NULL,
            channel_id       TEXT NOT NULL,
            channel_name     TEXT,
            message_id       TEXT NOT NULL,
            video_id         TEXT NOT NULL,
            url              TEXT NOT NULL,
            posted_by_id     TEXT,
            posted_by_name   TEXT,
            posted_by_image  TEXT,
            posted_at        TEXT NOT NULL,
            title            TEXT,
            artist           TEXT,
            thumbnail        TEXT,
            resolved_at      TEXT,
            resolve_attempts INTEGER NOT NULL DEFAULT 0,
            UNIQUE(guild_id, message_id, video_id)
        )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shared_guild_time ON shared_links(guild_id, posted_at DESC)")
        # イリーナのチャット（bot 専用チャンネル）: xAI 側に保存された会話の続き（previous_response_id）と要約・メモ
        conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            channel_id       TEXT PRIMARY KEY,
            guild_id         TEXT,
            last_response_id TEXT,
            turn_count       INTEGER NOT NULL DEFAULT 0,
            summary          TEXT,
            persona_key      TEXT,
            updated_at       TEXT NOT NULL
        )
        """)
        # 既存 DB への列追加（前回返事した時点のメッセージ ID。それ以降のチャンネルの流れを次の発言で渡す）
        try:
            conn.execute("ALTER TABLE chat_sessions ADD COLUMN last_message_id TEXT")
        except sqlite3.OperationalError:
            pass  # 既にある
        conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_memory (
            id         INTEGER PRIMARY KEY,
            guild_id   TEXT NOT NULL,
            note       TEXT NOT NULL,
            created_by TEXT,
            created_at TEXT NOT NULL
        )
        """)
        # Web アプリを開いた端末（ホーム画面に追加したか・通知の許可・プッシュ購読）。device_id はブラウザが持つ乱数
        conn.execute("""
        CREATE TABLE IF NOT EXISTS app_devices (
            device_id        TEXT PRIMARY KEY,
            user_id          TEXT NOT NULL,
            user_name        TEXT,
            user_image       TEXT,
            platform         TEXT,
            browser          TEXT,
            form_factor      TEXT,
            standalone       INTEGER NOT NULL DEFAULT 0,
            ever_standalone  INTEGER NOT NULL DEFAULT 0,
            installed_at     TEXT,
            notif_permission TEXT,
            push_endpoint    TEXT,
            push_p256dh      TEXT,
            push_auth        TEXT,
            push_updated_at  TEXT,
            push_last_ok_at  TEXT,
            push_last_error  TEXT,
            app_version      TEXT,
            app_build        TEXT,
            user_agent       TEXT,
            first_seen_at    TEXT NOT NULL,
            last_seen_at     TEXT NOT NULL
        )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_app_devices_user ON app_devices(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_app_devices_endpoint ON app_devices(push_endpoint)")
        # 通知の種類ごとの受け取り設定（お知らせは常に届くので列なし）
        conn.execute("""
        CREATE TABLE IF NOT EXISTS notif_prefs (
            user_id    TEXT PRIMARY KEY,
            shelf      INTEGER NOT NULL DEFAULT 1,
            vc_music   INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        )
        """)
        # 送った通知の記録（管理画面の履歴・開封数）
        conn.execute("""
        CREATE TABLE IF NOT EXISTS push_log (
            id             INTEGER PRIMARY KEY,
            kind           TEXT NOT NULL,
            title          TEXT NOT NULL,
            body           TEXT,
            url            TEXT,
            target_users   INTEGER NOT NULL DEFAULT 0,
            target_devices INTEGER NOT NULL DEFAULT 0,
            sent           INTEGER NOT NULL DEFAULT 0,
            failed         INTEGER NOT NULL DEFAULT 0,
            removed        INTEGER NOT NULL DEFAULT 0,
            clicked        INTEGER NOT NULL DEFAULT 0,
            created_by     TEXT,
            created_at     TEXT NOT NULL
        )
        """)
        # 自動通知の間引き（ユーザー × 種類ごとの最終送信）と、ギルドの再生状態の切り替わり時刻
        conn.execute("""
        CREATE TABLE IF NOT EXISTS push_throttle (
            user_id      TEXT NOT NULL,
            kind         TEXT NOT NULL,
            last_sent_at TEXT NOT NULL,
            PRIMARY KEY (user_id, kind)
        )
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS guild_activity (
            guild_id   TEXT PRIMARY KEY,
            state      TEXT NOT NULL,
            changed_at TEXT NOT NULL
        )
        """)


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


# ---------------------------------------------------------------------------
# プレイヤー状態スナップショット（デプロイ跨ぎのレジューム用）
# ---------------------------------------------------------------------------

def save_player_state(guild_id: str, state: Dict[str, Any]) -> None:
    """プレイヤー状態（キュー・再生中・位置）を保存する（同期）"""
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO player_state (guild_id, state_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(guild_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at",
            (guild_id, json.dumps(state, ensure_ascii=False), ts),
        )


def load_player_state(guild_id: str, max_age_sec: int = 1800) -> Optional[Dict[str, Any]]:
    """保存されたプレイヤー状態を返す。max_age_sec より古いものは無視（同期）"""
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT state_json, updated_at FROM player_state WHERE guild_id = ?", (guild_id,)).fetchone()
    if not row:
        return None
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["updated_at"])).total_seconds()
        if age > max_age_sec:
            return None
        return json.loads(row["state_json"])
    except Exception:
        return None


def clear_player_state(guild_id: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM player_state WHERE guild_id = ?", (guild_id,))


# ---------------------------------------------------------------------------
# 「棚」= テキストチャンネルに貼られた YouTube リンク
# ---------------------------------------------------------------------------

def add_shared_link(*, guild_id: str, channel_id: str, channel_name: Optional[str], message_id: str, video_id: str,
                    url: str, posted_by_id: Optional[str], posted_by_name: Optional[str], posted_by_image: Optional[str],
                    posted_at: str) -> bool:
    """1 リンクを保存。同じメッセージ・同じ動画は無視（False）"""
    with _connect() as conn:
        cur = conn.execute(
            """INSERT OR IGNORE INTO shared_links
               (guild_id, channel_id, channel_name, message_id, video_id, url, posted_by_id, posted_by_name, posted_by_image, posted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (guild_id, channel_id, channel_name, message_id, video_id, url, posted_by_id, posted_by_name, posted_by_image, posted_at),
        )
        return cur.rowcount > 0


def _shared_row_to_dict(r) -> Dict[str, Any]:
    (rid, guild_id, channel_id, channel_name, message_id, video_id, url, pb_id, pb_name, pb_image, posted_at, title, artist, thumbnail) = r
    return {
        "id": rid,
        "video_id": video_id,
        "url": url,
        "title": title,
        "artist": artist,
        "thumbnail": thumbnail,
        "channel_id": channel_id,
        "channel_name": channel_name,
        "posted_by": {"id": pb_id, "name": pb_name or "", "image": pb_image or ""} if pb_id else None,
        "posted_at": posted_at,
        "message_url": f"https://discord.com/channels/{guild_id}/{channel_id}/{message_id}",
    }


def get_shared_links(guild_id: str, limit: int = 200, channel_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """新しい順。同じ動画が複数回貼られていても最新の 1 件だけ返す"""
    with _connect() as conn:
        params: List[Any] = [guild_id]
        where = "guild_id = ?"
        if channel_id:
            where += " AND channel_id = ?"
            params.append(channel_id)
        rows = conn.execute(
            f"""SELECT id, guild_id, channel_id, channel_name, message_id, video_id, url,
                       posted_by_id, posted_by_name, posted_by_image, posted_at, title, artist, thumbnail
                FROM shared_links WHERE {where}
                  AND id IN (SELECT MAX(id) FROM shared_links WHERE {where} GROUP BY video_id)
                ORDER BY posted_at DESC LIMIT ?""",
            params + params + [limit],
        ).fetchall()
    return [_shared_row_to_dict(r) for r in rows]


def get_shared_link_channels(guild_id: str) -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT channel_id, MAX(channel_name), COUNT(DISTINCT video_id) FROM shared_links
               WHERE guild_id = ? GROUP BY channel_id ORDER BY 3 DESC""",
            (guild_id,),
        ).fetchall()
    return [{"id": r[0], "name": r[1] or "", "count": r[2]} for r in rows]


def list_unresolved_shared_links(limit: int = 20) -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT id, video_id FROM shared_links
               WHERE resolved_at IS NULL AND resolve_attempts < 3 ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [{"id": r[0], "video_id": r[1]} for r in rows]


def update_shared_link_meta(link_id: int, *, title: Optional[str], artist: Optional[str], thumbnail: Optional[str], ok: bool) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        if ok:
            # 同じ動画の他の行にも反映（バックフィルで同じ曲が複数回貼られている場合）
            vid = conn.execute("SELECT video_id FROM shared_links WHERE id = ?", (link_id,)).fetchone()
            conn.execute(
                "UPDATE shared_links SET title=?, artist=?, thumbnail=?, resolved_at=? WHERE video_id = ? AND resolved_at IS NULL",
                (title, artist, thumbnail, now, vid[0] if vid else None),
            )
        else:
            conn.execute("UPDATE shared_links SET resolve_attempts = resolve_attempts + 1 WHERE id = ?", (link_id,))


# ---------------------------------------------------------------------------
# イリーナのチャット: セッション（xAI 側の会話の続き）とメモ
# ---------------------------------------------------------------------------

def get_chat_session(channel_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        r = conn.execute(
            "SELECT channel_id, guild_id, last_response_id, turn_count, summary, persona_key, updated_at, last_message_id FROM chat_sessions WHERE channel_id = ?",
            (channel_id,),
        ).fetchone()
    if not r:
        return None
    return {"channel_id": r[0], "guild_id": r[1], "last_response_id": r[2], "turn_count": r[3], "summary": r[4], "persona_key": r[5], "updated_at": r[6], "last_message_id": r[7]}


def save_chat_session(channel_id: str, guild_id: Optional[str], last_response_id: Optional[str], turn_count: int,
                      summary: Optional[str], persona_key: Optional[str], last_message_id: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO chat_sessions (channel_id, guild_id, last_response_id, turn_count, summary, persona_key, updated_at, last_message_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(channel_id) DO UPDATE SET guild_id=excluded.guild_id, last_response_id=excluded.last_response_id,
                 turn_count=excluded.turn_count, summary=excluded.summary, persona_key=excluded.persona_key, updated_at=excluded.updated_at,
                 last_message_id=COALESCE(excluded.last_message_id, chat_sessions.last_message_id)""",
            (channel_id, guild_id, last_response_id, turn_count, summary, persona_key, now, last_message_id),
        )


def delete_chat_session(channel_id: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM chat_sessions WHERE channel_id = ?", (channel_id,))


def add_chat_memory(guild_id: str, note: str, created_by: Optional[str]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cur = conn.execute("INSERT INTO chat_memory (guild_id, note, created_by, created_at) VALUES (?, ?, ?, ?)", (guild_id, note, created_by, now))
        return int(cur.lastrowid)


def list_chat_memory(guild_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, note, created_by, created_at FROM chat_memory WHERE guild_id = ? ORDER BY id DESC LIMIT ?", (guild_id, limit)
        ).fetchall()
    return [{"id": r[0], "note": r[1], "created_by": r[2], "created_at": r[3]} for r in reversed(rows)]


def delete_chat_memory(guild_id: str, memory_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM chat_memory WHERE guild_id = ? AND id = ?", (guild_id, memory_id))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Web アプリの端末・通知
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_DEVICE_COLUMNS = (
    "device_id", "user_id", "user_name", "user_image", "platform", "browser", "form_factor", "standalone",
    "ever_standalone", "installed_at", "notif_permission", "push_endpoint", "push_p256dh", "push_auth",
    "push_updated_at", "push_last_ok_at", "push_last_error", "app_version", "app_build", "user_agent",
    "first_seen_at", "last_seen_at",
)


def _device_row(r) -> Dict[str, Any]:
    return dict(zip(_DEVICE_COLUMNS, r))


def upsert_app_device(*, device_id: str, user_id: str, user_name: str, user_image: str, platform: str, browser: str,
                      form_factor: str, standalone: bool, installed: bool, notif_permission: str,
                      subscription: Optional[Dict[str, Any]], app_version: str, app_build: str, user_agent: str) -> Dict[str, Any]:
    """端末の最新状態を記録する。subscription が None なら購読は変えない / {} なら購読を消す"""
    now = _now_iso()
    with _connect() as conn:
        # 同じ端末から同時に 2 回届いても落ちないよう、先に行だけ確保してから更新する
        conn.execute("INSERT OR IGNORE INTO app_devices (device_id, user_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
                     (device_id, user_id, now, now))
        prev = conn.execute("SELECT ever_standalone, installed_at FROM app_devices WHERE device_id = ?", (device_id,)).fetchone()
        ever = 1 if (standalone or installed or prev[0]) else 0
        installed_at = prev[1] or (now if (standalone or installed) else None)
        conn.execute(
            """UPDATE app_devices SET user_id = ?, user_name = ?, user_image = ?, platform = ?, browser = ?,
               form_factor = ?, standalone = ?, ever_standalone = ?, installed_at = ?, notif_permission = ?,
               app_version = ?, app_build = ?, user_agent = ?, last_seen_at = ? WHERE device_id = ?""",
            (user_id, user_name, user_image, platform, browser, form_factor, 1 if standalone else 0, ever,
             installed_at, notif_permission, app_version, app_build, user_agent, now, device_id),
        )
        if subscription is not None:
            endpoint = (subscription or {}).get("endpoint")
            keys = (subscription or {}).get("keys") or {}
            if endpoint and keys.get("p256dh") and keys.get("auth"):
                # 同じ購読が別の device_id に残っていたら（ブラウザのデータを消した等）付け替える
                conn.execute("UPDATE app_devices SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL "
                             "WHERE push_endpoint = ? AND device_id != ?", (endpoint, device_id))
                conn.execute(
                    """UPDATE app_devices SET push_endpoint = ?, push_p256dh = ?, push_auth = ?, push_updated_at = ?,
                       push_last_error = CASE WHEN push_endpoint = ? THEN push_last_error ELSE NULL END
                       WHERE device_id = ?""",
                    (endpoint, keys["p256dh"], keys["auth"], now, endpoint, device_id),
                )
            else:
                conn.execute("UPDATE app_devices SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL, "
                             "push_updated_at = ? WHERE device_id = ?", (now, device_id))
        row = conn.execute(f"SELECT {', '.join(_DEVICE_COLUMNS)} FROM app_devices WHERE device_id = ?", (device_id,)).fetchone()
    return _device_row(row)


def replace_push_subscription(old_endpoint: str, subscription: Dict[str, Any]) -> bool:
    """Service Worker の pushsubscriptionchange 用。古い endpoint を知っている端末だけが付け替えられる"""
    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys") or {}
    if not (old_endpoint and endpoint and keys.get("p256dh") and keys.get("auth")):
        return False
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE app_devices SET push_endpoint = ?, push_p256dh = ?, push_auth = ?, push_updated_at = ?, "
            "push_last_error = NULL WHERE push_endpoint = ?",
            (endpoint, keys["p256dh"], keys["auth"], _now_iso(), old_endpoint),
        )
        return cur.rowcount > 0


def clear_push_subscription(*, device_id: Optional[str] = None, endpoint: Optional[str] = None,
                            error: Optional[str] = None) -> None:
    with _connect() as conn:
        if device_id:
            conn.execute("UPDATE app_devices SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL, "
                         "push_updated_at = ?, push_last_error = ? WHERE device_id = ?", (_now_iso(), error, device_id))
        elif endpoint:
            conn.execute("UPDATE app_devices SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL, "
                         "push_updated_at = ?, push_last_error = ? WHERE push_endpoint = ?", (_now_iso(), error, endpoint))


def mark_push_result(device_id: str, ok: bool, error: Optional[str] = None) -> None:
    with _connect() as conn:
        if ok:
            conn.execute("UPDATE app_devices SET push_last_ok_at = ?, push_last_error = NULL WHERE device_id = ?",
                         (_now_iso(), device_id))
        else:
            conn.execute("UPDATE app_devices SET push_last_error = ? WHERE device_id = ?", ((error or "")[:200], device_id))


def list_app_devices(user_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    with _connect() as conn:
        if user_ids:
            marks = ",".join("?" for _ in user_ids)
            rows = conn.execute(f"SELECT {', '.join(_DEVICE_COLUMNS)} FROM app_devices WHERE user_id IN ({marks}) "
                                "ORDER BY last_seen_at DESC", tuple(user_ids)).fetchall()
        else:
            rows = conn.execute(f"SELECT {', '.join(_DEVICE_COLUMNS)} FROM app_devices ORDER BY last_seen_at DESC").fetchall()
    return [_device_row(r) for r in rows]


def list_push_devices(user_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """プッシュを送れる端末（購読あり）"""
    return [d for d in list_app_devices(user_ids) if d.get("push_endpoint")]


DEFAULT_NOTIF_PREFS = {"shelf": True, "vc_music": True}


def get_notif_prefs(user_id: str) -> Dict[str, bool]:
    with _connect() as conn:
        r = conn.execute("SELECT shelf, vc_music FROM notif_prefs WHERE user_id = ?", (user_id,)).fetchone()
    if not r:
        return dict(DEFAULT_NOTIF_PREFS)
    return {"shelf": bool(r[0]), "vc_music": bool(r[1])}


def get_all_notif_prefs() -> Dict[str, Dict[str, bool]]:
    with _connect() as conn:
        rows = conn.execute("SELECT user_id, shelf, vc_music FROM notif_prefs").fetchall()
    return {r[0]: {"shelf": bool(r[1]), "vc_music": bool(r[2])} for r in rows}


def save_notif_prefs(user_id: str, prefs: Dict[str, bool]) -> Dict[str, bool]:
    merged = {**get_notif_prefs(user_id), **{k: bool(v) for k, v in prefs.items() if k in DEFAULT_NOTIF_PREFS}}
    with _connect() as conn:
        conn.execute(
            """INSERT INTO notif_prefs (user_id, shelf, vc_music, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET shelf = excluded.shelf, vc_music = excluded.vc_music,
               updated_at = excluded.updated_at""",
            (user_id, int(merged["shelf"]), int(merged["vc_music"]), _now_iso()),
        )
    return merged


def add_push_log(*, kind: str, title: str, body: str, url: str, created_by: Optional[str]) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO push_log (kind, title, body, url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (kind, title, body, url, created_by, _now_iso()),
        )
        return int(cur.lastrowid)


def finish_push_log(log_id: int, *, target_users: int, target_devices: int, sent: int, failed: int, removed: int) -> None:
    with _connect() as conn:
        conn.execute("UPDATE push_log SET target_users = ?, target_devices = ?, sent = ?, failed = ?, removed = ? "
                     "WHERE id = ?", (target_users, target_devices, sent, failed, removed, log_id))


def count_push_click(log_id: int) -> None:
    with _connect() as conn:
        conn.execute("UPDATE push_log SET clicked = clicked + 1 WHERE id = ?", (log_id,))


def list_push_log(limit: int = 30) -> List[Dict[str, Any]]:
    cols = ("id", "kind", "title", "body", "url", "target_users", "target_devices", "sent", "failed", "removed",
            "clicked", "created_by", "created_at")
    with _connect() as conn:
        rows = conn.execute(f"SELECT {', '.join(cols)} FROM push_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(zip(cols, r)) for r in rows]


def throttle_ok(user_id: str, kind: str, min_interval_sec: int) -> bool:
    """最後に送ってから min_interval_sec 経っていれば True（呼んだだけでは記録しない）"""
    with _connect() as conn:
        r = conn.execute("SELECT last_sent_at FROM push_throttle WHERE user_id = ? AND kind = ?", (user_id, kind)).fetchone()
    if not r:
        return True
    try:
        last = datetime.fromisoformat(r[0])
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - last).total_seconds() >= min_interval_sec


def throttle_mark(user_ids: List[str], kind: str) -> None:
    now = _now_iso()
    with _connect() as conn:
        conn.executemany(
            """INSERT INTO push_throttle (user_id, kind, last_sent_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id, kind) DO UPDATE SET last_sent_at = excluded.last_sent_at""",
            [(u, kind, now) for u in user_ids],
        )


def swap_guild_activity(guild_id: str, state: str) -> Optional[Dict[str, Any]]:
    """ギルドの再生状態（playing / idle）を記録し、直前の記録を返す（無ければ None）"""
    with _connect() as conn:
        prev = conn.execute("SELECT state, changed_at FROM guild_activity WHERE guild_id = ?", (guild_id,)).fetchone()
        if prev and prev[0] == state:
            return {"state": prev[0], "changed_at": prev[1]}
        conn.execute(
            """INSERT INTO guild_activity (guild_id, state, changed_at) VALUES (?, ?, ?)
               ON CONFLICT(guild_id) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at""",
            (guild_id, state, _now_iso()),
        )
    return {"state": prev[0], "changed_at": prev[1]} if prev else None
