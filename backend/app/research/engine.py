"""調べもの 1 回分: Claude（既定 Opus 5.5）に web_search / web_fetch を持たせて調べさせ、Markdown のレポートにする。

2026-10-11 の比較（同じ「直近 72 時間の Apex / VALORANT / スト6」）:
- Opus 5.5: 87 秒・$0.86・今夜の Champions 上海を見つけ、各点に出典リンク
- Fable 5.1: 91 秒・$1.90・VALORANT を取りこぼし、本文にリンクが無い
→ Opus 5.5（IRINA_RESEARCH_MODEL で変更）。動的フィルタつきの 20260209 版のツールは citations を返さないので、
  本文の Markdown リンクのうち「検索・取得結果に実在した URL」だけを残す（作った URL を出さない）。
"""
import json
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from ..services import game_sources as gsrc, llm_budget

import os

MODEL = os.getenv("IRINA_RESEARCH_MODEL") or "claude-opus-5-5"
_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def _seen_urls(content: Iterable[Any]) -> Set[str]:
    """検索・取得の結果に出てきた URL（ここに無いリンクは本文から外す）"""
    out: Set[str] = set()

    def walk(x: Any) -> None:
        if x is None:
            return
        if isinstance(x, dict):
            for k, v in x.items():
                if k == "url" and isinstance(v, str):
                    out.add(v.rstrip("/"))
                else:
                    walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)
        elif hasattr(x, "model_dump"):
            walk(x.model_dump())
        elif isinstance(x, str):
            for u in re.findall(r"https?://[^\s\"'<>)\]]+", x):
                out.add(u.rstrip("/.,"))
    for b in content:
        if getattr(b, "type", "") in ("web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result",
                                      "bash_code_execution_tool_result", "text_editor_code_execution_tool_result"):
            walk(b)
    return out


def clean_links(md: str, allowed: Set[str]) -> Tuple[str, List[Dict[str, str]]]:
    """実在した URL のリンクだけ残し、残りは文字だけにする。出典の一覧も返す"""
    sources: List[Dict[str, str]] = []
    seen: Set[str] = set()

    def ok(u: str) -> bool:
        u2 = u.rstrip("/")
        return u2 in allowed or any(a.startswith(u2) or u2.startswith(a) for a in allowed if len(a) > 20)

    def sub(m: "re.Match[str]") -> str:
        text, url = m.group(1), m.group(2)
        if not ok(url):
            return text
        if url not in seen:
            seen.add(url)
            sources.append({"title": text[:80], "url": url})
        return m.group(0)
    return _LINK.sub(sub, md), sources


_TOOL_BLOCKS = ("server_tool_use", "tool_use", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result",
                "bash_code_execution_tool_result", "text_editor_code_execution_tool_result")
MAX_ROUNDS = 4


def final_text(content: Iterable[Any]) -> str:
    """最後のツール呼び出しより後の本文だけ（途中の「結果を整形して…」のような独り言を出さない。2026-10-11 に Sonnet で混入）"""
    blocks = list(content)
    last = max((i for i, b in enumerate(blocks) if getattr(b, "type", "") in _TOOL_BLOCKS), default=-1)
    tail = "".join(b.text for b in blocks[last + 1:] if getattr(b, "type", "") == "text").strip()
    return tail or "".join(b.text for b in blocks if getattr(b, "type", "") == "text").strip()


async def research(system: str, prompt: str, *, max_search: int = 5, max_fetch: int = 2, extra_urls: Iterable[str] = (),
                   effort: str = "medium", purpose: str = "research", model: Optional[str] = None,
                   steam: bool = False, guild_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """戻り値 {markdown, sources, cost, sec, model, searches, fetches}。上限超えや失敗は None（理由は print）

    steam=True なら自前の steam_lookup ツールも持たせる（Claude が呼んだら実行して返す。最大 MAX_ROUNDS 往復）。
    往復するときに前の検索結果を読み直すので、会話の末尾を自動キャッシュする（Opus 5.5 の読み出しは 0.05 倍）。
    """
    if not gsrc.claude_enabled() or not llm_budget.allowed("anthropic"):
        return None
    from . import tools as rtools
    model = model or MODEL
    t = time.time()
    tools: List[Dict[str, Any]] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": max_search}]
    if max_fetch:
        tools.append({"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": max_fetch})
    if steam:
        tools.append(rtools.STEAM_TOOL)
    messages: List[Dict[str, Any]] = [{"role": "user", "content": prompt}]
    usd = 0.0
    searches = fetches = steam_calls = 0
    seen: Set[str] = {u.rstrip("/") for u in extra_urls}
    tok = {"in": 0, "cache_w": 0, "cache_r": 0, "out": 0}
    container: Optional[str] = None
    r = None
    for _ in range(MAX_ROUNDS):
        kw: Dict[str, Any] = {"container": container} if container else {}
        r = await gsrc._client().messages.create(model=model, max_tokens=16000, system=system, output_config={"effort": effort},
                                                 tools=tools, messages=messages, cache_control={"type": "ephemeral"}, **kw)
        c = llm_budget.cost(model, r.usage)
        usd += c
        llm_budget.log("anthropic", model, purpose, c)
        u = r.usage
        tok["in"] += u.input_tokens or 0
        tok["cache_w"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        tok["cache_r"] += getattr(u, "cache_read_input_tokens", 0) or 0
        tok["out"] += u.output_tokens or 0
        stu = getattr(u, "server_tool_use", None)
        searches += (getattr(stu, "web_search_requests", 0) or 0) if stu else 0
        fetches += (getattr(stu, "web_fetch_requests", 0) or 0) if stu else 0
        seen |= _seen_urls(r.content)
        container = getattr(getattr(r, "container", None), "id", None) or container
        if r.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": r.content})
            continue
        if r.stop_reason != "tool_use":
            break
        results = []
        for b in r.content:
            if getattr(b, "type", "") != "tool_use":
                continue
            steam_calls += 1
            try:
                out = await rtools.run(b.name, dict(b.input or {}), guild_id)
            except Exception as e:
                out = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
            for it in out.get("results") or []:
                if it.get("url"):
                    seen.add(it["url"].rstrip("/"))
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(out, ensure_ascii=False)})
        messages += [{"role": "assistant", "content": r.content}, {"role": "user", "content": results}]
    if r is None:
        return None
    if r.stop_reason == "refusal":
        print(f"[research] refused ({purpose})")
        return None
    md, sources = clean_links(final_text(r.content), seen)
    out = {"markdown": md, "sources": sources, "cost": round(usd, 4), "sec": round(time.time() - t, 1), "model": model,
           "searches": searches, "fetches": fetches}
    print(f"[research] {purpose} {model}: {out['sec']}s ${out['cost']} search={searches} fetch={fetches} steam={steam_calls} "
          f"links={len(sources)} stop={r.stop_reason} in={tok['in']} cache_w={tok['cache_w']} cache_r={tok['cache_r']} out={tok['out']}")
    return out
