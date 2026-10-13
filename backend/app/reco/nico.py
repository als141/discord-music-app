"""ニコニコ動画の候補（2026-10-14 時点で動作確認済み）。

- スナップショット検索 API v2（snapshot.search.nicovideo.jp。公式・キー不要。UA と _context を付ける）
  - 今週伸びてる: タグ完全一致 × 直近 14 日 × いいね順
  - あの頃の名曲: 「VOCALOID伝説入り」「VOCALOID殿堂入り」「歌ってみた殿堂入り」… × 再生数順
- nvapi の関連動画（recipeId=video_watch_recommendation）: ニコニコの曲が置かれたら、その関連
再生は既存の yt-dlp の汎用経路（ログイン不要の AAC。Pi で確認済み）。
"""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from . import store

UA = "Irina-DodekaBot/1.0 (+https://discord-music-app.vercel.app)"
SNAP = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search"
FIELDS = "contentId,title,viewCounter,likeCounter,mylistCounter,startTime,tags,lengthSeconds,thumbnailUrl,userId,channelId"
JST = timezone(timedelta(hours=9))
TREND_TAGS = ["VOCALOID", "歌ってみた", "オリジナル曲"]
CLASSIC_TAGS = ["VOCALOID伝説入り", "VOCALOID殿堂入り", "歌ってみた伝説入り"]


def _get(url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _item(d: Dict[str, Any]) -> Dict[str, Any]:
    tags = (d.get("tags") or "").split() if isinstance(d.get("tags"), str) else (d.get("tags") or [])
    start = d.get("startTime") or ""
    return {"key": "nico:" + d["contentId"], "title": d.get("title") or "", "tags": tags[:20],
            "views": d.get("viewCounter"), "likes": d.get("likeCounter"), "year": int(start[:4]) if start[:4].isdigit() else None,
            "published_at": start, "duration": d.get("lengthSeconds"), "thumb": d.get("thumbnailUrl")}


def search(tag: str, *, since: Optional[datetime] = None, until: Optional[datetime] = None, sort: str = "-likeCounter",
           limit: int = 50, min_len: int = 60, max_len: int = 600) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"q": tag, "targets": "tagsExact", "fields": FIELDS, "_sort": sort, "_limit": limit, "_context": "irina-dodeka",
                         "filters[lengthSeconds][gte]": min_len, "filters[lengthSeconds][lte]": max_len}
    if since:
        q["filters[startTime][gte]"] = since.astimezone(JST).isoformat(timespec="seconds")
    if until:
        q["filters[startTime][lt]"] = until.astimezone(JST).isoformat(timespec="seconds")
    d = _get(SNAP + "?" + urllib.parse.urlencode(q))
    if (d.get("meta") or {}).get("status") != 200:
        raise RuntimeError(f"snapshot {d.get('meta')}")
    return [_item(x) for x in d.get("data") or []]


def related(vid: str, limit: int = 20) -> List[Dict[str, Any]]:
    d = _get(f"https://nvapi.nicovideo.jp/v1/recommend?recipeId=video_watch_recommendation&videoId={vid}&limit={limit}"
             "&site=nicovideo&_frontendId=6&_frontendVersion=0", {"X-Frontend-Id": "6", "X-Frontend-Version": "0"})
    out = []
    for it in ((d.get("data") or {}).get("items") or []):
        c = it.get("content") or {}
        if it.get("contentType") != "video" or not c.get("id"):
            continue
        reg = c.get("registeredAt") or ""
        out.append({"key": "nico:" + c["id"], "title": c.get("title") or "", "tags": [],
                    "views": (c.get("count") or {}).get("view"), "likes": (c.get("count") or {}).get("like"),
                    "year": int(reg[:4]) if reg[:4].isdigit() else None, "published_at": reg, "duration": c.get("duration"),
                    "thumb": (c.get("thumbnail") or {}).get("middleUrl") or (c.get("thumbnail") or {}).get("url")})
    return out


def trending(days: int = 14) -> List[Dict[str, Any]]:
    """今週伸びてる（キャッシュ 6 時間）"""
    cached = store.radio_get("trend", "nico", 0.25)
    if cached is not None:
        return cached
    since = datetime.now(JST) - timedelta(days=days)
    out: Dict[str, Dict[str, Any]] = {}
    for tag in TREND_TAGS:
        try:
            for it in search(tag, since=since, limit=60):
                it["src_tag"] = tag
                out.setdefault(it["key"], it)
        except Exception as e:
            print(f"[reco] nico trend {tag} failed: {type(e).__name__}: {str(e)[:80]}")
    items = sorted(out.values(), key=lambda x: -(x.get("likes") or 0))
    if items:
        store.radio_set("trend", "nico", items)
    return items


def classics() -> List[Dict[str, Any]]:
    """あの頃の名曲（10 年以上前。キャッシュ 7 日）"""
    cached = store.radio_get("classics", "nico", 7)
    if cached is not None:
        return cached
    until = datetime.now(JST).replace(year=datetime.now(JST).year - 9, month=1, day=1)
    out: Dict[str, Dict[str, Any]] = {}
    for tag in CLASSIC_TAGS:
        try:
            for it in search(tag, until=until, sort="-viewCounter", limit=100):
                it["src_tag"] = tag
                out.setdefault(it["key"], it)
        except Exception as e:
            print(f"[reco] nico classics {tag} failed: {type(e).__name__}: {str(e)[:80]}")
    items = sorted(out.values(), key=lambda x: -(x.get("views") or 0))
    if items:
        store.radio_set("classics", "nico", items)
    return items


def related_cached(key: str) -> List[Dict[str, Any]]:
    cached = store.radio_get(key, "nico_rel", 5)
    if cached is not None:
        return cached
    try:
        items = related(key.split(":", 1)[1])
    except Exception as e:
        print(f"[reco] nico related {key} failed: {type(e).__name__}")
        return []
    store.radio_set(key, "nico_rel", items)
    return items
