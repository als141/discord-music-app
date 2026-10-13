"""ドデカのおすすめ: フィードの組み立て・曲置き箱・反応・裏の定期処理（web プロセス）。

- feed(): 4 つの気分を組み立てて返す（VC に居る人と 3 時間ごとの揺らぎごとに 3 分キャッシュ）
- 曲置き箱: リンクを置くとすぐ reco_events に入り、次のフィードから効く（＝置くほど育つ）
- 反応: おすすめから流した / 外した。外した曲は 90 日出さない。Claude にも直近 2 週間の様子を渡す
- scheduler(): 記録の取り込み → 曲の素性 → 音楽の判定 → YouTube Music のラジオ → ニコニコ → 1 日 1 回 Claude の選曲
"""
import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from .. import db
from . import curate, engine, links, meta, nico, sources, store

JST = timezone(timedelta(hours=9))
CURATE_HOUR = 16            # 毎日この時刻（JST）以降に 1 回
CURATE_MIN_GAP_H = 6        # 箱に曲がたくさん増えたときの追加の選曲は 6 時間あける
BOX_PER_HOUR = 30
_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}
CACHE_SEC = 180


def invalidate(guild_id: str) -> None:
    for k in [k for k in _cache if k[0] == guild_id]:
        _cache.pop(k, None)


def _vc_users(guild_id: str) -> Set[str]:
    try:
        with db._connect() as c:
            return {r[0] for r in c.execute("SELECT user_id FROM voice_presence WHERE guild_id = ?", (guild_id,))}
    except Exception:
        return set()


def _blocked(guild_id: str) -> Set[str]:
    return {f["key"] for f in store.feedback_since(guild_id, 90) if f["action"] == "dismiss"}


async def _members(guild_id: str) -> Dict[str, Dict[str, Any]]:
    try:
        from ..api import app_routes
        info = await app_routes._guild_members(guild_id)
        return {m["id"]: m for m in info["members"]}
    except Exception:
        return {}


def _buckets(p: engine.Profile, vc: Set[str], extra: List[Dict[str, Any]]) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    radios = store.radio_all("ytm", p.stats.keys())
    blocked = _blocked(p.guild_id) | p.recently_skipped(30)
    trend = store.radio_get("trend", "nico", 30) or []
    classic = store.radio_get("classics", "nico", 60) or []
    related = {k: v for k, v in store.radio_all("nico_rel", [k for k in p.stats if k.startswith("nico:")]).items()}
    return {
        "now": engine.build_now(p, vc, radios, blocked),
        "memories": engine.build_memories(p, vc, radios, blocked, extra),
        "new": engine.build_new(p, radios, blocked),
        "nico": engine.build_nico(p, trend, classic, related, blocked),
    }


async def _finish(items: List[Dict[str, Any]], members: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """アーティストを日本語表記に、理由の {A}/{S}/{who} を埋め、流す URL を付ける"""
    out = []
    for it in items:
        it = dict(it)
        if it.get("artist_id"):
            it["artist"] = await meta.artist_ja(it["artist_id"], it.get("artist") or "")
        seed_artist = it.get("seed_artist") or ""
        if it.get("seed_artist_id") and not any("\u3040" <= ch <= "\u9fff" for ch in seed_artist):
            seed_artist = await meta.artist_ja(it["seed_artist_id"], seed_artist)
        m = members.get(it.get("who") or "")
        it["who"] = {"name": m["name"], "image": m.get("avatar")} if m else None
        it["reason"] = (it["reason"].replace("{who}", m["name"] if m else "だれか").replace("{A}", it.get("artist") or "")
                        .replace("{S}", seed_artist or "最近の曲"))
        it["url"] = links.play_url(it["key"])
        it["platform"] = "niconico" if it["key"].startswith("nico:") else "youtube"
        for k in ("score", "seed", "artist_id", "seed_artist", "seed_artist_id"):
            it.pop(k, None)
        out.append(it)
    return out


async def feed(guild_id: str) -> Dict[str, Any]:
    vc = await asyncio.to_thread(_vc_users, guild_id)
    seed = engine.rotate_seed(guild_id)
    ck = (guild_id, frozenset(vc), seed)
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return hit[1]
    p = await asyncio.to_thread(engine.Profile, guild_id)
    cur = await asyncio.to_thread(store.kv_json, f"curation:{guild_id}", {}) or {}
    buckets = await asyncio.to_thread(_buckets, p, vc, cur.get("throwbacks") or [])
    members = await _members(guild_id)
    moods: Dict[str, List[Dict[str, Any]]] = {}
    shown: Set[str] = set()
    for mood in ("now", "new", "memories", "nico"):   # 同じ曲を 2 つの気分に出さない（先に組んだほうに）
        items = engine.compose(mood, buckets[mood], (cur.get("moods") or {}).get(mood), seed, exclude=shown)
        shown |= {it["key"] for it in items}
        moods[mood] = await _finish(items, members)
    moods = {m: moods[m] for m in engine.MOODS}
    box_n = len(await asyncio.to_thread(store.box_list, guild_id, 1000))
    data = {
        "moods": moods,
        "stats": {"songs": len(p.stats), "people": len(p.people), "since": p.first_at.astimezone(JST).year if p.first_at else None,
                  "box": box_n, "vc": len(vc)},
        "taste": cur.get("taste"),
        "curated_at": cur.get("at"),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    _cache[ck] = (time.time(), data)
    return data


# ---------------------------------------------------------------- 曲置き箱

async def _fill_one(key: str, from_box: bool) -> Dict[str, Any]:
    """置かれた曲の題名をその場で（判定は待たない。箱に置くのは曲なので音楽として扱う）"""
    t = (await asyncio.to_thread(store.tracks, [key])).get(key) or {}
    if not t.get("meta_at"):
        if key.startswith("yt:"):
            from ..scene import sources as ssrc
            async with ssrc._session() as s:
                d = await ssrc._yt(s, "videos", part="snippet,contentDetails,statistics", id=key[3:])
            it = (d.get("items") or [None])[0]
            if it:
                sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
                th = sn.get("thumbnails") or {}
                pub = sn.get("publishedAt")
                await asyncio.to_thread(store.update_track, key, title=sn.get("title"), channel=sn.get("channelTitle"),
                                        channel_id=sn.get("channelId"), category=sn.get("categoryId"), published_at=pub,
                                        year=int(pub[:4]) if pub else None, duration=meta._iso_dur(cd.get("duration")),
                                        thumb=((th.get("medium") or th.get("default")) or {}).get("url"), meta_at=store.now_iso())
            elif "items" in d:
                await asyncio.to_thread(store.update_track, key, gone=1, meta_at=store.now_iso())
        else:
            try:
                d = await asyncio.to_thread(meta.nico_thumbinfo, key.split(":", 1)[1])
            except Exception:
                d = None
            if d:
                pub = d["published_at"]
                await asyncio.to_thread(store.update_track, key, title=d["title"], channel=d["channel"], channel_id=d["channel_id"],
                                        published_at=pub, year=int(pub[:4]) if pub[:4].isdigit() else None, duration=d["duration"],
                                        views=d["views"], thumb=d["thumb"], tags=d["tags"], meta_at=store.now_iso())
        t = (await asyncio.to_thread(store.tracks, [key])).get(key) or {}
    if from_box and not t.get("judged_at") and not t.get("kind") and t.get("meta_at") and not t.get("gone"):
        # すぐおすすめの材料にする（曲名の整理と歌ってみたかどうかは、あとで Haiku の判定が埋める）
        long = (t.get("duration") or 0) > 15 * 60
        await asyncio.to_thread(store.update_track, key, kind="long" if long else "music")
        t = (await asyncio.to_thread(store.tracks, [key])).get(key) or {}
    return t


def _box_view(row: Dict[str, Any], t: Dict[str, Any], me: Optional[str] = None) -> Dict[str, Any]:
    title, artist, _ = engine.display_of(t) if t.get("title") else (row["url"], "", None)
    return {"id": row["id"], "key": row["key"], "url": links.play_url(row["key"]), "title": title, "artist": artist,
            "thumb": t.get("thumb") or links.thumb_of(row["key"]),
            "platform": "niconico" if row["key"].startswith("nico:") else "youtube",
            "who": {"id": row["added_by_id"], "name": row["added_by_name"], "image": row["added_by_image"]},
            "added_at": row["added_at"], "mine": bool(me and me == row["added_by_id"])}


async def box_list(guild_id: str, me: Optional[str] = None, limit: int = 60) -> List[Dict[str, Any]]:
    rows = await asyncio.to_thread(store.box_list, guild_id, limit)
    tr = await asyncio.to_thread(store.tracks, [r["key"] for r in rows])
    return [_box_view(r, tr.get(r["key"]) or {}, me) for r in rows]


async def box_add(guild_id: str, user_id: str, user_name: Optional[str], image: Optional[str], text: str) -> List[Dict[str, Any]]:
    urls = links.split_urls(text)[:10]
    if not urls:
        raise ValueError("リンクが見つかりませんでした")
    if await asyncio.to_thread(store.box_count_since, guild_id, user_id, store.ago(1 / 24)) + len(urls) > BOX_PER_HOUR:
        raise ValueError("1 時間に置けるのは 30 曲までです")
    results = []
    for url in urls:
        if not links.is_supported(url):
            results.append({"url": url, "ok": False, "error": "YouTube・YouTube Music・ニコニコ・Spotify・Apple Music のリンクを置けます"})
            continue
        try:
            r = await meta.resolve_box_url(url)
        except Exception as e:
            print(f"[reco] box resolve failed: {type(e).__name__}: {str(e)[:80]}")
            r = None
        if not r:
            results.append({"url": url, "ok": False, "error": "曲が見つかりませんでした"})
            continue
        key = r["key"]
        await asyncio.to_thread(store.ensure_tracks, [key])
        t = await _fill_one(key, from_box=True)
        if t.get("gone") or not t.get("meta_at"):
            results.append({"url": url, "ok": False, "error": "再生できない動画でした（削除・非公開など）"})
            continue
        bid = await asyncio.to_thread(store.box_add, guild_id, key, url, user_id, user_name, image)
        await asyncio.to_thread(store.add_events, [{"guild_id": guild_id, "key": key, "kind": "box", "user_id": user_id,
                                                     "user_name": user_name, "at": store.now_iso(), "ref": f"box:{bid}"}])
        row = await asyncio.to_thread(store.box_get, bid)
        results.append({"url": url, "ok": True, "item": _box_view(row, t, user_id)})
    if any(r["ok"] for r in results):
        invalidate(guild_id)
        print(f"[reco] box +{sum(r['ok'] for r in results)} by {user_id}")
    return results


async def box_remove(guild_id: str, box_id: int, user_id: str, is_admin: bool) -> None:
    row = await asyncio.to_thread(store.box_get, box_id)
    if not row or row["guild_id"] != guild_id or row.get("removed_at"):
        raise LookupError("見つかりません")
    if row["added_by_id"] != user_id and not is_admin:
        raise PermissionError("置いた人だけが取り出せます")
    await asyncio.to_thread(store.box_remove, box_id)
    invalidate(guild_id)


async def feedback(guild_id: str, user_id: str, key: str, action: str, mood: Optional[str]) -> None:
    await asyncio.to_thread(store.add_feedback, guild_id, user_id, key, action, mood)
    if action == "dismiss":
        invalidate(guild_id)


# ---------------------------------------------------------------- 裏の定期処理

async def _curate_if_due(guild_id: str) -> None:
    now = datetime.now(JST)
    cur = await asyncio.to_thread(store.kv_json, f"curation:{guild_id}", {}) or {}
    last = engine._dt(cur.get("at"))
    box_since = 0
    if last:
        rows = await asyncio.to_thread(store.box_list, guild_id, 200)
        box_since = sum(1 for r in rows if r["added_at"] > cur["at"])
    due_daily = now.hour >= CURATE_HOUR and (not last or last.astimezone(JST).date() < now.date())
    due_growth = last and box_since >= 8 and datetime.now(timezone.utc) - last > timedelta(hours=CURATE_MIN_GAP_H)
    if not (due_daily or due_growth or not last):
        return
    p = await asyncio.to_thread(engine.Profile, guild_id)
    if len(p.stats) < 20:
        return
    buckets = await asyncio.to_thread(_buckets, p, set(), [])
    seed = engine.rotate_seed(guild_id)
    pools = {mood: engine.compose(mood, b, None, seed, limit=40, per_artist=3) for mood, b in buckets.items()}
    try:
        res = await curate.run(guild_id, pools, p)
    except Exception as e:
        print(f"[reco] curation failed: {type(e).__name__}: {str(e)[:160]}")
        res = None
    if res:
        await asyncio.to_thread(store.kv_set, f"curation:{guild_id}", json.dumps(res, ensure_ascii=False))
        invalidate(guild_id)
    else:
        # 失敗しても毎回呼ばないよう、日付だけ進める
        await asyncio.to_thread(store.kv_set, f"curation:{guild_id}", json.dumps({**cur, "at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False))


async def _refresh_seeds(guild_id: str) -> int:
    """種（最近よく流れる曲）のラジオは 5 日で取り直す"""
    p = await asyncio.to_thread(engine.Profile, guild_id)
    n = 0
    for k, _ in engine.seeds(p, await asyncio.to_thread(_vc_users, guild_id), n=20):
        if await asyncio.to_thread(store.radio_get, k, "ytm", meta.YTM_RADIO_DAYS) is None:
            await meta.radio_for(k)
            n += 1
            await asyncio.sleep(0.5)
    for k in [k for k in p.stats if k.startswith("nico:")][:20]:
        if await asyncio.to_thread(store.radio_get, k, "nico_rel", 5) is None:
            await asyncio.to_thread(nico.related_cached, k)
            n += 1
    return n


async def tick() -> bool:
    """1 周。まだやることが残っていれば True（次は早めに回る）"""
    busy = False
    for g in sources.guild_ids():
        if await asyncio.to_thread(sources.sync, g):
            invalidate(g)
    busy |= await meta.fill_youtube(200) > 0
    busy |= await meta.fill_niconico(30) > 0
    busy |= await meta.judge(160) > 0
    busy |= await meta.enrich_ytm(30) > 0
    await asyncio.to_thread(nico.trending)
    await asyncio.to_thread(nico.classics)
    for g in sources.guild_ids():
        await _refresh_seeds(g)
        if not busy:   # 素性がそろってから選曲する
            await _curate_if_due(g)
    return busy


async def scheduler() -> None:
    await asyncio.sleep(40)
    await asyncio.to_thread(store.init)
    while True:
        try:
            busy = await tick()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            busy = False
            print(f"[reco] tick failed: {type(e).__name__}: {str(e)[:160]}")
        await asyncio.sleep(60 if busy else 300)
