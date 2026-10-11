"""調べもののときに Claude が使う自前のツール。

steam_lookup: Steam ストアの公式データ（日本円の価格・セール・発売日・マルチ/協力・日本語対応・評価）と、
ドデカのゲーム置き場にあるか。web 検索で拾った記事の値段は古いことが多い（2026-10-11 の試験で「$9.99」「価格は確認できず」が出た）ので、
ゲームの値段・人数はこれで確かめさせる。キー不要の store API（game_sources の _steam が 1.6 秒間隔で 1 本ずつ叩く）。
"""
import asyncio
import json
from typing import Any, Dict, List, Optional

from ..services import game_db as gdb, game_sources as gsrc

STEAM_TOOL = {
    "name": "steam_lookup",
    "description": (
        "Steam ストアでゲームを調べる。日本円の今の価格とセール、発売日（発売前か）、シングル/マルチ/協力/PvP、日本語対応、"
        "Steam の評価、ドデカの #ゲーム置き場 に貼られたことがあるか、が分かる。ゲームの値段・人数・日本語対応を書くときは、"
        "記事の値段ではなく必ずこれで確かめる。名前は英語のストア名が当たりやすい。一度に 6 本まで。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "games": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 6,
                "description": "ゲーム名（英語のストア名がおすすめ）か Steam の appid",
            }
        },
        "required": ["games"],
    },
}

_KEEP_CATEGORIES = ("シングル", "マルチ", "協力", "PvP", "クロスプラットフォーム", "Remote Play", "リモートプレイ")


def _yen(v: Optional[int]) -> Optional[str]:
    return f"¥{v // 100:,}" if isinstance(v, int) else None


async def _resolve(name: str) -> Optional[Dict[str, str]]:
    """名前 → appid（記号・空白を無視して完全一致を優先。無ければ英語検索の 1 件目）"""
    name = name.strip()
    if name.isdigit():
        return {"appid": name, "matched": "appid"}
    exact = await gsrc.steam_find_exact(name)
    if exact:
        return {"appid": exact, "matched": "exact"}
    hits = await gsrc.steam_search(name, "english") or await gsrc.steam_search(name, "japanese")
    if hits:
        return {"appid": hits[0]["appid"], "matched": f"近い名前: {hits[0]['name']}"}
    return None


async def _one(name: str, shelf: set) -> Dict[str, Any]:
    hit = await _resolve(name)
    if not hit:
        return {"query": name, "found": False}
    appid = hit["appid"]
    d = await gsrc.steam_details(appid)
    if not d:
        return {"query": name, "found": False, "appid": appid}
    po = d.get("price_overview") or {}
    rel = d.get("release_date") or {}
    cats = [c.get("description") for c in d.get("categories") or [] if c.get("description")]
    rev = await gsrc.steam_reviews(appid)
    prof = {}
    row = await asyncio.to_thread(gdb.get_game, appid)
    if row and row.get("profile"):
        try:
            p = json.loads(row["profile"])
            prof = {k: p.get(k) for k in ("min_players", "max_players_online", "best_with", "modes") if p.get(k)}
        except ValueError:
            pass
    price: Optional[str]
    if d.get("is_free"):
        price = "無料"
    elif po:
        price = _yen(po.get("final"))
        if po.get("discount_percent"):
            price = f"{price}（{po['discount_percent']}% オフ、通常 {_yen(po.get('initial'))}）"
    else:
        price = "価格なし（発売前か、日本で販売していない）"
    out = {
        "query": name,
        "found": True,
        "match": hit["matched"],
        "appid": appid,
        "name": d.get("name"),
        "url": f"https://store.steampowered.com/app/{appid}/?l=japanese",
        "price_jp": price,
        "release": rel.get("date") or None,
        "coming_soon": bool(rel.get("coming_soon")),
        "modes": [c for c in cats if any(k in c for k in _KEEP_CATEGORIES)][:8],
        "japanese": "日本語" in (d.get("supported_languages") or ""),
        "reviews": (f"{rev['desc']}（{rev['total']:,} 件中 {rev['pct']}% が好評）" if rev and rev.get("total") else None),
        "genres": [g.get("description") for g in d.get("genres") or []][:4],
        "short": gsrc._strip(d.get("short_description"), 160),
        "on_dodeka_shelf": appid in shelf,
    }
    if prof:
        out["players_dodeka_profile"] = prof
    return out


async def steam_lookup(games: List[str], guild_id: Optional[str]) -> Dict[str, Any]:
    names = [str(g)[:100] for g in (games or []) if str(g).strip()][:6]
    shelf: set = set()
    if guild_id:
        try:
            shelf = {p["appid"] for p in await asyncio.to_thread(gdb.posts_for_guild, guild_id) if p.get("appid")}
        except Exception:
            pass
    results = []
    for n in names:
        try:
            results.append(await _one(n, shelf))
        except Exception as e:
            results.append({"query": n, "found": False, "error": type(e).__name__})
    return {"results": results}


async def run(name: str, args: Dict[str, Any], guild_id: Optional[str]) -> Dict[str, Any]:
    if name == "steam_lookup":
        return await steam_lookup(args.get("games") or [], guild_id)
    return {"error": f"unknown tool {name}"}
