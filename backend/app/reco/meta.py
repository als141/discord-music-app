"""曲の素性を埋める（すべて後追い・少しずつ。scheduler から呼ぶ）。

1. YouTube Data API videos.list（50 本で 1 ユニット）: 題名・チャンネル・カテゴリ・公開日・長さ・再生数。消えた動画は gone
2. ニコニコ getthumbinfo: 題名・投稿者・投稿日・長さ・再生数・タグ
3. 音楽かどうか: カテゴリ 10（音楽）と Claude Haiku の判定（scene.classify.judge_videos を流用）。
   #一般 のリンクはゲームの切り抜きやネタ動画が多いので、ここで落とさないとおすすめが崩れる
4. YouTube Music（en/JP の公開インスタンス。オーナー個人のアカウントは使わない）: アーティスト ID・発売年と、
   その曲の「次に流れる曲」（ラジオ）を 1 回の呼び出しで取ってキャッシュする
"""
import asyncio
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import links, store

YTM_RADIO_DAYS = 5
NICO_UA = "Irina-DodekaBot/1.0 (+https://discord-music-app.vercel.app)"
_ytm_en = None
_ytm_ja = None


def ytm_en():
    global _ytm_en
    if _ytm_en is None:
        from ytmusicapi import YTMusic
        _ytm_en = YTMusic(language="en", location="JP")
    return _ytm_en


def ytm_ja():
    global _ytm_ja
    if _ytm_ja is None:
        from ytmusicapi import YTMusic
        _ytm_ja = YTMusic(language="ja", location="JP")
    return _ytm_ja


def _iso_dur(s: Optional[str]) -> Optional[int]:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return None
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


def _mmss(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        parts = [int(x) for x in s.split(":")]
    except ValueError:
        return None
    sec = 0
    for p in parts:
        sec = sec * 60 + p
    return sec


def clean_title(t: Optional[str]) -> str:
    """YouTube Music（en）の「春泥棒 - Spring Thief」から英訳を落とす（左に日本語があるときだけ）"""
    t = (t or "").strip()
    m = re.match(r"^(.*[぀-ヿ㐀-鿿].*?)\s+-\s+[A-Za-z0-9][^぀-ヿ㐀-鿿]*$", t)
    return m.group(1).strip() if m else t


# ---------------------------------------------------------------- 1. YouTube Data API

async def fill_youtube(limit: int = 200) -> int:
    from ..scene import sources as ssrc
    if not ssrc.yt_key():
        return 0
    rows = await asyncio.to_thread(store.tracks_needing, "meta_at", limit, "yt")
    if not rows:
        return 0
    n = 0
    async with ssrc._session() as s:
        for i in range(0, len(rows), 50):
            chunk = rows[i:i + 50]
            d = await ssrc._yt(s, "videos", part="snippet,contentDetails,statistics", id=",".join(r["vid"] for r in chunk))
            if "items" not in d:   # 失敗（鍵・上限）。消えた扱いにしない
                break
            got = {it["id"]: it for it in d["items"]}
            for r in chunk:
                it = got.get(r["vid"])
                if not it:
                    await asyncio.to_thread(store.update_track, r["key"], gone=1, meta_at=store.now_iso())
                    continue
                sn, cd, st = it.get("snippet") or {}, it.get("contentDetails") or {}, it.get("statistics") or {}
                th = sn.get("thumbnails") or {}
                pub = sn.get("publishedAt")
                await asyncio.to_thread(
                    store.update_track, r["key"], title=sn.get("title"), channel=sn.get("channelTitle"), channel_id=sn.get("channelId"),
                    category=sn.get("categoryId"), published_at=pub, year=int(pub[:4]) if pub else None,
                    duration=_iso_dur(cd.get("duration")), views=int(st.get("viewCount") or 0) or None,
                    thumb=((th.get("medium") or th.get("high") or th.get("default")) or {}).get("url"), meta_at=store.now_iso())
                n += 1
    return n


# ---------------------------------------------------------------- 2. ニコニコ

def nico_thumbinfo(vid: str) -> Optional[Dict[str, Any]]:
    req = urllib.request.Request(f"https://ext.nicovideo.jp/api/getthumbinfo/{vid}", headers={"User-Agent": NICO_UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        root = ET.fromstring(r.read())
    if root.get("status") != "ok":
        return None
    t = root.find("thumb")
    g = lambda k: (t.findtext(k) or "").strip()  # noqa: E731
    return {"title": g("title"), "channel": g("user_nickname") or g("ch_name"), "channel_id": g("user_id") or g("ch_id"),
            "published_at": g("first_retrieve"), "duration": _mmss(g("length")), "views": int(g("view_counter") or 0),
            "thumb": g("thumbnail_url"), "tags": [x.text for x in t.findall("tags/tag") if x.text]}


async def fill_niconico(limit: int = 40) -> int:
    rows = await asyncio.to_thread(store.tracks_needing, "meta_at", limit, "nico")
    n = 0
    for r in rows:
        try:
            d = await asyncio.to_thread(nico_thumbinfo, r["vid"])
        except Exception as e:
            print(f"[reco] nico thumbinfo {r['vid']} failed: {type(e).__name__}")
            continue
        if not d:
            await asyncio.to_thread(store.update_track, r["key"], gone=1, meta_at=store.now_iso())
            continue
        pub = d["published_at"]
        await asyncio.to_thread(store.update_track, r["key"], title=d["title"], channel=d["channel"], channel_id=d["channel_id"],
                                published_at=pub, year=int(pub[:4]) if pub[:4].isdigit() else None, duration=d["duration"],
                                views=d["views"], thumb=d["thumb"], tags=d["tags"], meta_at=store.now_iso())
        n += 1
        await asyncio.sleep(0.6)
    return n


# ---------------------------------------------------------------- 3. 音楽かどうか

_NICO_MUSIC_TAGS = {"音楽", "VOCALOID", "歌ってみた", "演奏してみた", "オリジナル曲", "ボカロ", "UTAU", "CeVIO", "SynthV", "作業用BGM",
                    "東方アレンジ", "アニソン", "ミクオリジナル曲", "初音ミク", "重音テト", "可不"}


def _kind(track: Dict[str, Any], judge: Optional[Dict[str, Any]]) -> str:
    dur = track.get("duration") or 0
    music = (judge or {}).get("kind") == "song" or (track.get("category") == "10" and (judge or {}).get("kind") != "game")
    if track.get("platform") == "nico" and set(track.get("tags") or []) & _NICO_MUSIC_TAGS and (judge or {}).get("kind") != "game":
        music = True
    if not music:
        return "other"
    if dur and dur > 15 * 60:
        return "long"     # 歌枠・メドレー・作業用（おすすめには出さない）
    if dur and dur < 60:
        return "short"
    return "music"


async def judge(limit: int = 200) -> int:
    from ..scene import classify
    from ..services import game_sources as gsrc
    rows = await asyncio.to_thread(store.tracks_needing, "judged_at", limit, None, "meta_at IS NOT NULL")
    if not rows or not gsrc.claude_enabled():
        return 0
    by_vid = {r["vid"]: r for r in rows}
    payload = [{"id": r["vid"], "text": f"{r.get('channel') or ''} | {r.get('title') or ''}"
                + (f" | タグ: {' '.join((r.get('tags') or [])[:8])}" if r.get("tags") else "")} for r in rows]
    res, usd = await classify.judge_videos(payload)
    for vid, r in by_vid.items():
        j = res.get(vid)
        if j is None and not res:
            break   # 予算切れなど
        kind = _kind(r, j)
        if r.get("kind") == "music" and kind == "other":
            kind = "music"   # 曲置き箱に置かれた曲（置いた人が曲だと言っている）
        await asyncio.to_thread(store.update_track, r["key"], kind=kind, song=(j or {}).get("song"),
                                orig_artist=(j or {}).get("artist"), song_type=(j or {}).get("song_type"),
                                judged_at=store.now_iso())
    print(f"[reco] judged {len(res)}/{len(rows)} (${usd:.3f})")
    return len(res)


# ---------------------------------------------------------------- 4. YouTube Music

def _ytm_item(tr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not tr.get("videoId"):
        return None
    th = tr.get("thumbnail") or tr.get("thumbnails") or []
    return {"key": "yt:" + tr["videoId"], "title": clean_title(tr.get("title")),
            "artists": [{"name": a.get("name"), "id": a.get("id")} for a in tr.get("artists") or [] if a.get("name")],
            "year": int(tr["year"]) if str(tr.get("year") or "").isdigit() else None,
            "type": (tr.get("videoType") or "").replace("MUSIC_VIDEO_TYPE_", "").lower() or None,
            "thumb": th[-1]["url"] if th else None, "duration": _mmss(tr.get("length"))}


def ytm_watch(vid: str, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
    """「次に流れる曲」。先頭はその曲自身"""
    w = ytm_en().get_watch_playlist(videoId=vid, limit=limit)
    return [x for x in (_ytm_item(t) for t in w.get("tracks") or []) if x]


async def enrich_ytm(limit: int = 30, parallel: int = 3) -> int:
    """音楽と判定された YouTube の曲に、YouTube Music のアーティスト ID・年とラジオを付ける（1 曲 1 回、約 0.5〜1 秒）"""
    rows = await asyncio.to_thread(store.tracks_needing, "ytm_at", limit, "yt", "kind = 'music'")
    sem = asyncio.Semaphore(parallel)

    async def one(r: Dict[str, Any]) -> None:
        async with sem:
            try:
                items = await asyncio.wait_for(asyncio.to_thread(ytm_watch, r["vid"], 30), timeout=30)
            except Exception as e:
                items = None
                print(f"[reco] ytm {r['vid']} failed: {type(e).__name__}: {str(e)[:80]}")
            fields: Dict[str, Any] = {"ytm_at": store.now_iso()}
            if items:
                seed = items[0] if items[0]["key"] == r["key"] else None
                if seed:
                    fields["artists"] = seed["artists"]
                    if seed["year"] and (not r.get("year") or seed["year"] < r["year"]):
                        fields["year"] = seed["year"]   # 公開年より発売年（古いほう）を信じる
                await asyncio.to_thread(store.radio_set, r["key"], "ytm", [x for x in items if x["key"] != r["key"]])
            await asyncio.to_thread(store.update_track, r["key"], **fields)
            await asyncio.sleep(0.3)

    await asyncio.gather(*(one(r) for r in rows))
    return len(rows)


async def radio_for(key: str) -> List[Dict[str, Any]]:
    """キャッシュが古ければ取り直す（seed として使うときだけ呼ぶ）"""
    cached = await asyncio.to_thread(store.radio_get, key, "ytm", YTM_RADIO_DAYS)
    if cached is not None:
        return cached
    try:
        items = await asyncio.wait_for(asyncio.to_thread(ytm_watch, key.split(":", 1)[1], 30), timeout=30)
    except Exception:
        return []
    items = [x for x in items if x["key"] != key]
    await asyncio.to_thread(store.radio_set, key, "ytm", items)
    return items


_artist_ja: Dict[str, str] = {}


async def artist_ja(artist_id: Optional[str], fallback: str) -> str:
    """YouTube Music のアーティストの日本語表記（「Yorushika」→「ヨルシカ」）。一度引いたら reco_kv に持つ"""
    if not artist_id:
        return fallback
    if artist_id in _artist_ja:
        return _artist_ja[artist_id]
    v = await asyncio.to_thread(store.kv_get, f"artist_ja:{artist_id}")
    if v is None:
        try:
            a = await asyncio.to_thread(ytm_ja().get_artist, artist_id)
            v = (a or {}).get("name") or fallback
        except Exception:
            v = fallback
        await asyncio.to_thread(store.kv_set, f"artist_ja:{artist_id}", v)
    _artist_ja[artist_id] = v
    return v


# ---------------------------------------------------------------- 曲置き箱のリンク

async def resolve_box_url(url: str) -> Optional[Dict[str, Any]]:
    """箱に置かれたリンク → {key, title, artist}。YouTube / ニコニコはそのまま、Spotify / Apple Music は YouTube Music で探す"""
    keys = links.find_keys(url)
    if keys:
        return {"key": keys[0]}
    meta = await asyncio.to_thread(links.external_meta, url)
    if not meta:
        return None
    q = f"{meta['artist']} {meta['title']}".strip()
    try:
        res = await asyncio.to_thread(ytm_en().search, q, filter="songs", limit=5)
    except Exception:
        return None
    want_t, want_a = links.normalize_name(meta["title"]), links.normalize_name(meta["artist"])
    best = None
    for r in res or []:
        if not r.get("videoId"):
            continue
        t = links.normalize_name(clean_title(r.get("title")))
        a = links.normalize_name(" ".join(x.get("name") or "" for x in r.get("artists") or []))
        score = (2 if t and (t in want_t or want_t in t) else 0) + (1 if a and want_a and (a[:6] in want_a or want_a[:6] in a) else 0)
        if best is None or score > best[0]:
            best = (score, r)
    if not best or best[0] < 2:
        return None
    return {"key": "yt:" + best[1]["videoId"], "title": meta["title"], "artist": meta["artist"]}


def now_year() -> int:
    return datetime.now(timezone.utc).year
