"""「話題の新作・インディー」を Claude（最新・最上位の Opus 5.5）が 1 日 1 回、ドデカ向けに並べ直して一言を付ける。

材料はすべての信号（メディアの記事・Steam の売れ筋・日本語の実況の再生数・配信者・X の話題）と、
ドデカのゲーム探しのジャーニーから分かったこと（いちばんの壁は人数、続いたのは 4〜8 人ですぐ始められるパーティ・協力、
定番への引力が強い）。分類は Sonnet 5.5、選んで言葉にするところだけ Opus 5.5（IRINA_SCENE_CURATOR_MODEL で変更）。
"""
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..services import game_db as gdb, game_sources as gsrc
from . import xbuzz

MODEL = os.getenv("IRINA_SCENE_CURATOR_MODEL") or "claude-opus-5-5"
PRICE = {"claude-opus-5-5": (5.0, 25.0), "claude-sonnet-5-5": (2.0, 10.0)}

SYSTEM = """あなたは Discord サーバー「ドデカ」（固定 8 人の友人。夜 19〜23 時に VC で集まって遊ぶ）のゲーム係。
このメンバーについて分かっていること（会話履歴の集計）:
- いちばんの壁は人数（「あと N 人」）。続いた新作は、4〜8 人で一度に遊べて、短時間で始められるパーティ・協力・対戦（例: めっちゃカメレオン、Super Battle Golf、Green Hell）
- 定番（VALORANT・スト6・Apex）への引力が強い。新作は「たまにはこれ」で入れ替わる
- 好み: 協力ホラー、物理系わちゃわちゃ、脱出、無料・体験版・安いもの。SNS や配信者のあいだで話題のもの
候補から、今週のドデカに勧める順に最大 8 本を選び、それぞれに 24 文字以内の一言（なぜ今これか。事実に基づく、宣伝文句にしない）を付けて。"""


class Pick(BaseModel):
    appid: str
    why: str = Field(description="24 文字以内。例: 6人協力で X でも話題・体験版あり")


class Curation(BaseModel):
    picks: List[Pick]


def _brief(c: Dict[str, Any], g: Dict[str, Any]) -> str:
    prof = gdb.loads(g.get("profile"), {})
    j = c.get("jikkyou") or {}
    parts = [
        f"appid={c['appid']}", f"名前={g.get('name')}", f"人数={prof.get('min_players')}〜{prof.get('max_players_online')}人",
        f"最適={prof.get('best_with')}", f"モード={','.join(prof.get('modes') or [])}", f"パーティ適性={prof.get('party_fit')}",
        f"価格={'無料' if g.get('is_free') else (g.get('price_final') or 0) // 100}円", f"割引={g.get('discount_percent') or 0}%",
        f"発売={g.get('release_text')}", f"評価={g.get('review_desc')}({g.get('review_pct')}%)",
        f"実況2週={j.get('views') or 0}回", f"配信者={','.join(c.get('streamers') or []) or 'なし'}",
        f"Steam売上順位={c.get('chart', {}).get('topsellers') or '-'}", f"メディア={','.join(c.get('outlets') or []) or 'なし'}",
        f"きっかけ={','.join(c.get('hooks') or []) or '-'}", f"X={c['x']['why'] if c.get('x') else 'なし'}",
        f"一言={prof.get('hook_ja') or ''}",
    ]
    return " / ".join(parts)


async def curate(cands: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not gsrc.claude_enabled() or not cands:
        return None
    games = {g["appid"]: g for g in gdb.all_games([c["appid"] for c in cands])}
    lines = [_brief(c, games[c["appid"]]) for c in cands if c["appid"] in games]
    r = await gsrc._client().messages.parse(
        model=MODEL, max_tokens=4000, system=SYSTEM, output_config={"effort": "medium"},
        messages=[{"role": "user", "content": "候補:\n" + "\n".join(lines)}], output_format=Curation)
    pin, pout = PRICE.get(MODEL, (5.0, 25.0))
    usd = r.usage.input_tokens / 1e6 * pin + r.usage.output_tokens / 1e6 * pout
    xbuzz.log_cost("anthropic", MODEL, "curation", usd)
    valid = {c["appid"] for c in cands}
    picks = [p.model_dump() for p in (r.parsed_output.picks if r.parsed_output else []) if p.appid in valid][:8]
    out = {"at": datetime.now(timezone.utc).isoformat(), "model": MODEL, "picks": picks}
    gdb.kv_set("scene_curation", json.dumps(out, ensure_ascii=False))
    print(f"[scene] curation: {len(picks)} picks ${usd:.3f} ({MODEL})")
    return out


def current(max_age_h: float = 36) -> Optional[Dict[str, Any]]:
    raw = gdb.kv_get("scene_curation")
    if not raw:
        return None
    try:
        d = json.loads(raw)
        if datetime.now(timezone.utc) - datetime.fromisoformat(d["at"]) > timedelta(hours=max_age_h):
            return None
        return d
    except (ValueError, KeyError):
        return None
