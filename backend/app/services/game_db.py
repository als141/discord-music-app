"""ゲーム置き場の DB 操作（表の定義は db.init_db）。同期関数なので呼ぶ側は asyncio.to_thread で。"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .. import db

GAME_COLS = ("appid", "name", "type", "header_image", "short_desc", "is_free", "price_initial", "price_final",
             "discount_percent", "currency", "release_text", "coming_soon", "categories", "genres", "review_desc",
             "review_total", "review_pct", "current_players", "players_at", "profile", "profile_at", "fullgame_appid",
             "details_at", "price_at", "fail_count")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(cols, r) -> Dict[str, Any]:
    return dict(zip(cols, r))


# ---------------------------------------------------------------- kv

def kv_get(key: str) -> Optional[str]:
    with db._connect() as c:
        r = c.execute("SELECT value FROM app_kv WHERE key = ?", (key,)).fetchone()
    return r[0] if r else None


def kv_set(key: str, value: str) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET "
                  "value = excluded.value, updated_at = excluded.updated_at", (key, value, now_iso()))


# ---------------------------------------------------------------- posts

def add_post(*, guild_id: str, channel_id: str, message_id: str, kind: str, url: str, ref: str,
             posted_by_id: str, posted_by_name: str, posted_by_image: str, posted_at: str) -> bool:
    appid = ref if kind == "steam" else None
    with db._connect() as c:
        cur = c.execute(
            """INSERT OR IGNORE INTO game_posts (guild_id, channel_id, message_id, kind, url, ref, appid,
               posted_by_id, posted_by_name, posted_by_image, posted_at, resolved)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (guild_id, channel_id, message_id, kind, url, ref, appid, posted_by_id, posted_by_name, posted_by_image,
             posted_at, 0 if kind in ("steam", "x") else 1))
        return cur.rowcount > 0


POST_COLS = ("id", "guild_id", "channel_id", "message_id", "kind", "url", "ref", "appid", "x_text", "posted_by_id",
             "posted_by_name", "posted_by_image", "posted_at", "resolved", "tries")


def pending_posts(limit: int = 30) -> List[Dict[str, Any]]:
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(POST_COLS)} FROM game_posts WHERE resolved = 0 AND tries < 3 "
                         "ORDER BY posted_at DESC LIMIT ?", (limit,)).fetchall()
    return [_row(POST_COLS, r) for r in rows]


def update_post(post_id: int, **fields) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db._connect() as c:
        c.execute(f"UPDATE game_posts SET {sets} WHERE id = ?", (*fields.values(), post_id))


def posts_for_guild(guild_id: str) -> List[Dict[str, Any]]:
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(POST_COLS)} FROM game_posts WHERE guild_id = ? ORDER BY posted_at",
                         (guild_id,)).fetchall()
    return [_row(POST_COLS, r) for r in rows]


def news_for_app(appid: str, limit: int = 3) -> List[str]:
    with db._connect() as c:
        rows = c.execute("SELECT x_text FROM game_posts WHERE appid = ? AND x_text IS NOT NULL ORDER BY posted_at DESC "
                         "LIMIT ?", (appid, limit)).fetchall()
    return [r[0] for r in rows if r[0]]


# ---------------------------------------------------------------- games

def get_game(appid: str) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(GAME_COLS)} FROM games WHERE appid = ?", (appid,)).fetchone()
    return _row(GAME_COLS, r) if r else None


def upsert_game(appid: str, **fields) -> None:
    fields = {k: v for k, v in fields.items() if k in GAME_COLS and k != "appid"}
    with db._connect() as c:
        c.execute("INSERT OR IGNORE INTO games (appid) VALUES (?)", (appid,))
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            c.execute(f"UPDATE games SET {sets} WHERE appid = ?", (*fields.values(), appid))


def all_games(appids: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    with db._connect() as c:
        if appids is None:
            rows = c.execute(f"SELECT {', '.join(GAME_COLS)} FROM games").fetchall()
        else:
            ids = list(appids)
            if not ids:
                return []
            rows = c.execute(f"SELECT {', '.join(GAME_COLS)} FROM games WHERE appid IN ({','.join('?' for _ in ids)})",
                             ids).fetchall()
    return [_row(GAME_COLS, r) for r in rows]


def record_price(appid: str, price_final: Optional[int], discount: int) -> Optional[Tuple[int, Optional[int]]]:
    """今日の価格を記録。直前の記録（discount, price_final）を返す"""
    day = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    with db._connect() as c:
        prev = c.execute("SELECT discount_percent, price_final FROM game_price_history WHERE appid = ? AND day < ? "
                         "ORDER BY day DESC LIMIT 1", (appid, day)).fetchone()
        c.execute("INSERT INTO game_price_history (appid, day, price_final, discount_percent) VALUES (?, ?, ?, ?) "
                  "ON CONFLICT(appid, day) DO UPDATE SET price_final = excluded.price_final, "
                  "discount_percent = excluded.discount_percent", (appid, day, price_final, discount))
    return (prev[0], prev[1]) if prev else None


def lowest_price(appid: str) -> Optional[int]:
    with db._connect() as c:
        r = c.execute("SELECT MIN(price_final) FROM game_price_history WHERE appid = ? AND price_final IS NOT NULL",
                      (appid,)).fetchone()
    return r[0] if r else None


def add_deal_event(*, kind: str, appid: Optional[str] = None, offer_id: Optional[str] = None,
                   discount: Optional[int] = None, price_final: Optional[int] = None) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO game_deal_events (appid, offer_id, kind, discount_percent, price_final, at) "
                  "VALUES (?, ?, ?, ?, ?, ?)", (appid, offer_id, kind, discount, price_final, now_iso()))


def deal_events_since(since_iso: str) -> List[Dict[str, Any]]:
    cols = ("id", "appid", "offer_id", "kind", "discount_percent", "price_final", "at")
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(cols)} FROM game_deal_events WHERE at > ? ORDER BY at", (since_iso,)).fetchall()
    return [_row(cols, r) for r in rows]


# ---------------------------------------------------------------- offers

OFFER_COLS = ("id", "source", "title", "url", "image", "appid", "starts_at", "ends_at", "active", "updated_at")


def upsert_offer(o: Dict[str, Any]) -> bool:
    """新しい無料配布なら True"""
    with db._connect() as c:
        prev = c.execute("SELECT active FROM free_offers WHERE id = ?", (o["id"],)).fetchone()
        values = {**{k: o.get(k) for k in OFFER_COLS}, "active": 1 if o.get("active") else 0, "updated_at": now_iso()}
        c.execute(f"INSERT INTO free_offers ({', '.join(OFFER_COLS)}) VALUES ({', '.join('?' for _ in OFFER_COLS)}) "
                  "ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, image = excluded.image, "
                  "appid = COALESCE(excluded.appid, free_offers.appid), starts_at = excluded.starts_at, "
                  "ends_at = excluded.ends_at, active = excluded.active, updated_at = excluded.updated_at",
                  tuple(values[k] for k in OFFER_COLS))
    return prev is None or (o.get("active") and not prev[0])


def current_offers() -> List[Dict[str, Any]]:
    now = now_iso()
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(OFFER_COLS)} FROM free_offers WHERE ends_at IS NULL OR ends_at > ? "
                         "ORDER BY active DESC, starts_at", (now,)).fetchall()
    return [_row(OFFER_COLS, r) for r in rows]


def get_offer(offer_id: str) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(OFFER_COLS)} FROM free_offers WHERE id = ?", (offer_id,)).fetchone()
    return _row(OFFER_COLS, r) if r else None


# ---------------------------------------------------------------- members / marks

def upsert_member(guild_id: str, user_id: str, name: Optional[str], image: Optional[str]) -> None:
    if not user_id:
        return
    with db._connect() as c:
        c.execute("INSERT INTO guild_members (guild_id, user_id, name, image, updated_at) VALUES (?, ?, ?, ?, ?) "
                  "ON CONFLICT(guild_id, user_id) DO UPDATE SET name = COALESCE(excluded.name, guild_members.name), "
                  "image = COALESCE(excluded.image, guild_members.image), updated_at = excluded.updated_at",
                  (guild_id, user_id, name, image, now_iso()))


def members(guild_id: str) -> Dict[str, Dict[str, Optional[str]]]:
    with db._connect() as c:
        rows = c.execute("SELECT user_id, name, image FROM guild_members WHERE guild_id = ?", (guild_id,)).fetchall()
    return {r[0]: {"name": r[1], "image": r[2]} for r in rows}


def set_mark(guild_id: str, user_id: str, appid: str, kind: str, on: bool) -> None:
    with db._connect() as c:
        if on:
            c.execute("INSERT OR IGNORE INTO game_marks (guild_id, user_id, appid, kind, created_at) VALUES (?, ?, ?, ?, ?)",
                      (guild_id, user_id, appid, kind, now_iso()))
        else:
            c.execute("DELETE FROM game_marks WHERE guild_id = ? AND user_id = ? AND appid = ? AND kind = ?",
                      (guild_id, user_id, appid, kind))


def marks(guild_id: str) -> Dict[str, Dict[str, List[str]]]:
    """appid -> {want: [user], own: [user]}"""
    out: Dict[str, Dict[str, List[str]]] = {}
    with db._connect() as c:
        for uid, appid, kind in c.execute("SELECT user_id, appid, kind FROM game_marks WHERE guild_id = ?", (guild_id,)):
            out.setdefault(appid, {"want": [], "own": []}).setdefault(kind, []).append(uid)
    return out


# ---------------------------------------------------------------- presence / voice

def close_open_sessions(guild_id: Optional[str] = None) -> None:
    with db._connect() as c:
        if guild_id:
            c.execute("UPDATE game_sessions SET ended_at = ? WHERE ended_at IS NULL AND guild_id = ?", (now_iso(), guild_id))
        else:
            c.execute("UPDATE game_sessions SET ended_at = ? WHERE ended_at IS NULL", (now_iso(),))


def open_session(guild_id: str, user_id: str, game_name: str, discord_app_id: Optional[str], appid: Optional[str]) -> int:
    with db._connect() as c:
        c.execute("UPDATE game_sessions SET ended_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL",
                  (now_iso(), guild_id, user_id))
        cur = c.execute("INSERT INTO game_sessions (guild_id, user_id, game_name, discord_app_id, appid, started_at) "
                        "VALUES (?, ?, ?, ?, ?, ?)", (guild_id, user_id, game_name, discord_app_id, appid, now_iso()))
        return int(cur.lastrowid)


def end_session(guild_id: str, user_id: str) -> None:
    with db._connect() as c:
        c.execute("UPDATE game_sessions SET ended_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL",
                  (now_iso(), guild_id, user_id))


def set_session_appid(game_name: str, appid: Optional[str]) -> None:
    with db._connect() as c:
        c.execute("UPDATE game_sessions SET appid = ? WHERE game_name = ? AND appid IS NULL", (appid, game_name))


def open_sessions(guild_id: str) -> List[Dict[str, Any]]:
    cols = ("user_id", "game_name", "appid", "started_at")
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(cols)} FROM game_sessions WHERE guild_id = ? AND ended_at IS NULL",
                         (guild_id,)).fetchall()
    return [_row(cols, r) for r in rows]


def recent_play(guild_id: str, days: int = 30, min_minutes: int = 5) -> List[Dict[str, Any]]:
    """最近遊ばれたゲーム（短すぎる起動は除く）: game_name, appid, users, last_at"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out: Dict[str, Dict[str, Any]] = {}
    with db._connect() as c:
        rows = c.execute("SELECT user_id, game_name, appid, started_at, ended_at FROM game_sessions "
                         "WHERE guild_id = ? AND started_at > ?", (guild_id, since)).fetchall()
    now = datetime.now(timezone.utc)
    for uid, name, appid, st, en in rows:
        try:
            dur = ((datetime.fromisoformat(en) if en else now) - datetime.fromisoformat(st)).total_seconds() / 60
        except ValueError:
            continue
        if dur < min_minutes and en:
            continue
        key = appid or f"name:{name}"
        g = out.setdefault(key, {"game_name": name, "appid": appid, "users": set(), "last_at": st, "minutes": 0})
        g["users"].add(uid)
        g["minutes"] += dur
        g["last_at"] = max(g["last_at"], en or now.isoformat())
    for g in out.values():
        g["users"] = sorted(g["users"])
        g["minutes"] = round(g["minutes"])
    return sorted(out.values(), key=lambda g: g["last_at"], reverse=True)


def save_steam_link(user_id: str, steamid: str, name: Optional[str], avatar: Optional[str], public: bool,
                    owned: Optional[List[Dict[str, Any]]], wishlist: Optional[List[str]]) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO steam_links (user_id, steamid, name, avatar, public, games_count, linked_at, synced_at) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET steamid = excluded.steamid, "
                  "name = excluded.name, avatar = excluded.avatar, public = excluded.public, "
                  "games_count = excluded.games_count, synced_at = excluded.synced_at",
                  (user_id, steamid, name, avatar, 1 if public else 0, len(owned) if owned is not None else None,
                   now_iso(), now_iso()))
        if owned is not None:
            c.execute("DELETE FROM steam_owned WHERE user_id = ?", (user_id,))
            c.executemany("INSERT INTO steam_owned (user_id, appid, playtime_min, playtime_2w) VALUES (?, ?, ?, ?)",
                          [(user_id, g["appid"], g["playtime_min"], g["playtime_2w"]) for g in owned])
        if wishlist is not None:
            c.execute("DELETE FROM steam_wishlist WHERE user_id = ?", (user_id,))
            c.executemany("INSERT INTO steam_wishlist (user_id, appid) VALUES (?, ?)", [(user_id, a) for a in wishlist])


def delete_steam_link(user_id: str) -> None:
    with db._connect() as c:
        for t in ("steam_links", "steam_owned", "steam_wishlist"):
            c.execute(f"DELETE FROM {t} WHERE user_id = ?", (user_id,))


def get_steam_link(user_id: str) -> Optional[Dict[str, Any]]:
    cols = ("user_id", "steamid", "name", "avatar", "public", "games_count", "linked_at", "synced_at")
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(cols)} FROM steam_links WHERE user_id = ?", (user_id,)).fetchone()
    return _row(cols, r) if r else None


def steam_links_all() -> List[Dict[str, Any]]:
    with db._connect() as c:
        return [{"user_id": r[0], "steamid": r[1], "synced_at": r[2]} for r in
                c.execute("SELECT user_id, steamid, synced_at FROM steam_links")]


def steam_ownership(appids: Iterable[str]) -> Dict[str, Dict[str, List[str]]]:
    """appid -> {own: [user], recent: [user (2 週間以内に遊んだ)], want: [user]}（Steam 連携した人の分だけ）"""
    ids = list(appids)
    out: Dict[str, Dict[str, List[str]]] = {}
    if not ids:
        return out
    marks = ",".join("?" for _ in ids)
    with db._connect() as c:
        for uid, appid, p2w in c.execute(f"SELECT user_id, appid, playtime_2w FROM steam_owned WHERE appid IN ({marks})", ids):
            e = out.setdefault(appid, {"own": [], "recent": [], "want": []})
            e["own"].append(uid)
            if p2w:
                e["recent"].append(uid)
        for uid, appid in c.execute(f"SELECT user_id, appid FROM steam_wishlist WHERE appid IN ({marks})", ids):
            out.setdefault(appid, {"own": [], "recent": [], "want": []})["want"].append(uid)
    return out


def get_name_map(name: str) -> Tuple[bool, Optional[str]]:
    with db._connect() as c:
        r = c.execute("SELECT appid FROM game_name_map WHERE name = ?", (name,)).fetchone()
    return (True, r[0]) if r else (False, None)


def set_name_map(name: str, appid: Optional[str]) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO game_name_map (name, appid, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET "
                  "appid = excluded.appid, updated_at = excluded.updated_at", (name, appid, now_iso()))


def replace_voice_presence(guild_id: str, rows: List[Dict[str, Any]]) -> None:
    with db._connect() as c:
        prev = {r[0]: r[1] for r in c.execute("SELECT user_id, joined_at FROM voice_presence WHERE guild_id = ?", (guild_id,))}
        c.execute("DELETE FROM voice_presence WHERE guild_id = ?", (guild_id,))
        for r in rows:
            c.execute("INSERT INTO voice_presence (guild_id, user_id, user_name, user_image, channel_id, channel_name, joined_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)", (guild_id, r["user_id"], r.get("user_name"), r.get("user_image"),
                                                       r["channel_id"], r.get("channel_name"), prev.get(r["user_id"]) or now_iso()))


def voice_presence(guild_id: str) -> List[Dict[str, Any]]:
    cols = ("user_id", "user_name", "user_image", "channel_id", "channel_name", "joined_at")
    with db._connect() as c:
        rows = c.execute(f"SELECT {', '.join(cols)} FROM voice_presence WHERE guild_id = ? ORDER BY joined_at",
                         (guild_id,)).fetchall()
    return [_row(cols, r) for r in rows]


def delete_sessions_for(user_ids) -> None:
    ids = [user_ids] if isinstance(user_ids, str) else list(user_ids)
    if not ids:
        return
    with db._connect() as c:
        c.executemany("DELETE FROM game_sessions WHERE user_id = ?", [(u,) for u in ids])


def prune_sessions(days: int = 120) -> None:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with db._connect() as c:
        c.execute("DELETE FROM game_sessions WHERE started_at < ?", (since,))


def loads(s: Optional[str], default):
    try:
        return json.loads(s) if s else default
    except (TypeError, ValueError):
        return default
