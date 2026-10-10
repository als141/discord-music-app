"""界隈フィードの DB（同じ uploaded_songs.db に別の表として持つ）。同期関数なので呼ぶ側は asyncio.to_thread で。"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from .. import db

ARTICLE_COLS = ("url", "src", "title", "body", "steam_hint", "published_at", "fetched_at", "game", "game_en",
                "multiplayer", "max_players", "hook", "fit", "why", "appid", "classified_at")
VIDEO_COLS = ("video_id", "channel_id", "channel_name", "channel_group", "title", "thumb", "published_at", "fetched_at",
              "views", "kind", "game", "game_en", "song", "artist", "appid", "orig_video_id", "classified_at",
              "song_type", "hook")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def init() -> None:
    with db._connect() as c:
        c.execute(f"CREATE TABLE IF NOT EXISTS scene_articles ({', '.join(a + (' TEXT PRIMARY KEY' if a == 'url' else '') for a in ARTICLE_COLS)})")
        c.execute("CREATE INDEX IF NOT EXISTS idx_scene_articles_pub ON scene_articles (published_at)")
        c.execute(f"CREATE TABLE IF NOT EXISTS scene_videos ({', '.join(a + (' TEXT PRIMARY KEY' if a == 'video_id' else '') for a in VIDEO_COLS)})")
        c.execute("CREATE INDEX IF NOT EXISTS idx_scene_videos_pub ON scene_videos (published_at)")
        for col in ("song_type", "hook"):
            try:
                c.execute(f"ALTER TABLE scene_videos ADD COLUMN {col} TEXT")
            except Exception:
                pass  # 既にある
        c.execute("CREATE TABLE IF NOT EXISTS scene_charts (list TEXT, appid TEXT, rank INTEGER, name TEXT, day TEXT, "
                  "PRIMARY KEY (list, appid, day))")
        c.execute("CREATE TABLE IF NOT EXISTS scene_jikkyou (appid TEXT PRIMARY KEY, query TEXT, views INTEGER, videos INTEGER, "
                  "top_video TEXT, top_title TEXT, at TEXT)")
        # 曲置き場に貼られた動画の投稿元チャンネル（＝メンバーが好きな歌い手・アーティスト）
        c.execute("CREATE TABLE IF NOT EXISTS scene_music_channels (channel_id TEXT PRIMARY KEY, title TEXT, posts INTEGER, "
                  "updated_at TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS scene_video_channel (video_id TEXT PRIMARY KEY, channel_id TEXT, channel_title TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS scene_channel_image (channel_id TEXT PRIMARY KEY, image TEXT, at TEXT)")
        # 界隈で初めて見た日（あとで #ゲーム置き場 に貼られたら「イリーナが先に見つけた」）
        c.execute("CREATE TABLE IF NOT EXISTS scene_seen (key TEXT PRIMARY KEY, kind TEXT, name TEXT, appid TEXT, first_seen_at TEXT)")


def _rows(cols, rs) -> List[Dict[str, Any]]:
    return [dict(zip(cols, r)) for r in rs]


# ---------------------------------------------------------------- articles

def add_articles(items: Iterable[Dict[str, Any]]) -> int:
    n = 0
    with db._connect() as c:
        for it in items:
            cur = c.execute("INSERT OR IGNORE INTO scene_articles (url, src, title, body, steam_hint, published_at, fetched_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)", (it["url"], it["src"], it["title"], it.get("body"), it.get("steam_hint"),
                                                            it.get("published_at"), now_iso()))
            n += cur.rowcount
    return n


def unclassified_articles(limit: int) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(ARTICLE_COLS, c.execute(f"SELECT {', '.join(ARTICLE_COLS)} FROM scene_articles WHERE classified_at IS NULL "
                                             "AND published_at >= ? ORDER BY published_at DESC LIMIT ?", (ago(10), limit)))


def update_article(url: str, **f) -> None:
    keys = [k for k in f if k in ARTICLE_COLS]
    with db._connect() as c:
        c.execute(f"UPDATE scene_articles SET {', '.join(k + ' = ?' for k in keys)} WHERE url = ?", [f[k] for k in keys] + [url])


def recent_articles(days: float, min_fit: int = 2) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(ARTICLE_COLS, c.execute(f"SELECT {', '.join(ARTICLE_COLS)} FROM scene_articles WHERE published_at >= ? "
                                             "AND fit >= ? ORDER BY published_at DESC", (ago(days), min_fit)))


# ---------------------------------------------------------------- videos

def add_videos(items: Iterable[Dict[str, Any]]) -> int:
    n = 0
    with db._connect() as c:
        for v in items:
            cur = c.execute("INSERT OR IGNORE INTO scene_videos (video_id, channel_id, channel_name, channel_group, title, thumb, "
                            "published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (v["video_id"], v["channel_id"], v["channel_name"], v["channel_group"], v["title"], v.get("thumb"),
                             v["published_at"], now_iso()))
            n += cur.rowcount
    return n


def videos_since(days: float, kinds: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    q = f"SELECT {', '.join(VIDEO_COLS)} FROM scene_videos WHERE published_at >= ?"
    args: List[Any] = [ago(days)]
    if kinds:
        kinds = list(kinds)
        q += f" AND kind IN ({', '.join('?' * len(kinds))})"
        args += kinds
    with db._connect() as c:
        return _rows(VIDEO_COLS, c.execute(q + " ORDER BY published_at DESC", args))


def unclassified_videos(limit: int) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(VIDEO_COLS, c.execute(f"SELECT {', '.join(VIDEO_COLS)} FROM scene_videos WHERE classified_at IS NULL "
                                           "AND published_at >= ? ORDER BY published_at DESC LIMIT ?", (ago(10), limit)))


def update_video(video_id: str, **f) -> None:
    keys = [k for k in f if k in VIDEO_COLS]
    with db._connect() as c:
        c.execute(f"UPDATE scene_videos SET {', '.join(k + ' = ?' for k in keys)} WHERE video_id = ?",
                  [f[k] for k in keys] + [video_id])


# ---------------------------------------------------------------- 曲置き場の投稿元

def posted_video_ids(shelf_channel_ids: Iterable[str]) -> List[str]:
    ids = list(shelf_channel_ids)
    with db._connect() as c:
        return [r[0] for r in c.execute(f"SELECT DISTINCT video_id FROM shared_links WHERE channel_id IN ({', '.join('?' * len(ids))})", ids)]


def known_video_channels() -> Dict[str, str]:
    with db._connect() as c:
        return {v: ch for v, ch in c.execute("SELECT video_id, channel_id FROM scene_video_channel")}


def save_video_channels(rows: Dict[str, tuple]) -> None:
    with db._connect() as c:
        c.executemany("INSERT OR REPLACE INTO scene_video_channel (video_id, channel_id, channel_title) VALUES (?, ?, ?)",
                      [(v, ch, t) for v, (ch, t) in rows.items()])


def rebuild_music_channels() -> None:
    with db._connect() as c:
        c.execute("DELETE FROM scene_music_channels")
        c.execute("INSERT INTO scene_music_channels (channel_id, title, posts, updated_at) "
                  "SELECT channel_id, MAX(channel_title), COUNT(*), ? FROM scene_video_channel GROUP BY channel_id", (now_iso(),))


def channel_images() -> Dict[str, str]:
    with db._connect() as c:
        return {r[0]: r[1] for r in c.execute("SELECT channel_id, image FROM scene_channel_image WHERE image IS NOT NULL")}


def save_channel_images(rows: Dict[str, Optional[str]]) -> None:
    with db._connect() as c:
        c.executemany("INSERT OR REPLACE INTO scene_channel_image (channel_id, image, at) VALUES (?, ?, ?)",
                      [(k, v, now_iso()) for k, v in rows.items()])


def music_channels() -> List[Dict[str, Any]]:
    with db._connect() as c:
        return [{"channel_id": r[0], "name": r[1], "posts": r[2]} for r in
                c.execute("SELECT channel_id, title, posts FROM scene_music_channels ORDER BY posts DESC")]


# ---------------------------------------------------------------- charts / jikkyou / seen

def save_chart(lst: str, rows: List[Dict[str, Any]], day: str) -> None:
    with db._connect() as c:
        c.execute("DELETE FROM scene_charts WHERE list = ? AND day = ?", (lst, day))
        c.executemany("INSERT OR REPLACE INTO scene_charts (list, appid, rank, name, day) VALUES (?, ?, ?, ?, ?)",
                      [(lst, r["appid"], r["rank"], r["name"], day) for r in rows])
        c.execute("DELETE FROM scene_charts WHERE day < ?", ((datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"),))


def latest_charts() -> Dict[str, Dict[str, int]]:
    """{list: {appid: rank}}（各リストの最新の日）"""
    out: Dict[str, Dict[str, int]] = {}
    with db._connect() as c:
        for lst, day in c.execute("SELECT list, MAX(day) FROM scene_charts GROUP BY list").fetchall():
            out[lst] = {a: r for a, r in c.execute("SELECT appid, rank FROM scene_charts WHERE list = ? AND day = ?", (lst, day))}
    return out


def save_jikkyou(appid: str, query: str, views: int, videos: int, top_video: Optional[str], top_title: Optional[str]) -> None:
    with db._connect() as c:
        c.execute("INSERT OR REPLACE INTO scene_jikkyou (appid, query, views, videos, top_video, top_title, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (appid, query, views, videos, top_video, top_title, now_iso()))


def jikkyou() -> Dict[str, Dict[str, Any]]:
    with db._connect() as c:
        return {r[0]: {"views": r[1], "videos": r[2], "top_video": r[3], "top_title": r[4], "at": r[5]}
                for r in c.execute("SELECT appid, views, videos, top_video, top_title, at FROM scene_jikkyou")}


def mark_seen(key: str, kind: str, name: str, appid: Optional[str]) -> None:
    with db._connect() as c:
        c.execute("INSERT OR IGNORE INTO scene_seen (key, kind, name, appid, first_seen_at) VALUES (?, ?, ?, ?, ?)",
                  (key, kind, name, appid, now_iso()))


def seen() -> Dict[str, Dict[str, Any]]:
    with db._connect() as c:
        return {r[0]: {"kind": r[1], "name": r[2], "appid": r[3], "first_seen_at": r[4]}
                for r in c.execute("SELECT key, kind, name, appid, first_seen_at FROM scene_seen")}


def loads(s: Optional[str], default):
    try:
        return json.loads(s) if s else default
    except ValueError:
        return default
