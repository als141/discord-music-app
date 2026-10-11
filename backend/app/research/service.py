"""イリーナの調査: 定期の調べもの（web プロセスの scheduler）と、頼まれた調べもの（アプリ・/調べて）。

- 毎日 17:30 JST「今日の調査」、月曜 18:00「今週の新作」、金曜 18:00「今週の新曲」（IRINA_RESEARCH_GUILD_IDS、既定ドデカだけ。
  テストサーバーで定期の調査は回さない＝1 回 約 $0.9 なので）
- 質問は 1 人 1 日 3 回まで（IRINA_RESEARCH_DAILY_QUESTIONS）。月の上限（llm_budget）を超えたら止まる
- できたものはアプリの「調査」タブに並ぶ。Discord の bot チャンネルへの投稿と、頼んだ人への通知は、
  オーナーが管理画面で許可したときだけ（notify_gate: discord_research_digest / push_research）
"""
import asyncio
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from . import desks, engine, store
from ..services import game_db as gdb, game_shelf

JST = timezone(timedelta(hours=9))
DAILY_QUESTIONS = int(os.getenv("IRINA_RESEARCH_DAILY_QUESTIONS") or 3)
GUILD_DAILY_QUESTIONS = int(os.getenv("IRINA_RESEARCH_GUILD_DAILY") or 15)   # サーバー全体（1 回 約 $0.1〜0.2）
QUESTION_MODEL = os.getenv("IRINA_RESEARCH_QUESTION_MODEL") or engine.MODEL
STEAM_KINDS = {"weekly_new", "question"}   # steam_lookup（日本円の価格・人数）を持たせるデスク
_tasks: set = set()
SCHEDULE = {  # kind: (曜日 None=毎日 / 0=月 … 6=日, 時, 分)
    "daily": (None, 17, 30),
    "weekly_new": (0, 18, 0),
    "weekly_music": (4, 18, 0),
}


def _title(kind: str, md: str, question: Optional[str] = None) -> str:
    if kind == "question":
        return (question or "質問").strip()[:60]
    return f"{desks.TITLES.get(kind, '調査')} {datetime.now(JST):%-m/%-d}"


async def run_desk(guild_id: str, kind: str) -> Optional[int]:
    """定期の調べものを 1 回。レポートの id を返す"""
    system, prompt, urls, ms, mf = await asyncio.to_thread(desks.DESKS[kind], guild_id)
    rid = await asyncio.to_thread(store.create, guild_id, kind, title=desks.TITLES.get(kind))
    try:
        r = await engine.research(system, prompt, max_search=ms, max_fetch=mf, extra_urls=urls, purpose=f"research_{kind}",
                                  steam=kind in STEAM_KINDS, guild_id=guild_id)
    except Exception as e:
        await asyncio.to_thread(store.fail, rid, f"{type(e).__name__}: {e}")
        print(f"[research] {kind} failed: {type(e).__name__}: {str(e)[:160]}")
        return None
    if not r or not r["markdown"]:
        await asyncio.to_thread(store.fail, rid, "empty or budget")
        return None
    await asyncio.to_thread(store.finish, rid, title=_title(kind, r["markdown"]), markdown=r["markdown"], sources=r["sources"],
                            model=r["model"], cost=r["cost"], sec=r["sec"])
    await post_to_discord(rid)
    return rid


async def _check_limits(guild_id: str, user_id: str) -> None:
    """1 人 1 日 DAILY_QUESTIONS 回・サーバー全体で 1 日 GUILD_DAILY_QUESTIONS 回・月の上限。超えたら ValueError"""
    await asyncio.to_thread(store.init)
    if await asyncio.to_thread(store.asked_today, user_id) >= DAILY_QUESTIONS:
        raise ValueError(f"調べものは 1 日 {DAILY_QUESTIONS} 回までです（また明日）")
    if await asyncio.to_thread(store.asked_today_guild, guild_id) >= GUILD_DAILY_QUESTIONS:
        raise ValueError("今日はサーバー全体の調べものの上限に達しました（また明日）")
    from ..services import llm_budget
    if not await asyncio.to_thread(llm_budget.allowed, "anthropic"):
        raise ValueError("今月の調べものの上限に達しました")


async def ask(guild_id: str, user_id: str, user_name: str, q: str) -> Dict[str, Any]:
    """質問を受け付けて、裏で調べる（すぐ返す）。上限なら ValueError"""
    await _check_limits(guild_id, user_id)
    rid = await asyncio.to_thread(store.create, guild_id, "question", question=q.strip()[:500], asked_by=user_id,
                                  asked_by_name=user_name, title=q.strip()[:60])
    task = asyncio.create_task(_answer(rid, guild_id, user_id, user_name, q))
    _tasks.add(task)   # 参照を持っておかないと途中で消えることがある
    task.add_done_callback(_tasks.discard)
    return await asyncio.to_thread(store.get, rid)


async def answer_now(guild_id: str, user_id: str, user_name: str, q: str) -> Dict[str, Any]:
    """/調べて 用: その場で調べ終わるまで待つ（voice プロセスから呼ばれる）"""
    await _check_limits(guild_id, user_id)
    rid = await asyncio.to_thread(store.create, guild_id, "question", question=q.strip()[:500], asked_by=user_id,
                                  asked_by_name=user_name, title=q.strip()[:60])
    await _answer(rid, guild_id, user_id, user_name, q, notify=False)
    return await asyncio.to_thread(store.get, rid)


async def _answer(rid: int, guild_id: str, user_id: str, user_name: str, q: str, notify: bool = True) -> None:
    system, prompt, urls, ms, mf = await asyncio.to_thread(desks.question, guild_id, q, user_name or "メンバー")
    try:
        r = await engine.research(system, prompt, max_search=ms, max_fetch=mf, extra_urls=urls, purpose="research_question",
                                  model=QUESTION_MODEL, steam=True, guild_id=guild_id)
    except Exception as e:
        await asyncio.to_thread(store.fail, rid, f"{type(e).__name__}: {e}")
        print(f"[research] question failed: {type(e).__name__}: {str(e)[:160]}")
        return
    if not r or not r["markdown"]:
        await asyncio.to_thread(store.fail, rid, "empty or budget")
        return
    await asyncio.to_thread(store.finish, rid, title=_title("question", "", q), markdown=r["markdown"], sources=r["sources"],
                            model=r["model"], cost=r["cost"], sec=r["sec"])
    if notify:
        await _notify_asker(rid, user_id, q)


async def _notify_asker(rid: int, user_id: str, q: str) -> None:
    from ..services import notify_gate, push
    from .. import db
    if not push.configured() or not notify_gate.allowed("push_research"):
        return
    devices = await asyncio.to_thread(db.list_push_devices, [user_id])
    if devices:
        await push.send_logged(kind="research", title="調べ終わりました", body=q.strip()[:80], url=f"/?tab=research&r={rid}",
                               devices=devices, ttl=24 * 3600, tag=f"irina-research-{rid}")


# ---------------------------------------------------------------- Discord（bot チャンネル。オーナーが許可したときだけ）

_IRINA_LINE = re.compile(r"^\*\*イリーナ\*\*.*$", re.M)


def to_embed(rep: Dict[str, Any]) -> Dict[str, Any]:
    """Discord の埋め込み（REST 用の dict）。本文は 4000 字まで、イリーナの一言は上に"""
    md = rep.get("markdown") or ""
    irina = _IRINA_LINE.search(md)
    body = _IRINA_LINE.sub("", md).strip()
    desc = ((irina.group(0) + "\n\n") if irina else "") + body
    if len(desc) > 3900:
        desc = desc[:3900].rsplit("\n", 1)[0] + "\n…（続きはアプリで）"
    return {"title": rep.get("title") or "イリーナの調査", "description": desc, "color": 0xE0245E,
            "url": f"https://discord-music-app.vercel.app/?tab=research&r={rep['id']}",
            "footer": {"text": f"イリーナの調査 · {rep.get('model') or ''} · 出典 {len(rep.get('sources') or [])} 件"}}


async def post_to_discord(rid: int) -> None:
    from ..services import notify_gate
    from ..services.irina_discord import BOT_CHANNELS
    rep = await asyncio.to_thread(store.get, rid)
    if not rep or rep.get("posted_at") or rep["kind"] == "question":
        return
    if not notify_gate.allowed("discord_research_digest"):
        return
    ch = BOT_CHANNELS.get(rep["guild_id"])
    token = os.getenv("DISCORD_TOKEN") or ""
    if not ch or not token:
        return

    def send() -> None:
        req = urllib.request.Request(f"https://discord.com/api/v10/channels/{ch}/messages", method="POST",
                                     headers={"Authorization": f"Bot {token}", "Content-Type": "application/json",
                                              "User-Agent": "DiscordBot (https://github.com/als141/discord-music-app, 1.0)"},
                                     data=json.dumps({"embeds": [to_embed(rep)], "allowed_mentions": {"parse": []}}).encode())
        urllib.request.urlopen(req, timeout=20).read()
    try:
        await asyncio.to_thread(send)
        await asyncio.to_thread(store.mark_posted, rid)
        print(f"[research] posted #{rid} to bot channel")
    except Exception as e:
        print(f"[research] discord post failed: {type(e).__name__}: {str(e)[:120]}")


# ---------------------------------------------------------------- 定期

def _due(kind: str, gid: str) -> bool:
    dow, h, m = SCHEDULE[kind]
    now = datetime.now(JST)
    if dow is not None and now.weekday() != dow:
        return False
    if (now.hour, now.minute) < (h, m):
        return False
    return gdb.kv_get(f"research_{kind}_day:{gid}") != now.strftime("%Y-%m-%d")


async def scheduler() -> None:
    await asyncio.sleep(60)
    store.init()
    await asyncio.to_thread(store.stale_running)
    while True:
        try:
            for gid in sorted(game_shelf._ids("IRINA_RESEARCH_GUILD_IDS", game_shelf.DODEKA) & game_shelf.game_guild_ids()):
                for kind in SCHEDULE:
                    if await asyncio.to_thread(_due, kind, gid):
                        await asyncio.to_thread(gdb.kv_set, f"research_{kind}_day:{gid}", datetime.now(JST).strftime("%Y-%m-%d"))
                        await run_desk(gid, kind)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[research] scheduler error: {type(e).__name__}: {str(e)[:160]}")
        await asyncio.sleep(300)
