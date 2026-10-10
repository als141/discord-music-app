"""募集（ロビー）。

ゲーム探しのカスタマージャーニー（2026-10-11、Discord 全期間の匿名集計）から:
- いちばんの壁は人数（「あと N 人」177 件）。「揃ったら教えて」が 2.5 年でただ一つの明示的な要望
- 誘いの 66% が 19〜23 時、最初の反応まで中央値 22 分、1 時間で 2 人反応は 36%。誘う人は 3 人で 76%
- 実際の誘いの 8 割はゲーム名なし（「今日なんかやる人」）→ ゲームは任意

ルール:
- イリーナは Discord に投稿しない。呼びかけは、誘う人が「Discord に貼る」の文面（<@id> 付き）を自分で貼る
- 「揃った」の通知は「行く」を押した人だけ（押したこと＝同意）。VC に入った人も行く扱いで数える
- 開始から 2 時間で自動で締める。立てた人はいつでも締められる
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .. import db
from ..services import game_db as gdb

JST = timezone(timedelta(hours=9))
OPEN_HOURS_AFTER_START = 2
MAX_OPEN_PER_HOST = 1


def now() -> datetime:
    return datetime.now(timezone.utc)


def init() -> None:
    with db._connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS lobbies (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, host_id TEXT NOT NULL, "
                  "appid TEXT, title TEXT, need INTEGER NOT NULL, start_at TEXT NOT NULL, created_at TEXT NOT NULL, "
                  "closed_at TEXT, close_reason TEXT, full_notified_at TEXT)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_lobbies_open ON lobbies (guild_id, closed_at)")
        c.execute("CREATE TABLE IF NOT EXISTS lobby_members (lobby_id INTEGER NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, "
                  "source TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (lobby_id, user_id))")
        c.execute("CREATE TABLE IF NOT EXISTS lobby_invites (lobby_id INTEGER NOT NULL, user_id TEXT NOT NULL, "
                  "PRIMARY KEY (lobby_id, user_id))")
        # Discord 側（voice プロセスの irina_discord が投稿・編集・イベント作成）
        for col in ("origin TEXT", "discord_channel_id TEXT", "discord_message_id TEXT", "render_hash TEXT",
                    "full_announced_at TEXT", "event_id TEXT", "created_notified_at TEXT"):
            try:
                c.execute(f"ALTER TABLE lobbies ADD COLUMN {col}")
            except Exception:
                pass  # 既にある


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat()


def parse_start(start: str) -> datetime:
    """'now' か 'HH:MM'（JST、もう過ぎていれば翌日ではなく「今から」扱い）"""
    if not start or start == "now":
        return now()
    try:
        h, m = (int(x) for x in start.split(":"))
    except ValueError:
        raise ValueError("start は now か HH:MM")
    t = datetime.now(JST).replace(hour=h % 24, minute=m % 60, second=0, microsecond=0)
    # 深夜 0〜5 時の指定は「今夜の続き」なので、今が夕方以降なら翌日の時刻
    if t < datetime.now(JST) - timedelta(minutes=30):
        t = t + timedelta(days=1) if h < 6 else datetime.now(JST)
    return t.astimezone(timezone.utc)


def _members(c, lobby_id: int) -> List[Dict[str, Any]]:
    return [{"user_id": r[0], "status": r[1], "source": r[2], "at": r[3]}
            for r in c.execute("SELECT user_id, status, source, at FROM lobby_members WHERE lobby_id = ? ORDER BY at", (lobby_id,))]


LOBBY_COLS = ("id", "guild_id", "host_id", "appid", "title", "need", "start_at", "created_at", "closed_at", "close_reason",
              "full_notified_at", "origin", "discord_channel_id", "discord_message_id", "render_hash", "full_announced_at",
              "event_id", "created_notified_at")
_SEL = "SELECT " + ", ".join(LOBBY_COLS) + " FROM lobbies"


def _row(c, r) -> Dict[str, Any]:
    keys = LOBBY_COLS
    d = dict(zip(keys, r))
    d["members"] = _members(c, d["id"])
    d["invited"] = [x[0] for x in c.execute("SELECT user_id FROM lobby_invites WHERE lobby_id = ?", (d["id"],))]
    d["going"] = [m["user_id"] for m in d["members"] if m["status"] == "going"]
    return d


def list_open(guild_id: str) -> List[Dict[str, Any]]:
    with db._connect() as c:
        rows = c.execute(_SEL + " WHERE guild_id = ? AND closed_at IS NULL ORDER BY start_at", (guild_id,)).fetchall()
        return [_row(c, r) for r in rows]


def get(lobby_id: int) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(_SEL + " WHERE id = ?", (lobby_id,)).fetchone()
        return _row(c, r) if r else None


def create(guild_id: str, host_id: str, *, appid: Optional[str], title: Optional[str], need: int, start: str,
           invite: List[str], origin: str = "app", discord_channel_id: Optional[str] = None,
           discord_message_id: Optional[str] = None) -> Dict[str, Any]:
    start_at = parse_start(start)
    with db._connect() as c:
        open_by_host = c.execute("SELECT COUNT(*) FROM lobbies WHERE guild_id = ? AND host_id = ? AND closed_at IS NULL",
                                 (guild_id, host_id)).fetchone()[0]
        if open_by_host >= MAX_OPEN_PER_HOST:
            raise ValueError("募集中のものがあります。締めてから新しく立ててください")
        recent = c.execute("SELECT COUNT(*) FROM lobbies WHERE host_id = ? AND created_at >= ?",
                           (host_id, _iso(now() - timedelta(hours=1)))).fetchone()[0]
        if recent >= 6:
            raise ValueError("少し待ってからもう一度立ててください")
        cur = c.execute("INSERT INTO lobbies (guild_id, host_id, appid, title, need, start_at, created_at, origin, discord_channel_id, "
                        "discord_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (guild_id, host_id, appid, title, need, _iso(start_at), _iso(now()), origin, discord_channel_id, discord_message_id))
        lid = cur.lastrowid
        c.execute("INSERT INTO lobby_members (lobby_id, user_id, status, source, at) VALUES (?, ?, 'going', 'host', ?)",
                  (lid, host_id, _iso(now())))
        c.executemany("INSERT OR IGNORE INTO lobby_invites (lobby_id, user_id) VALUES (?, ?)",
                      [(lid, u) for u in invite if u != host_id][:12])
    return get(lid)


def set_status(lobby_id: int, user_id: str, status: str) -> Dict[str, Any]:
    with db._connect() as c:
        if status == "none":
            c.execute("DELETE FROM lobby_members WHERE lobby_id = ? AND user_id = ? AND source != 'host'", (lobby_id, user_id))
        else:
            c.execute("INSERT INTO lobby_members (lobby_id, user_id, status, source, at) VALUES (?, ?, ?, 'tap', ?) "
                      "ON CONFLICT(lobby_id, user_id) DO UPDATE SET status = excluded.status, at = excluded.at",
                      (lobby_id, user_id, status, _iso(now())))
    return get(lobby_id)


def update_fields(lobby_id: int, **fields) -> None:
    keys = [k for k in fields if k in LOBBY_COLS and k != "id"]
    if not keys:
        return
    with db._connect() as c:
        c.execute(f"UPDATE lobbies SET {', '.join(k + ' = ?' for k in keys)} WHERE id = ?", [fields[k] for k in keys] + [lobby_id])


def recently_closed(guild_id: Optional[str] = None, hours: float = 6) -> List[Dict[str, Any]]:
    """締めたばかりの募集（Discord のメッセージとイベントの後始末用）"""
    since = _iso(now() - timedelta(hours=hours))
    with db._connect() as c:
        q = _SEL + " WHERE closed_at IS NOT NULL AND closed_at >= ?"
        args: List[Any] = [since]
        if guild_id:
            q += " AND guild_id = ?"
            args.append(guild_id)
        return [_row(c, r) for r in c.execute(q, args).fetchall()]


def what(lb: Dict[str, Any]) -> str:
    g = gdb.get_game(lb["appid"]) if lb.get("appid") else None
    return (g or {}).get("name") or lb.get("title") or "なにかやる"


def when(lb: Dict[str, Any]) -> str:
    start = datetime.fromisoformat(lb["start_at"]).astimezone(JST)
    return "今から" if start <= datetime.now(JST) + timedelta(minutes=5) else f"{start:%-H:%M}〜"


async def notify_created(lb: Dict[str, Any]) -> None:
    """募集が立ったら、まだ行くを押していない人へ（オーナー指定 2026-10-11）。
    「募集が立ったら」（game_lobby、既定オン）を切った人と、もう VC にいる人には送らない。1 人 20 分に 1 回まで"""
    from ..services import push
    if not push.configured() or lb.get("created_notified_at"):
        return
    update_fields(lb["id"], created_notified_at=_iso(now()))
    prefs = await asyncio.to_thread(db.get_all_notif_prefs)
    in_vc = {v["user_id"] for v in await asyncio.to_thread(gdb.voice_presence, lb["guild_id"])}
    members = set(await asyncio.to_thread(lambda: list(gdb.members(lb["guild_id"]).keys())))
    devices = await asyncio.to_thread(db.list_push_devices, None)
    targets = []
    for uid in sorted({d["user_id"] for d in devices}):
        if uid == lb["host_id"] or uid in lb["going"] or uid in in_vc:
            continue
        if members and uid not in members and uid not in lb["invited"]:
            continue
        if not (prefs.get(uid) or db.DEFAULT_NOTIF_PREFS).get("game_lobby", True) and uid not in lb["invited"]:
            continue
        if not await asyncio.to_thread(db.throttle_ok, uid, "game_lobby", 20 * 60):
            continue
        targets.append(uid)
    send_to = [d for d in devices if d["user_id"] in targets]
    if not send_to:
        return
    host = (gdb.members(lb["guild_id"]).get(lb["host_id"]) or {}).get("name") or "だれか"
    left = max(0, lb["need"] - len(lb["going"]))
    res = await push.send_logged(kind="game_lobby", title=f"{host}の募集: {what(lb)}", body=f"{when(lb)}・あと{left}人",
                                 url=f"/?tab=games&lobby={lb['id']}", devices=send_to, ttl=3 * 3600,
                                 topic=f"irina-lobby-new-{lb['id']}", tag=f"irina-lobby-{lb['id']}")
    if res["sent"]:
        await asyncio.to_thread(db.throttle_mark, targets, "game_lobby")


def close(lobby_id: int, reason: str) -> None:
    with db._connect() as c:
        c.execute("UPDATE lobbies SET closed_at = ?, close_reason = ? WHERE id = ? AND closed_at IS NULL", (_iso(now()), reason, lobby_id))


def _mark_full(lobby_id: int) -> bool:
    with db._connect() as c:
        cur = c.execute("UPDATE lobbies SET full_notified_at = ? WHERE id = ? AND full_notified_at IS NULL", (_iso(now()), lobby_id))
        return cur.rowcount > 0


# ---------------------------------------------------------------- 見回り（web の 60 秒ループ）

async def _notify_full(lb: Dict[str, Any], in_vc: set) -> None:
    from ..services import push
    if not push.configured():
        return
    targets = [u for u in lb["going"] if u not in in_vc]
    if not targets:
        return
    devices = await asyncio.to_thread(db.list_push_devices, targets)
    if not devices:
        return
    g = gdb.get_game(lb["appid"]) if lb.get("appid") else None
    what = (g or {}).get("name") or lb.get("title") or "募集"
    start = datetime.fromisoformat(lb["start_at"]).astimezone(JST)
    when = "今から" if start <= datetime.now(JST) + timedelta(minutes=5) else f"{start:%H:%M}〜"
    await push.send_logged(kind="game_lobby_full", title=f"{what} {len(lb['going'])}人そろいました",
                           body=f"{when}・VC に集まろう", url=f"/?tab=games&lobby={lb['id']}", devices=devices,
                           ttl=3600, urgency="high", topic=f"irina-lobby-{lb['id']}", tag=f"irina-lobby-{lb['id']}")


async def tick() -> None:
    for gid in {lb["guild_id"] for lb in await asyncio.to_thread(_all_open)}:
        in_vc = {v["user_id"] for v in await asyncio.to_thread(gdb.voice_presence, gid)}
        for lb in await asyncio.to_thread(list_open, gid):
            start = datetime.fromisoformat(lb["start_at"])
            if now() > start + timedelta(hours=OPEN_HOURS_AFTER_START):
                await asyncio.to_thread(close, lb["id"], "expired")
                continue
            # 開始 30 分前から、VC にいる人は「行く」に数える（VC に入る＝乗った）
            if now() >= start - timedelta(minutes=30):
                for u in in_vc - set(m["user_id"] for m in lb["members"]):
                    await asyncio.to_thread(_add_vc_member, lb["id"], u)
                lb = await asyncio.to_thread(get, lb["id"])
            if len(lb["going"]) >= lb["need"] and not lb["full_notified_at"] and await asyncio.to_thread(_mark_full, lb["id"]):
                try:
                    await _notify_full(lb, in_vc)
                except Exception as e:
                    print(f"[lobby] notify failed: {type(e).__name__}: {str(e)[:120]}")


def _all_open() -> List[Dict[str, Any]]:
    with db._connect() as c:
        return [{"id": r[0], "guild_id": r[1]} for r in c.execute("SELECT id, guild_id FROM lobbies WHERE closed_at IS NULL")]


def _add_vc_member(lobby_id: int, user_id: str) -> None:
    with db._connect() as c:
        c.execute("INSERT OR IGNORE INTO lobby_members (lobby_id, user_id, status, source, at) VALUES (?, ?, 'going', 'vc', ?)",
                  (lobby_id, user_id, _iso(now())))


async def scheduler() -> None:
    await asyncio.sleep(20)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[lobby] tick failed: {type(e).__name__}: {str(e)[:160]}")
        await asyncio.sleep(60)
