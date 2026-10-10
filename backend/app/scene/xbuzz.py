"""X（旧 Twitter）で話題のゲームを Grok の x_search で拾う（1 日 1 回）。

2026-10-11 の比較: grok-4.7（reasoning low）は 6 本・$0.41・22 秒、grok-4.20-multi-agent は 4 本・$1.15・118 秒
→ grok-4.7 を使う。月 約 $12。IRINA_SCENE_X=0 で止める、IRINA_SCENE_X_MODEL でモデルを変える。
根拠のポスト URL を必ず持たせ（推測で作らせない）、Steam の appid に結びつけて「話題の新作」の信号にする。
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .. import db

JST = timezone(timedelta(hours=9))
MODEL = os.getenv("IRINA_SCENE_X_MODEL") or "grok-4.7"


def enabled() -> bool:
    return bool(os.getenv("XAI_API_KEY")) and os.getenv("IRINA_SCENE_X", "1") != "0"


class Evidence(BaseModel):
    url: str = Field(description="X のポストの URL（https://x.com/<handle>/status/<id>）")
    handle: str
    summary: str = Field(description="ポストの要旨 30 文字以内")
    likes: Optional[int] = Field(description="見えればいいね数、無ければ null")


class Buzz(BaseModel):
    game: str = Field(description="ゲームの正式名（Steam の英語表記が分かればそれ）")
    game_ja: Optional[str] = Field(description="日本での呼び名（あれば）")
    players: Optional[str] = Field(description="何人で遊べるか（例: 1〜4人）")
    kind: Literal["buzz", "free", "demo", "sale", "release", "update", "streamer"]
    why: str = Field(description="X で何が話題になっているか 40 文字以内")
    evidence: List[Evidence] = Field(description="根拠のポスト 2〜3 件")


class Scout(BaseModel):
    items: List[Buzz]


def init() -> None:
    with db._connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS scene_xbuzz (id INTEGER PRIMARY KEY, at TEXT, game TEXT, game_ja TEXT, players TEXT, "
                  "kind TEXT, why TEXT, evidence TEXT, appid TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS scene_llm_cost (at TEXT, vendor TEXT, model TEXT, purpose TEXT, usd REAL)")


def log_cost(vendor: str, model: str, purpose: str, usd: float) -> None:
    with db._connect() as c:
        c.execute("INSERT INTO scene_llm_cost (at, vendor, model, purpose, usd) VALUES (?, ?, ?, ?, ?)",
                  (datetime.now(timezone.utc).isoformat(), vendor, model, purpose, usd))


def recent(days: float = 2) -> List[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with db._connect() as c:
        rows = c.execute("SELECT game, game_ja, players, kind, why, evidence, appid, at FROM scene_xbuzz WHERE at >= ? ORDER BY id",
                         (since,)).fetchall()
    out = []
    for r in rows:
        out.append({"game": r[0], "game_ja": r[1], "players": r[2], "kind": r[3], "why": r[4],
                    "evidence": json.loads(r[5] or "[]"), "appid": r[6], "at": r[7]})
    return out


async def scout() -> List[Buzz]:
    from xai_sdk import AsyncClient
    from xai_sdk.chat import system, user
    from xai_sdk.tools import x_search
    client = AsyncClient(api_key=os.getenv("XAI_API_KEY"))  # イベントループの中で作る（grpc が別ループに縛られないように）
    now = datetime.now(JST)
    prompt = (
        f"今日は {now:%Y年%m月%d日}（日本時間）。直近 7 日の日本語の X を x_search で調べて、"
        "友達 2〜8 人でボイスチャットしながら遊ぶ PC ゲーム（Steam 中心）のうち、いま日本の X で話題になっているものを最大 12 本挙げて。\n"
        "重視: バズったインディー・協力ホラー・物理系パーティ・脱出・新作・体験版・無料配布・配信者がこぞってやっているもの。\n"
        "除外: VALORANT・Apex Legends・ストリートファイター6・League of Legends・PUBG・Minecraft・Fortnite のような長年の定番（新シーズンでも除外）、ソシャゲ、家庭用専用。\n"
        "各ゲームに、根拠になった実在のポストの URL を 2〜3 件（いいね数が見えれば添える）。推測で URL を作らないこと。"
    )
    chat = client.chat.create(model=MODEL, messages=[system("あなたは日本のゲーム界隈を X で観測する係。事実と出典だけを返す。"), user(prompt)],
                              tools=[x_search(from_date=now - timedelta(days=7), enable_image_understanding=False)],
                              tool_choice="auto", reasoning_effort="low", store_messages=False)
    resp, parsed = await asyncio.wait_for(chat.parse(Scout), timeout=600)
    usd = float(getattr(resp, "cost_usd", 0) or 0)
    await asyncio.to_thread(log_cost, "xai", MODEL, "x_buzz", usd)
    print(f"[scene] x buzz: {len(parsed.items)} games ${usd:.3f} ({MODEL})")
    return parsed.items


def save(items: List[dict]) -> None:
    at = datetime.now(timezone.utc).isoformat()
    with db._connect() as c:
        c.executemany("INSERT INTO scene_xbuzz (at, game, game_ja, players, kind, why, evidence, appid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                      [(at, i["game"], i.get("game_ja"), i.get("players"), i["kind"], i["why"],
                        json.dumps(i.get("evidence") or [], ensure_ascii=False), i.get("appid")) for i in items])
        c.execute("DELETE FROM scene_xbuzz WHERE at < ?", ((datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),))
