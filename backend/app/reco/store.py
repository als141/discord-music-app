"""ドデカのおすすめ（reco）の DB。同じ uploaded_songs.db に reco_* の表として持つ。同期関数なので呼ぶ側は asyncio.to_thread で。

- reco_tracks: 曲 1 つ = 1 行（key は "yt:<動画ID>" か "nico:<sm…>"）。題名・アーティスト・年・音楽かどうか
- reco_events: ドデカがその曲に触れた記録（流した・貼った・置いた・2024 年に bot へ貼った）。本文は持たない
- reco_box: アプリの「曲置き箱」に置かれた曲
- reco_feedback: おすすめから流した / 外した
- reco_radio: 曲ごとの YouTube Music の「次に流れる曲」とニコニコの関連（数日キャッシュ）
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from .. import db

TRACK_COLS = ("key", "platform", "vid", "title", "artist", "artists", "channel", "channel_id", "year", "published_at",
              "duration", "views", "thumb", "category", "kind", "song", "orig_artist", "song_type", "gone",
              "meta_at", "judged_at", "ytm_at", "tags")
EVENT_COLS = ("id", "guild_id", "key", "kind", "user_id", "user_name", "at", "channel_id", "ref")
BOX_COLS = ("id", "guild_id", "key", "url", "added_by_id", "added_by_name", "added_by_image", "added_at", "removed_at")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def init() -> None:
    with db._connect() as c:
        c.execute(f"CREATE TABLE IF NOT EXISTS reco_tracks ({', '.join(a + (' TEXT PRIMARY KEY' if a == 'key' else '') for a in TRACK_COLS)})")
        c.execute("CREATE TABLE IF NOT EXISTS reco_events (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, key TEXT NOT NULL, "
                  "kind TEXT NOT NULL, user_id TEXT, user_name TEXT, at TEXT NOT NULL, channel_id TEXT, ref TEXT UNIQUE)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_reco_events_guild ON reco_events (guild_id, at)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_reco_events_key ON reco_events (key)")
        c.execute("CREATE TABLE IF NOT EXISTS reco_box (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, key TEXT NOT NULL, url TEXT, "
                  "added_by_id TEXT, added_by_name TEXT, added_by_image TEXT, added_at TEXT NOT NULL, removed_at TEXT)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_reco_box_guild ON reco_box (guild_id, added_at)")
        c.execute("CREATE TABLE IF NOT EXISTS reco_feedback (guild_id TEXT, user_id TEXT, key TEXT, action TEXT, mood TEXT, at TEXT)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_reco_feedback ON reco_feedback (guild_id, at)")
        c.execute("CREATE TABLE IF NOT EXISTS reco_radio (key TEXT PRIMARY KEY, source TEXT, items TEXT, fetched_at TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS reco_kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)")


def _rows(cols, rs) -> List[Dict[str, Any]]:
    return [dict(zip(cols, r)) for r in rs]


# ---------------------------------------------------------------- kv

def kv_get(key: str) -> Optional[str]:
    with db._connect() as c:
        r = c.execute("SELECT value FROM reco_kv WHERE key = ?", (key,)).fetchone()
    return r[0] if r else None


def kv_set(key: str, value: str) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO reco_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET "
                  "value = excluded.value, updated_at = excluded.updated_at", (key, value, now_iso()))


def kv_json(key: str, default: Any = None) -> Any:
    v = kv_get(key)
    try:
        return json.loads(v) if v else default
    except ValueError:
        return default


# ---------------------------------------------------------------- tracks

def ensure_tracks(keys: Iterable[str]) -> int:
    """まだ無い曲を空の行で作る（メタデータは meta.py が後追いで埋める）"""
    n = 0
    with db._connect() as c:
        for k in set(keys):
            platform, vid = k.split(":", 1)
            cur = c.execute("INSERT OR IGNORE INTO reco_tracks (key, platform, vid) VALUES (?, ?, ?)", (k, platform, vid))
            n += cur.rowcount
    return n


def update_track(key: str, **fields) -> None:
    fields = {k: v for k, v in fields.items() if k in TRACK_COLS and k != "key"}
    if not fields:
        return
    for k in ("artists", "tags"):
        if k in fields and not isinstance(fields[k], (str, type(None))):
            fields[k] = json.dumps(fields[k], ensure_ascii=False)
    with db._connect() as c:
        c.execute(f"UPDATE reco_tracks SET {', '.join(f'{k} = ?' for k in fields)} WHERE key = ?", (*fields.values(), key))


def _track(d: Dict[str, Any]) -> Dict[str, Any]:
    for k in ("artists", "tags"):
        try:
            d[k] = json.loads(d[k]) if d.get(k) else []
        except ValueError:
            d[k] = []
    return d


def tracks(keys: Optional[Iterable[str]] = None) -> Dict[str, Dict[str, Any]]:
    with db._connect() as c:
        if keys is None:
            rs = c.execute(f"SELECT {', '.join(TRACK_COLS)} FROM reco_tracks").fetchall()
        else:
            ks = list(set(keys))
            rs = []
            for i in range(0, len(ks), 500):
                part = ks[i:i + 500]
                rs += c.execute(f"SELECT {', '.join(TRACK_COLS)} FROM reco_tracks WHERE key IN ({','.join('?' * len(part))})", part).fetchall()
    return {d["key"]: _track(d) for d in _rows(TRACK_COLS, rs)}


def tracks_needing(field: str, limit: int, platform: Optional[str] = None, where: str = "") -> List[Dict[str, Any]]:
    """field（meta_at / judged_at / ytm_at）がまだの曲。消えた動画は除く"""
    q = f"SELECT {', '.join(TRACK_COLS)} FROM reco_tracks WHERE {field} IS NULL AND COALESCE(gone, 0) = 0"
    args: List[Any] = []
    if platform:
        q += " AND platform = ?"
        args.append(platform)
    if where:
        q += " AND " + where
    q += " LIMIT ?"
    args.append(limit)
    with db._connect() as c:
        return [_track(d) for d in _rows(TRACK_COLS, c.execute(q, args).fetchall())]


# ---------------------------------------------------------------- events

def add_events(rows: Iterable[Dict[str, Any]]) -> int:
    """rows: guild_id, key, kind, user_id, user_name, at, channel_id, ref（ref が同じものは入れない）"""
    n = 0
    with db._connect() as c:
        for r in rows:
            cur = c.execute("INSERT OR IGNORE INTO reco_events (guild_id, key, kind, user_id, user_name, at, channel_id, ref) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (r["guild_id"], r["key"], r["kind"], r.get("user_id"), r.get("user_name"), r["at"],
                             r.get("channel_id"), r["ref"]))
            n += cur.rowcount
    return n


def events(guild_id: str) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(EVENT_COLS, c.execute(f"SELECT {', '.join(EVENT_COLS)} FROM reco_events WHERE guild_id = ? ORDER BY at",
                                           (guild_id,)).fetchall())


def event_keys(guild_id: Optional[str] = None) -> List[str]:
    with db._connect() as c:
        if guild_id:
            return [r[0] for r in c.execute("SELECT DISTINCT key FROM reco_events WHERE guild_id = ?", (guild_id,))]
        return [r[0] for r in c.execute("SELECT DISTINCT key FROM reco_events")]


def delete_events(ref_prefix: str) -> None:
    with db._connect() as c:
        c.execute("DELETE FROM reco_events WHERE ref LIKE ?", (ref_prefix + "%",))


# ---------------------------------------------------------------- box

def box_add(guild_id: str, key: str, url: str, user_id: str, user_name: Optional[str], image: Optional[str]) -> int:
    with db._connect() as c:
        cur = c.execute("INSERT INTO reco_box (guild_id, key, url, added_by_id, added_by_name, added_by_image, added_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)", (guild_id, key, url, user_id, user_name, image, now_iso()))
        return cur.lastrowid


def box_list(guild_id: str, limit: int = 60) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(BOX_COLS, c.execute(f"SELECT {', '.join(BOX_COLS)} FROM reco_box WHERE guild_id = ? AND removed_at IS NULL "
                                         "ORDER BY added_at DESC LIMIT ?", (guild_id, limit)).fetchall())


def box_get(box_id: int) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(BOX_COLS)} FROM reco_box WHERE id = ?", (box_id,)).fetchone()
    return dict(zip(BOX_COLS, r)) if r else None


def box_remove(box_id: int) -> None:
    with db._connect() as c:
        c.execute("UPDATE reco_box SET removed_at = ? WHERE id = ?", (now_iso(), box_id))
        c.execute("DELETE FROM reco_events WHERE ref = ?", (f"box:{box_id}",))


def box_count_since(guild_id: str, user_id: str, since_iso: str) -> int:
    with db._connect() as c:
        return c.execute("SELECT COUNT(*) FROM reco_box WHERE guild_id = ? AND added_by_id = ? AND added_at >= ?",
                         (guild_id, user_id, since_iso)).fetchone()[0]


# ---------------------------------------------------------------- feedback

def add_feedback(guild_id: str, user_id: str, key: str, action: str, mood: Optional[str]) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO reco_feedback (guild_id, user_id, key, action, mood, at) VALUES (?, ?, ?, ?, ?, ?)",
                  (guild_id, user_id, key, action, mood, now_iso()))


def feedback_since(guild_id: str, days: float) -> List[Dict[str, Any]]:
    with db._connect() as c:
        return _rows(("user_id", "key", "action", "mood", "at"),
                     c.execute("SELECT user_id, key, action, mood, at FROM reco_feedback WHERE guild_id = ? AND at >= ?",
                               (guild_id, ago(days))).fetchall())


# ---------------------------------------------------------------- radio（関連のキャッシュ）

def radio_get(key: str, source: str, max_age_days: float) -> Optional[List[Dict[str, Any]]]:
    with db._connect() as c:
        r = c.execute("SELECT items, fetched_at FROM reco_radio WHERE key = ?", (f"{source}|{key}",)).fetchone()
    if not r or r[1] < ago(max_age_days):
        return None
    try:
        return json.loads(r[0])
    except ValueError:
        return None


def radio_all(source: str, keys: Iterable[str]) -> Dict[str, List[Dict[str, Any]]]:
    ks = [f"{source}|{k}" for k in set(keys)]
    out: Dict[str, List[Dict[str, Any]]] = {}
    with db._connect() as c:
        for i in range(0, len(ks), 500):
            part = ks[i:i + 500]
            for k, items in c.execute(f"SELECT key, items FROM reco_radio WHERE key IN ({','.join('?' * len(part))})", part):
                try:
                    out[k.split("|", 1)[1]] = json.loads(items)
                except ValueError:
                    pass
    return out


def radio_set(key: str, source: str, items: List[Dict[str, Any]]) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO reco_radio (key, source, items, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET "
                  "items = excluded.items, fetched_at = excluded.fetched_at",
                  (f"{source}|{key}", source, json.dumps(items, ensure_ascii=False), now_iso()))
