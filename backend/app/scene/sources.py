"""界隈フィードの取得元（キー不要の RSS / Steam ストア、YouTube Data API）。

- メディア: #ゲーム置き場 に貼られる X リンクの発信元（電ファミ・Game*Spark・AUTOMATON・4Gamer・ジュウシマツ）の RSS
- Steam: 日本の「オンライン協力」タグの売上上位・人気の新作・人気の近日発売
- YouTube: メンバーが会話で名前を出す配信者・VTuber（channels.json）の新着動画と、日本語の実況の再生数
"""
import asyncio
import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import aiohttp

UA = "Mozilla/5.0 (compatible; IrinaBot/1.0; +https://discord-music-app.vercel.app)"
FEEDS = {
    "電ファミ": "https://news.denfaminicogamer.jp/feed",
    "Game*Spark": "https://www.gamespark.jp/rss/index.rdf",
    "AUTOMATON": "https://automaton-media.com/feed/",
    "4Gamer": "https://www.4gamer.net/rss/index.xml",
    "ジュウシマツ": "https://jushimatsu.com/feed",
}
STEAM_LISTS = {  # tags=3843 はオンライン協力
    "topsellers": "https://store.steampowered.com/search/results/?filter=topsellers&tags=3843&cc=jp&l=japanese&json=1&count=40",
    "popularnew": "https://store.steampowered.com/search/results/?filter=popularnew&tags=3843&cc=jp&l=japanese&json=1&count=40",
    "comingsoon": "https://store.steampowered.com/search/results/?filter=popularcomingsoon&tags=3843&cc=jp&l=japanese&json=1&count=30",
}
CHANNELS_FILE = os.path.join(os.path.dirname(__file__), "channels.json")
YT = "https://www.googleapis.com/youtube/v3/"


def _strip(s: Optional[str], n: int) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", (s or "").replace("<![CDATA[", "").replace("]]>", "")))
    return re.sub(r"\s+", " ", s).strip()[:n]


def _iso(s: str) -> Optional[str]:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


async def _get(session: aiohttp.ClientSession, url: str) -> Optional[str]:
    try:
        async with session.get(url) as r:
            return await r.text() if r.status == 200 else None
    except Exception:
        return None


def _session() -> aiohttp.ClientSession:
    return aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25), headers={"User-Agent": UA})


# ---------------------------------------------------------------- メディア

async def fetch_articles() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    async with _session() as s:
        texts = await asyncio.gather(*(_get(s, u) for u in FEEDS.values()))
    for src, t in zip(FEEDS, texts):
        if not t:
            print(f"[scene] rss failed: {src}")
            continue
        for blk in re.findall(r"<(?:item|entry)[\s>].*?</(?:item|entry)>", t, re.S):
            title = re.search(r"<title[^>]*>(.*?)</title>", blk, re.S)
            link = re.search(r"<link>(.*?)</link>|<link[^>]*href=\"([^\"]+)\"", blk, re.S)
            body = re.search(r"<content:encoded>(.*?)</content:encoded>", blk, re.S) or \
                re.search(r"<(?:description|summary)[^>]*>(.*?)</(?:description|summary)>", blk, re.S)
            date = re.search(r"<(?:pubDate|dc:date|updated|published)>(.*?)</", blk)
            url = _strip((link.group(1) or link.group(2)) if link else "", 400)
            if not url or not title:
                continue
            raw = body.group(1) if body else ""
            hint = re.search(r"store\.steampowered\.com/app/(\d+)", raw)
            out.append({"src": src, "url": url, "title": _strip(title.group(1), 200), "body": _strip(raw, 300),
                        "steam_hint": hint.group(1) if hint else None, "published_at": _iso(date.group(1) if date else "")})
    return out


# ---------------------------------------------------------------- Steam

async def fetch_steam_lists() -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    async with _session() as s:
        for name, url in STEAM_LISTS.items():
            t = await _get(s, url)
            try:
                items = json.loads(t or "{}").get("items") or []
            except ValueError:
                items = []
            rows = []
            for i, it in enumerate(items):
                m = re.search(r"/apps/(\d+)/", it.get("logo") or "")
                if m:
                    rows.append({"appid": m.group(1), "name": html.unescape(it.get("name") or ""), "rank": i + 1})
            out[name] = rows
            await asyncio.sleep(1.5)
    return out


# ---------------------------------------------------------------- YouTube

def yt_key() -> str:
    return os.getenv("YOUTUBE_API_KEY") or ""


def channels() -> List[Dict[str, str]]:
    with open(CHANNELS_FILE, encoding="utf-8") as f:
        return json.load(f)["channels"]


async def _yt(session: aiohttp.ClientSession, path: str, **q) -> Dict[str, Any]:
    q["key"] = yt_key()
    try:
        async with session.get(YT + path + "?" + urlencode(q)) as r:
            if r.status != 200:
                print(f"[scene] youtube {path} → {r.status}")
                return {}
            return await r.json()
    except Exception as e:
        print(f"[scene] youtube {path} failed: {type(e).__name__}")
        return {}


async def fetch_channel_videos(days: int = 7, chans: Optional[List[Dict[str, str]]] = None) -> List[Dict[str, Any]]:
    """各チャンネルの新着（uploads プレイリスト。1 チャンネル 1 ユニット）。chans 省略時は channels.json の配信者・VTuber"""
    if not yt_key():
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: List[Dict[str, Any]] = []
    async with _session() as s:
        for ch in (chans if chans is not None else channels()):
            uploads = ch.get("uploads") or ("UU" + ch["channel_id"][2:])
            d = await _yt(s, "playlistItems", part="snippet,contentDetails", playlistId=uploads, maxResults=25)
            for it in d.get("items") or []:
                sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
                at = cd.get("videoPublishedAt") or sn.get("publishedAt")
                if not at or datetime.fromisoformat(at.replace("Z", "+00:00")) < since:
                    continue
                th = (sn.get("thumbnails") or {})
                thumb = ((th.get("medium") or th.get("high") or th.get("default")) or {}).get("url")
                out.append({"video_id": cd.get("videoId"), "channel_id": ch["channel_id"], "channel_name": ch["name"],
                            "channel_group": ch.get("group") or "曲置き場", "title": sn.get("title") or "", "thumb": thumb,
                            "published_at": datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()})
    return [v for v in out if v["video_id"]]


async def channel_images(ids: List[str]) -> Dict[str, Optional[str]]:
    """チャンネルのアイコン（50 チャンネルで 1 ユニット）"""
    out: Dict[str, Optional[str]] = {}
    if not yt_key():
        return out
    async with _session() as s:
        for i in range(0, len(ids), 50):
            d = await _yt(s, "channels", part="snippet", id=",".join(ids[i:i + 50]))
            for it in d.get("items") or []:
                th = (it.get("snippet") or {}).get("thumbnails") or {}
                out[it["id"]] = ((th.get("default") or th.get("medium")) or {}).get("url")
    return out


async def video_channels(ids: List[str]) -> Dict[str, tuple]:
    """動画 ID → (チャンネル ID, チャンネル名)。50 本で 1 ユニット"""
    out: Dict[str, tuple] = {}
    if not yt_key():
        return out
    async with _session() as s:
        for i in range(0, len(ids), 50):
            d = await _yt(s, "videos", part="snippet", id=",".join(ids[i:i + 50]))
            for it in d.get("items") or []:
                sn = it.get("snippet") or {}
                out[it["id"]] = (sn.get("channelId"), sn.get("channelTitle"))
    return out


async def video_views(ids: List[str]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    if not yt_key():
        return out
    async with _session() as s:
        for i in range(0, len(ids), 50):
            d = await _yt(s, "videos", part="statistics", id=",".join(ids[i:i + 50]))
            for it in d.get("items") or []:
                out[it["id"]] = int((it.get("statistics") or {}).get("viewCount") or 0)
    return out


_JP = re.compile(r"[぀-ヿ一-鿿]")


def _norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", (s or "").lower())


async def jikkyou_views(name: str, days: int = 14) -> Optional[Dict[str, Any]]:
    """日本語の実況動画（直近 days 日）の再生数の合計。検索 1 回 100 ユニット＋統計 1 ユニット"""
    if not yt_key():
        return None
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    async with _session() as s:
        d = await _yt(s, "search", part="snippet", q=f"{name} 実況", type="video", order="viewCount", publishedAfter=since,
                      relevanceLanguage="ja", regionCode="JP", maxResults=25)
        if not d:
            return None
        titles = {i["id"]["videoId"]: i["snippet"]["title"] for i in d.get("items") or [] if i.get("id", {}).get("videoId")}
        key = _norm(name)[:6]
        rel = [v for v, t in titles.items() if key and key in _norm(t) and _JP.search(t)]
        if not rel:
            return {"views": 0, "videos": 0, "top_video": None, "top_title": None}
        st = await _yt(s, "videos", part="statistics", id=",".join(rel))
    views = {it["id"]: int((it.get("statistics") or {}).get("viewCount") or 0) for it in st.get("items") or []}
    top = max(views, key=views.get) if views else None
    return {"views": sum(views.values()), "videos": len(views), "top_video": top, "top_title": titles.get(top) if top else None}


# ---------------------------------------------------------------- 原曲（YouTube Music）

_ytm = None


def find_original(song: str, artist: Optional[str]) -> Optional[str]:
    """歌ってみた・踊ってみたの原曲を YouTube Music で探して videoId を返す（同期。to_thread で）"""
    global _ytm
    try:
        if _ytm is None:
            from ytmusicapi import YTMusic
            _ytm = YTMusic(language="en", location="JP")
        res = _ytm.search(f"{song} {artist or ''}".strip(), filter="songs", limit=3)
        for r in res:
            if r.get("videoId"):
                return r["videoId"]
    except Exception as e:
        print(f"[scene] ytmusic search failed: {type(e).__name__}")
    return None
