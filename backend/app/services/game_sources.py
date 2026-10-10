"""ゲーム置き場の外部ソース（Steam・Epic・X の記事・Claude）。どれも鍵なしで使える公開 API。

- Steam ストア API（appdetails / storesearch / appreviews）と Steam Web API の同時接続数は鍵不要。
  appdetails は 5 分 200 回程度で 429 になるので 1.6 秒間隔に揃える（ロックで直列化）
- X の投稿本文は fxtwitter（非公式）。一度取れた本文は DB に控えて二度と取りに行かない
- Epic の無料配布は freeGamesPromotions（非公式・ストアのページが使っているもの）
- Claude（Sonnet 5.5）で「何人で・どう遊ぶか」を作る。鍵は CLAUDE_API_KEY。無ければ何もしない
"""
import asyncio
import html
import json
import os
import re
import time
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import quote, urlencode

import aiohttp
from pydantic import BaseModel, Field

UA = "Mozilla/5.0 (compatible; irina-game-shelf/1.0; +https://discord-music-app.vercel.app)"
STEAM_INTERVAL_SEC = 1.6
CLAUDE_MODEL = os.getenv("IRINA_GAME_MODEL") or "claude-sonnet-5-5"

_steam_lock: Optional[asyncio.Lock] = None
_steam_last = 0.0


async def _get_json(url: str, timeout: float = 20) -> Optional[Any]:
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout), headers={"User-Agent": UA}) as s:
            async with s.get(url) as r:
                if r.status != 200:
                    return None
                return await r.json(content_type=None)
    except Exception:
        return None


async def _steam(url: str) -> Optional[Any]:
    """store.steampowered.com への呼び出しは間隔を空けて 1 本ずつ"""
    global _steam_lock, _steam_last
    if _steam_lock is None:
        _steam_lock = asyncio.Lock()
    async with _steam_lock:
        wait = STEAM_INTERVAL_SEC - (time.monotonic() - _steam_last)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            return await _get_json(url)
        finally:
            _steam_last = time.monotonic()


# ---------------------------------------------------------------------------
# URL の見分け
# ---------------------------------------------------------------------------

STEAM_APP_RE = re.compile(r"https?://(?:store\.steampowered\.com/app|s\.team/a)/(\d+)", re.I)
X_STATUS_RE = re.compile(r"https?://(?:www\.)?(?:x|twitter|fxtwitter|vxtwitter)\.com/(\w+)/status/(\d+)", re.I)
EPIC_RE = re.compile(r"https?://store\.epicgames\.com/\S+", re.I)
URL_RE = re.compile(r"https?://[^\s<>()]+", re.I)


def classify_links(text: str) -> List[Dict[str, str]]:
    """本文からリンクを取り出し、種類（steam / x / epic / link）を付ける"""
    out: List[Dict[str, str]] = []
    seen = set()
    for url in URL_RE.findall(text or ""):
        url = url.rstrip(".,、。）)」』")
        if url in seen:
            continue
        seen.add(url)
        m = STEAM_APP_RE.match(url)
        if m:
            out.append({"kind": "steam", "url": url, "ref": m.group(1)})
            continue
        m = X_STATUS_RE.match(url)
        if m:
            out.append({"kind": "x", "url": url, "ref": f"{m.group(1)}/{m.group(2)}"})
            continue
        if EPIC_RE.match(url):
            out.append({"kind": "epic", "url": url, "ref": ""})
            continue
        out.append({"kind": "link", "url": url, "ref": ""})
    return out


# ---------------------------------------------------------------------------
# Steam
# ---------------------------------------------------------------------------

def _strip(s: Optional[str], n: int) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return html.unescape(re.sub(r"\s+", " ", s)).strip()[:n]


async def steam_details(appid: str) -> Optional[Dict[str, Any]]:
    d = await _steam(f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=jp&l=japanese")
    info = (d or {}).get(str(appid)) or {}
    return info.get("data") if info.get("success") else None


async def steam_prices(appids: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
    """まとめて価格だけ（filters=price_overview は複数 appid を一度に取れる）。無料・販売前は None"""
    out: Dict[str, Optional[Dict[str, Any]]] = {}
    for i in range(0, len(appids), 40):
        chunk = appids[i:i + 40]
        d = await _steam(f"https://store.steampowered.com/api/appdetails?appids={','.join(chunk)}&cc=jp&filters=price_overview")
        for a in chunk:
            info = (d or {}).get(a) or {}
            data = info.get("data")
            out[a] = data.get("price_overview") if isinstance(data, dict) else None
    return out


async def steam_reviews(appid: str) -> Optional[Dict[str, Any]]:
    d = await _steam(f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all&num_per_page=0&l=japanese")
    q = (d or {}).get("query_summary") or {}
    if not q:
        return None
    total = int(q.get("total_reviews") or 0)
    pos = int(q.get("total_positive") or 0)
    return {"desc": q.get("review_score_desc"), "total": total, "pct": round(pos * 100 / total) if total else None}


async def steam_current_players(appid: str) -> Optional[int]:
    d = await _get_json(f"https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={appid}")
    r = (d or {}).get("response") or {}
    return int(r["player_count"]) if r.get("result") == 1 and "player_count" in r else None


def _norm(s: str) -> str:
    return re.sub(r"[\s:：\-–—!！?？・'’\"®™©]", "", s or "").lower()


async def steam_search(term: str, lang: str = "japanese") -> List[Dict[str, Any]]:
    d = await _steam("https://store.steampowered.com/api/storesearch/?" + urlencode({"term": term, "l": lang, "cc": "JP"}))
    return [{"appid": str(i["id"]), "name": i.get("name") or ""} for i in ((d or {}).get("items") or []) if i.get("type") == "app"]


async def steam_find_exact(name: str) -> Optional[str]:
    """名前が（記号・空白を無視して）一致する Steam のゲーム。日本語だと名前が訳されることがあるので英語でも探す"""
    for lang in ("english", "japanese"):
        for item in await steam_search(name, lang):
            if _norm(item["name"]) == _norm(name):
                return item["appid"]
    return None


def summarize_details(d: Dict[str, Any]) -> Dict[str, Any]:
    po = d.get("price_overview") or {}
    rel = d.get("release_date") or {}
    return {
        "name": d.get("name"),
        "type": d.get("type"),
        "header_image": d.get("header_image"),
        "short_desc": _strip(d.get("short_description"), 300),
        "is_free": 1 if d.get("is_free") else 0,
        "price_initial": po.get("initial"),
        "price_final": po.get("final"),
        "discount_percent": int(po.get("discount_percent") or 0),
        "currency": po.get("currency"),
        "release_text": rel.get("date") or "",
        "coming_soon": 1 if rel.get("coming_soon") else 0,
        "categories": json.dumps([c.get("description") for c in d.get("categories") or []], ensure_ascii=False),
        "genres": json.dumps([g.get("description") for g in d.get("genres") or []], ensure_ascii=False),
        "fullgame_appid": str((d.get("fullgame") or {}).get("appid") or "") or None,
    }


# ---------------------------------------------------------------------------
# Steam アカウント（本人が連携したときだけ。鍵は STEAM_API_KEY）
# ---------------------------------------------------------------------------

def steam_key() -> str:
    return os.getenv("STEAM_API_KEY") or ""


async def steam_resolve_profile(text: str) -> Optional[str]:
    """Steam64 ID / プロフィール URL（/profiles/… or /id/…）/ カスタム URL 名 → Steam64 ID"""
    t = (text or "").strip()
    m = re.search(r"(7656\d{13})", t)
    if m:
        return m.group(1)
    m = re.search(r"steamcommunity\.com/id/([^/?#\s]+)", t)
    vanity = m.group(1) if m else (t if re.fullmatch(r"[A-Za-z0-9_-]{2,32}", t) else None)
    if not vanity or not steam_key():
        return None
    d = await _get_json(f"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key={steam_key()}&vanityurl={quote(vanity)}")
    r = (d or {}).get("response") or {}
    return r.get("steamid") if r.get("success") == 1 else None


async def steam_player(steamid: str) -> Optional[Dict[str, Any]]:
    d = await _get_json(f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={steam_key()}&steamids={steamid}")
    ps = ((d or {}).get("response") or {}).get("players") or []
    if not ps:
        return None
    p = ps[0]
    return {"name": p.get("personaname"), "avatar": p.get("avatarmedium") or p.get("avatar"),
            "public": p.get("communityvisibilitystate") == 3}


async def steam_owned_games(steamid: str) -> Optional[List[Dict[str, Any]]]:
    """所持ゲーム（ゲームの詳細が非公開なら None）"""
    d = await _get_json(f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={steam_key()}&steamid={steamid}"
                        "&include_played_free_games=1&format=json")
    r = (d or {}).get("response")
    if not r or "games" not in r:
        return None
    return [{"appid": str(g["appid"]), "playtime_min": int(g.get("playtime_forever") or 0),
             "playtime_2w": int(g.get("playtime_2weeks") or 0)} for g in r.get("games") or []]


async def steam_wishlist(steamid: str) -> Optional[List[str]]:
    d = await _get_json(f"https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key={steam_key()}&steamid={steamid}")
    r = (d or {}).get("response")
    if r is None:
        return None
    return [str(i["appid"]) for i in r.get("items") or [] if i.get("appid")]


# ---------------------------------------------------------------------------
# X の記事（fxtwitter）
# ---------------------------------------------------------------------------

async def x_post_text(ref: str) -> Optional[str]:
    """ref = "user/status_id"。本文（なければ None）"""
    d = await _get_json(f"https://api.fxtwitter.com/{ref}", timeout=15)
    t = (d or {}).get("tweet") or {}
    return t.get("text") or None


def titles_in(text: str) -> List[str]:
    return re.findall(r"『([^』]{1,60})』", text or "") or re.findall(r"「([^」]{1,60})」", text or "")


# ---------------------------------------------------------------------------
# Epic の無料配布
# ---------------------------------------------------------------------------

async def epic_free_offers() -> List[Dict[str, Any]]:
    d = await _get_json("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=ja&country=JP&allowCountries=JP")
    els = ((((d or {}).get("data") or {}).get("Catalog") or {}).get("searchStore") or {}).get("elements") or []
    out = []
    for e in els:
        promos = e.get("promotions") or {}
        now = [o for g in promos.get("promotionalOffers") or [] for o in g.get("promotionalOffers") or []]
        up = [o for g in promos.get("upcomingPromotionalOffers") or [] for o in g.get("promotionalOffers") or []]
        offer, active = (now[0], True) if now else ((up[0], False) if up else (None, False))
        if not offer or int((offer.get("discountSetting") or {}).get("discountPercentage", 100)) != 0:
            continue  # 0% = 無料（Epic の表現）
        slug = e.get("productSlug") or next((m.get("pageSlug") for m in (e.get("catalogNs") or {}).get("mappings") or [] if m.get("pageSlug")), None)
        img = next((k.get("url") for k in e.get("keyImages") or [] if k.get("type") in ("OfferImageWide", "DieselStoreFrontWide")), None) \
            or next((k.get("url") for k in e.get("keyImages") or []), None)
        out.append({
            "id": f"epic:{e.get('id')}:{offer.get('startDate')}",
            "source": "epic",
            "title": e.get("title") or "",
            "url": f"https://store.epicgames.com/ja/p/{quote(slug)}" if slug else "https://store.epicgames.com/ja/free-games",
            "image": img,
            "starts_at": offer.get("startDate"),
            "ends_at": offer.get("endDate"),
            "active": active,
        })
    return out


async def gamerpower_steam_offers() -> List[Dict[str, Any]]:
    """GamerPower（鍵なし）から、Steam の期限つき無料配布だけ（Epic は epic_free_offers 側で取る）"""
    d = await _get_json("https://www.gamerpower.com/api/giveaways?platform=pc&type=game")
    out = []
    for g in d if isinstance(d, list) else []:
        plats = g.get("platforms") or ""
        end = g.get("end_date") or ""
        if "Steam" not in plats or not re.match(r"\d{4}-\d{2}-\d{2}", end) or g.get("status") != "Active":
            continue
        title = re.sub(r"\s*\((?:Steam)\)\s*|\s*(?:Key\s+)?Giveaway\s*$", " ", g.get("title") or "").strip()
        out.append({
            "id": f"gamerpower:{g.get('id')}",
            "source": "steam",
            "title": title,
            "url": g.get("open_giveaway_url") or g.get("gamerpower_url"),
            "image": g.get("image") or g.get("thumbnail"),
            "starts_at": None,
            # GamerPower の終了時刻は UTC 表記
            "ends_at": end.replace(" ", "T") + "+00:00",
            "active": True,
        })
    return out


# ---------------------------------------------------------------------------
# Claude: 何人で・どう遊ぶか
# ---------------------------------------------------------------------------

class GameProfile(BaseModel):
    max_players_online: Optional[int] = Field(description="オンラインで一緒に遊べる最大人数。資料に無く確信も無ければ null")
    min_players: Optional[int] = Field(description="遊ぶのに必要な最少人数。ソロ可なら 1")
    modes: List[Literal["online_coop", "online_pvp", "local_coop", "local_pvp", "single", "mmo"]]
    party_fit: int = Field(description="Discord の VC で 2〜8 人の友だちが今夜いっしょに遊ぶのに向いているか 1〜5")
    best_with: str = Field(description="いちばん楽しい人数の目安。例: 2〜4人 / 4人 / 6〜8人 / ソロ向け")
    hook_ja: str = Field(description="何をするゲームか 1 文、40 文字以内。宣伝文句・感嘆符・絵文字なし")
    vibe: List[Literal["ワイワイ", "バカゲー", "ホラー", "サバイバル", "FPS", "対戦", "協力", "まったり", "頭脳", "レース",
                       "スポーツ", "クラフト", "ローグライク", "MMO", "アクション", "シミュレーション"]]
    confidence: Literal["high", "medium", "low"] = Field(description="人数の情報の確かさ")


class PlayerCount(BaseModel):
    max_players_online: Optional[int] = Field(description="オンラインで一緒に遊べる最大人数。見つからなければ null")
    source: str = Field(description="根拠にしたページの URL。無ければ空文字")


class TitlePick(BaseModel):
    game_title: Optional[str] = Field(description="記事が主に扱っているゲームの正式名（英語名があれば英語名）。ゲームの記事でなければ null")


PROFILE_SYSTEM = """あなたはゲームの資料係。8 人の固定メンバーが毎晩 Discord の VC で PC ゲームを遊ぶサーバーのために、Steam の情報とゲームニュースから、そのゲームを「何人で・どう遊ぶか」に要約する。
- 人数は資料に書かれた数字を優先する（「最大4人」「1〜8人」など）。資料に無いときは、よく知られた事実として確信があるときだけ書き、無ければ null。推測で埋めない
- hook_ja は中身の説明だけ。「おすすめ」「神ゲー」などの評価や誇張は書かない
- party_fit は、オンラインで一緒に遊べる人数・手軽さ（価格・難しさ）・盛り上がりやすさから判断する。ソロ専用は 1"""

_claude = None
CLAUDE_PRICE = {"in": 2.0, "out": 10.0, "search": 0.01}  # Sonnet 5.5 の $/MTok と検索 1 回


def claude_enabled() -> bool:
    return bool(os.getenv("CLAUDE_API_KEY"))


def _client():
    global _claude
    if _claude is None:
        import anthropic
        _claude = anthropic.AsyncAnthropic(api_key=os.getenv("CLAUDE_API_KEY"))
    return _claude


def _cost(usage) -> float:
    searches = getattr(getattr(usage, "server_tool_use", None), "web_search_requests", 0) or 0
    return usage.input_tokens / 1e6 * CLAUDE_PRICE["in"] + usage.output_tokens / 1e6 * CLAUDE_PRICE["out"] + searches * CLAUDE_PRICE["search"]


async def claude_profile(details: Dict[str, Any], news: List[str]) -> Optional[Dict[str, Any]]:
    if not claude_enabled():
        return None
    cats = ", ".join(c.get("description", "") for c in details.get("categories") or [])
    genres = ", ".join(g.get("description", "") for g in details.get("genres") or [])
    po = details.get("price_overview") or {}
    price = "無料" if details.get("is_free") else (po.get("final_formatted") or "不明")
    parts = [f"名前: {details.get('name')}", f"種類: {details.get('type')}", f"ジャンル: {genres}", f"カテゴリ: {cats}",
             f"価格: {price}", f"発売日: {(details.get('release_date') or {}).get('date', '')}",
             f"短い説明: {_strip(details.get('short_description'), 400)}",
             f"詳しい説明（抜粋）: {_strip(details.get('detailed_description'), 1500)}"]
    parts += [f"ニュース投稿: {_strip(t, 300)}" for t in news[:3]]
    r = await _client().messages.parse(model=CLAUDE_MODEL, max_tokens=4000, system=PROFILE_SYSTEM,
                                       output_config={"effort": "low"},
                                       messages=[{"role": "user", "content": "\n".join(parts)}],
                                       output_format=GameProfile)
    if not r.parsed_output:
        return None
    prof = r.parsed_output.model_dump()
    usd = _cost(r.usage)
    # 人数が分からないマルチプレイのゲームだけ、Web 検索で公式の人数を確かめる（1 本 約 $0.06）
    if not prof.get("max_players_online") and set(prof.get("modes") or []) & {"online_coop", "online_pvp"}:
        try:
            r2 = await _client().messages.parse(
                model=CLAUDE_MODEL, max_tokens=4000, output_config={"effort": "low"},
                tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 2}],
                messages=[{"role": "user", "content": f"Steam のゲーム『{details.get('name')}』は、オンラインで最大何人まで一緒に遊べますか。公式（Steam ストアページ・公式サイト・開発者の発表）を優先して調べ、数字が確認できなければ null。"}],
                output_format=PlayerCount)
            usd += _cost(r2.usage)
            if r2.parsed_output and r2.parsed_output.max_players_online:
                prof["max_players_online"] = r2.parsed_output.max_players_online
                prof["players_source"] = r2.parsed_output.source
        except Exception as e:
            print(f"[game] player-count search failed: {type(e).__name__}: {str(e)[:100]}")
    prof["model"] = CLAUDE_MODEL
    prof["usd"] = round(usd, 4)
    return prof


async def claude_title_from_news(text: str) -> Optional[str]:
    if not claude_enabled():
        return None
    r = await _client().messages.parse(model=CLAUDE_MODEL, max_tokens=1000, output_config={"effort": "low"},
                                       messages=[{"role": "user", "content": f"次のゲームニュースの投稿が主に扱っているゲームの名前は？\n\n{_strip(text, 600)}"}],
                                       output_format=TitlePick)
    return r.parsed_output.game_title if r.parsed_output else None
