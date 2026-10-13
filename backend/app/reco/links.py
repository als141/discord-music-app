"""曲のリンクを見分けて、流せる形（YouTube か ニコニコ）にそろえる。

- YouTube / YouTube Music / ニコニコ はそのまま（key = "yt:<動画ID>" / "nico:<sm…>"）
- Spotify / Apple Music は曲名とアーティストを読んで YouTube Music で探す（読むのは許可したホストだけ。任意の URL は取りに行かない）
"""
import html
import json
import re
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:[^\s#]*&)?v=|shorts/|live/|embed/)|youtu\.be/|music\.youtube\.com/watch\?(?:[^\s#]*&)?v=)"
                   r"([A-Za-z0-9_-]{11})")
NICO_RE = re.compile(r"(?:nicovideo\.jp/watch/|nico\.ms/)((?:sm|nm|so)\d+)")
SPOTIFY_RE = re.compile(r"https?://open\.spotify\.com/(?:intl-[a-z]+/)?track/([A-Za-z0-9]{22})")
APPLE_RE = re.compile(r"https?://music\.apple\.com/[a-z]{2}/(?:album|song)/[^\s?#]*/(\d+)(?:\?[^\s#]*\bi=(\d+))?")
URL_RE = re.compile(r"https?://[^\s<>()\"']+")
UA = "Mozilla/5.0 (compatible; IrinaDodeka/1.0; +https://discord-music-app.vercel.app)"


def find_keys(text: str) -> List[str]:
    """本文から流せる曲の key を出現順に（重複なし）。Spotify / Apple は含めない（解決が要る）"""
    out: List[str] = []
    for m in YT_RE.finditer(text or ""):
        k = "yt:" + m.group(1)
        if k not in out:
            out.append(k)
    for m in NICO_RE.finditer(text or ""):
        k = "nico:" + m.group(1)
        if k not in out:
            out.append(k)
    return out


def play_url(key: str) -> str:
    platform, vid = key.split(":", 1)
    if platform == "nico":
        return f"https://www.nicovideo.jp/watch/{vid}"
    return f"https://www.youtube.com/watch?v={vid}"


def thumb_of(key: str) -> str:
    platform, vid = key.split(":", 1)
    if platform == "yt":
        return f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"
    return ""


def _fetch(url: str, timeout: float = 10) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(600_000).decode("utf-8", "replace")


def _spotify_meta(track_id: str) -> Optional[Dict[str, str]]:
    """og:title（曲名）と og:description（「アーティスト · アルバム · Song · 年」）"""
    page = _fetch(f"https://open.spotify.com/track/{track_id}")
    og = {m.group(1): html.unescape(m.group(2)) for m in re.finditer(r'<meta property="og:(\w+)" content="([^"]*)"', page)}
    if not og.get("title"):
        return None
    desc = [p.strip() for p in (og.get("description") or "").split("·")]
    return {"title": og["title"], "artist": desc[0] if desc else ""}


def _apple_meta(track_id: str) -> Optional[Dict[str, str]]:
    d = json.loads(_fetch(f"https://itunes.apple.com/lookup?id={track_id}&country=jp"))
    for r in d.get("results") or []:
        if r.get("trackName"):
            return {"title": r["trackName"], "artist": r.get("artistName") or ""}
    return None


def external_meta(url: str) -> Optional[Dict[str, str]]:
    """Spotify / Apple Music のリンクから曲名とアーティスト（読めなければ None）"""
    m = SPOTIFY_RE.search(url)
    if m:
        return _spotify_meta(m.group(1))
    m = APPLE_RE.search(url)
    if m:
        return _apple_meta(m.group(2) or m.group(1))
    return None


def is_supported(url: str) -> bool:
    return bool(find_keys(url) or SPOTIFY_RE.search(url) or APPLE_RE.search(url))


def split_urls(text: str) -> List[str]:
    return [u.rstrip(".,、。）)") for u in URL_RE.findall(text or "")]


def normalize_name(s: Optional[str]) -> str:
    """「キタニタツヤ / Tatsuya Kitani」「Kenshi Yonezu  米津玄師」のゆれを比べるための形"""
    s = (s or "").lower()
    s = re.sub(r"(official|オフィシャル|channel|チャンネル|\bvevo\b|- topic|\btopic\b)", "", s)
    return re.sub(r"[\s・･.,:：!！?？'’\"“”\-‐–—_~〜()（）\[\]【】「」『』/／|｜&＆]+", "", s)


def name_aliases(s: Optional[str]) -> List[str]:
    """「キタニタツヤ / Tatsuya Kitani」→ [キタニタツヤ, tatsuyakitani, キタニタツヤtatsuyakitani]"""
    if not s:
        return []
    parts = [p for p in re.split(r"\s*[/／|｜]\s*|\s{2,}|\s*[（(][^）)]*[）)]\s*", s) if p and p.strip()]
    out = {normalize_name(s)}
    out.update(normalize_name(p) for p in parts)
    # 「Kenshi Yonezu 米津玄師」のように英字と日本語が並ぶとき
    jp = re.findall(r"[぀-ヿ㐀-鿿々ー]+", s)
    if jp:
        out.add(normalize_name("".join(jp)))
    en = re.findall(r"[A-Za-z][A-Za-z\s]+[A-Za-z]", s)
    for e in en:
        out.add(normalize_name(e))
    return [a for a in out if len(a) >= 2]


def quote(s: str) -> str:
    return urllib.parse.quote(s, safe="")
