"""調査レポートの DB（同じ uploaded_songs.db）。同期関数なので呼ぶ側は asyncio.to_thread で。"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .. import db

COLS = ("id", "guild_id", "kind", "title", "markdown", "sources", "status", "question", "asked_by", "asked_by_name",
        "model", "cost", "sec", "error", "created_at", "done_at", "posted_at")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init() -> None:
    with db._connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS research_reports (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, kind TEXT NOT NULL, "
                  "title TEXT, markdown TEXT, sources TEXT, status TEXT NOT NULL, question TEXT, asked_by TEXT, asked_by_name TEXT, "
                  "model TEXT, cost REAL, sec REAL, error TEXT, created_at TEXT NOT NULL, done_at TEXT, posted_at TEXT)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_research_guild ON research_reports (guild_id, created_at DESC)")


def _row(r) -> Dict[str, Any]:
    d = dict(zip(COLS, r))
    try:
        d["sources"] = json.loads(d["sources"] or "[]")
    except ValueError:
        d["sources"] = []
    return d


def create(guild_id: str, kind: str, *, question: Optional[str] = None, asked_by: Optional[str] = None,
           asked_by_name: Optional[str] = None, title: Optional[str] = None) -> int:
    with db._connect() as c:
        cur = c.execute("INSERT INTO research_reports (guild_id, kind, title, status, question, asked_by, asked_by_name, created_at) "
                        "VALUES (?, ?, ?, 'running', ?, ?, ?, ?)", (guild_id, kind, title, question, asked_by, asked_by_name, now_iso()))
        return cur.lastrowid


def finish(rid: int, *, title: str, markdown: str, sources: List[Dict[str, str]], model: str, cost: float, sec: float) -> None:
    with db._connect() as c:
        c.execute("UPDATE research_reports SET status = 'done', title = ?, markdown = ?, sources = ?, model = ?, cost = ?, sec = ?, done_at = ? "
                  "WHERE id = ?", (title, markdown, json.dumps(sources, ensure_ascii=False), model, cost, sec, now_iso(), rid))


def fail(rid: int, error: str) -> None:
    with db._connect() as c:
        c.execute("UPDATE research_reports SET status = 'failed', error = ?, done_at = ? WHERE id = ?", (error[:300], now_iso(), rid))


def mark_posted(rid: int) -> None:
    with db._connect() as c:
        c.execute("UPDATE research_reports SET posted_at = ? WHERE id = ?", (now_iso(), rid))


def get(rid: int) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(COLS)} FROM research_reports WHERE id = ?", (rid,)).fetchone()
    return _row(r) if r else None


def feed(guild_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    with db._connect() as c:
        # 失敗した定期の調査は出さない。質問は失敗も出す（頼んだ人に「調べられなかった」と分かるように）
        rows = c.execute(f"SELECT {', '.join(COLS)} FROM research_reports WHERE guild_id = ? AND (status != 'failed' OR kind = 'question') "
                         "ORDER BY created_at DESC LIMIT ?", (guild_id, limit)).fetchall()
    return [_row(r) for r in rows]


def last_of(guild_id: str, kind: str) -> Optional[Dict[str, Any]]:
    with db._connect() as c:
        r = c.execute(f"SELECT {', '.join(COLS)} FROM research_reports WHERE guild_id = ? AND kind = ? AND status = 'done' "
                      "ORDER BY created_at DESC LIMIT 1", (guild_id, kind)).fetchone()
    return _row(r) if r else None


def day_start() -> datetime:
    """「1 日」の区切り（JST 5 時。夜中の 1〜4 時は前の日のうち）"""
    now = datetime.now(timezone(timedelta(hours=9)))
    start = now.replace(hour=5, minute=0, second=0, microsecond=0)
    return start if now >= start else start - timedelta(days=1)


def asked_today(user_id: str) -> int:
    since = day_start().astimezone(timezone.utc).isoformat()
    with db._connect() as c:
        # 調べられなかった質問は数えない
        return c.execute("SELECT COUNT(*) FROM research_reports WHERE kind = 'question' AND asked_by = ? AND created_at >= ? "
                         "AND status != 'failed'", (user_id, since)).fetchone()[0]


def stale_running(minutes: int = 20) -> None:
    """落ちて止まった「調べ中」を失敗にする（起動時）"""
    since = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    with db._connect() as c:
        c.execute("UPDATE research_reports SET status = 'failed', error = 'interrupted' WHERE status = 'running' AND created_at < ?", (since,))


def asked_today_guild(guild_id: str) -> int:
    """そのサーバーの今日の質問（調べられなかったものは数えない）"""
    since = day_start().astimezone(timezone.utc).isoformat()
    with db._connect() as c:
        return c.execute("SELECT COUNT(*) FROM research_reports WHERE kind = 'question' AND guild_id = ? AND created_at >= ? "
                         "AND status != 'failed'", (guild_id, since)).fetchone()[0]
