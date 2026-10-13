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


async def _player_state(guild_id: str) -> Dict[str, Any]:
    """いま流れてる曲とキュー（web は voice プロセスに聞く。ローカルの 1 プロセスなら直接）"""
    import os
    try:
        if (os.getenv("IRINA_ROLE") or "all") == "web":
            import aiohttp
            from ..api.voice_proxy import VOICE_UPSTREAM
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2.5)) as s:
                async with s.get(f"{VOICE_UPSTREAM}/player-state/{guild_id}") as r:
                    return await r.json() if r.status == 200 else {}
        from ..api.voice import build_player_state
        return await build_player_state(guild_id, bump_version=False)
    except Exception:
        return {}


def _recent_anchors(guild_id: str, p: engine.Profile) -> List[Dict[str, Any]]:
    """さっき置いた曲（6 時間）・さっき流した曲（3 時間）"""
    out: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for b in store.box_list(guild_id, 6):
        at = engine._dt(b["added_at"])
        if at and now - at < timedelta(hours=6):
            # 置いて 10 分以内はいちばんの起点（流れてる曲より上）。置いたことにすぐ反応して見えるように
            fresh = now - at < timedelta(minutes=10)
            out.append({"key": b["key"], "src": "box", "w": (1.05 if fresh else 0.95) - 0.1 * len([x for x in out if x["src"] == "box"])})
    plays = sorted(((st["last"], k) for k, st in p.stats.items() if st["kinds"]["play"] and now - st["last"] < timedelta(hours=3)), reverse=True)
    for _, k in plays[:2]:
        out.append({"key": k, "src": "played", "w": 0.6})
    tr = store.tracks([a["key"] for a in out])
    for a in out:
        t = tr.get(a["key"]) or {}
        a["title"], a["artist"], _ = engine.display_of(t) if t.get("title") else ("", "", None)
        a["title"] = meta.display_title(a["title"], a["artist"]) or a["title"]
    return out


async def _anchors(guild_id: str, p: engine.Profile) -> List[Dict[str, Any]]:
    st = await _player_state(guild_id)
    out: List[Dict[str, Any]] = []
    cur = st.get("current_track") or {}
    keys = links.find_keys(cur.get("url") or "")
    if keys:
        out.append({"key": keys[0], "src": "playing", "w": 1.0, "title": meta.display_title(cur.get("title"), cur.get("artist")) or "",
                    "artist": cur.get("artist") or ""})
    for q in (st.get("queue") or [])[:3]:
        ks = links.find_keys(q.get("url") or "")
        if ks:
            # 読み込み中（pending）の曲も起点にする（押してすぐ変わるように）。題名はまだ無いので見出しには使わない
            pending = bool(q.get("pending"))
            out.append({"key": ks[0], "src": "queue", "w": 0.8, "title": "" if pending else (q.get("title") or ""),
                        "artist": "" if pending else (q.get("artist") or "")})
    out += await asyncio.to_thread(_recent_anchors, guild_id, p)
    seen: Set[str] = set()
    uniq = []
    for a in sorted(out, key=lambda x: -x["w"]):
        if a["key"] not in seen:
            seen.add(a["key"])
            uniq.append(a)
    return uniq[:5]


async def _anchor_radios(anchors: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """起点の「次に流れる曲」。キャッシュが無ければその場で取る（入れた瞬間に変わるように。並列・最大 9 秒）"""
    async def one(key: str):
        if key.startswith("nico:"):
            return key, await asyncio.to_thread(nico.related_cached, key)
        return key, await meta.radio_for(key)
    try:
        res = await asyncio.wait_for(asyncio.gather(*(one(a["key"]) for a in anchors), return_exceptions=True), timeout=9)
    except asyncio.TimeoutError:
        res = []
    return {k: v for r in res if isinstance(r, tuple) for k, v in [r] if v}


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


_TYPE_JA = {"original": "新曲", "mv": "MV", "cover": "歌ってみた", "dance": "踊ってみた", "live": "ライブ"}


def _scene_items(p: engine.Profile, blocked: Set[str]) -> List[Dict[str, Any]]:
    """界隈の新曲（よく貼られる歌い手・配信者の 30 日の新曲・歌ってみた）。前は別の段だったのを一面に混ぜる"""
    try:
        from ..scene import service as sc
        songs = (sc.build_songs() or {}).get("songs") or []
    except Exception:
        return []
    out = []
    for i, sg in enumerate(songs[:20]):
        vid = sg.get("play_video_id")
        top = (sg.get("videos") or [{}])[0]
        if not vid:
            continue
        key = "yt:" + vid
        if key in blocked or key in p.stats:
            continue
        who = engine._clean_channel(top.get("channel"))
        kind_ja = _TYPE_JA.get(top.get("type") or "", "")
        reason = f"{sg['people']}人がやってる" if (sg.get("people") or 0) > 1 else (f"{who}の{kind_ja}" if kind_ja else who)
        it = engine._item(key, sg.get("song") or top.get("title") or "", sg.get("artist") or who,
                          thumb=top.get("thumb") or links.thumb_of(key), kind="scene", reason=reason, sub=None,
                          score=3.0 - i * 0.12 + 0.4 * min(sg.get("people") or 1, 4))
        it["toks"] = engine.tokens_of([], sg.get("artist"), top.get("channel"))
        out.append(it)
    return out


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
        it["tag"] = engine.TAGS.get(it["kind"], "")
        for k in ("score", "seed", "artist_id", "seed_artist", "seed_artist_id", "toks"):
            it.pop(k, None)
        out.append(it)
    return out


async def feed(guild_id: str) -> Dict[str, Any]:
    """一面に混ぜたおすすめ。いま流れてる曲・キュー・さっき置いた曲が変わると中身も変わる"""
    vc = await asyncio.to_thread(_vc_users, guild_id)
    seed = engine.rotate_seed(guild_id)
    p = await asyncio.to_thread(engine.Profile, guild_id)
    anchors = await _anchors(guild_id, p)
    ck = (guild_id, frozenset(vc), seed, tuple(a["key"] for a in anchors), len(p.stats))
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return hit[1]
    cur = await asyncio.to_thread(store.kv_json, f"curation:{guild_id}", {}) or {}
    moods = await asyncio.to_thread(_buckets, p, vc, cur.get("throwbacks") or [])
    ctx_radios = await _anchor_radios(anchors)
    blocked = await asyncio.to_thread(_blocked, guild_id) | p.recently_skipped(30)
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for b in moods.values():
        buckets.update(b)
    buckets.update(engine.build_context(p, anchors, ctx_radios, blocked))
    buckets["scene"] = await asyncio.to_thread(_scene_items, p, blocked)
    engine.lean_to(buckets, engine.neighborhood(anchors, ctx_radios))
    curated = [c for picks in (cur.get("moods") or {}).values() for c in picks]
    items = engine.compose("mixed", buckets, curated, seed, limit=18)
    members = await _members(guild_id)
    # 見出しの「〜に合わせて」は、実際に関連が出た起点だけ（出なかった起点の名前を出すと「変わってない」に見える）
    shown = {it.get("seed") for it in items if it["kind"] == "context"}
    lead = next((a for a in anchors if a["key"] in shown and (a.get("title") or "").strip()), None)
    label = None
    if lead:
        t = engine._short(lead["title"], 16)
        label = {"playing": f"流れてる「{t}」に合わせて", "queue": f"キューの「{t}」に合わせて",
                 "box": f"置いた「{t}」に合わせて", "played": f"さっきの「{t}」に合わせて"}.get(lead["src"])
    box_n = len(await asyncio.to_thread(store.box_list, guild_id, 1000))
    data = {
        "items": await _finish(items, members),
        "context": {"label": label, "anchors": [{"title": a.get("title"), "src": a["src"]} for a in anchors]},
        "stats": {"songs": len(p.stats), "people": len(p.people), "since": p.first_at.astimezone(JST).year if p.first_at else None,
                  "box": box_n, "vc": len(vc)},
        "taste": cur.get("taste"),
        "curated_at": cur.get("at"),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    now = time.time()
    for k in [k for k, (at, _) in _cache.items() if now - at > 600]:
        _cache.pop(k, None)
    _cache[ck] = (now, data)
    return data


# ---------------------------------------------------------------- みんなの置き場（Discord とアプリを 1 本に）

def _shelf_rows(guild_id: str) -> List[Dict[str, Any]]:
    with db._connect() as c:
        rows = c.execute("SELECT channel_id, channel_name, video_id, posted_by_id, posted_by_name, posted_by_image, posted_at, title, artist, "
                         "thumbnail FROM shared_links WHERE guild_id = ? ORDER BY posted_at DESC LIMIT 800", (guild_id,)).fetchall()
    boxes = store.box_list(guild_id, 300)
    keys = ["yt:" + r[2] for r in rows] + [b["key"] for b in boxes]
    tr = store.tracks(keys)
    out: List[Dict[str, Any]] = []
    for ch, chn, vid, uid, uname, uimg, at, title, artist, thumb in rows:
        key = "yt:" + vid
        t = tr.get(key) or {}
        if t.get("gone"):
            continue
        # #曲置き場 は全部。#一般 などは音楽と判定された曲だけ（切り抜き・ネタ動画を出さない）
        if ch not in sources.SHELF_CHANNELS and t.get("kind") != "music":
            continue
        if t.get("title") and t.get("kind"):
            ttl, art, _ = engine.display_of(t)
        else:
            ttl, art = title or "YouTube 動画", artist or ""
        out.append({"key": key, "title": meta.display_title(ttl, art) or ttl, "artist": art, "thumb": t.get("thumb") or thumb or links.thumb_of(key),
                    "source": f"#{chn}" if chn else "Discord", "who_id": uid, "who": {"name": uname, "image": uimg}, "at": at,
                    "box_id": None, "mine_id": None})
    for b in boxes:
        t = tr.get(b["key"]) or {}
        if t.get("title"):
            ttl, art, _ = engine.display_of(t)
        else:
            ttl, art = b["url"], ""
        out.append({"key": b["key"], "title": meta.display_title(ttl, art) or ttl, "artist": art,
                    "thumb": t.get("thumb") or links.thumb_of(b["key"]), "source": "アプリ", "who_id": b["added_by_id"],
                    "who": {"name": b["added_by_name"], "image": b["added_by_image"]}, "at": b["added_at"], "box_id": b["id"],
                    "mine_id": b["added_by_id"]})
    out.sort(key=lambda x: x["at"] or "", reverse=True)
    seen: Set[str] = set()
    uniq = []
    for it in out:
        if it["key"] in seen:
            continue
        seen.add(it["key"])
        uniq.append(it)
    return uniq


async def shelf(guild_id: str, me: Optional[str], limit: int = 200) -> Dict[str, Any]:
    rows = await asyncio.to_thread(_shelf_rows, guild_id)
    members = await _members(guild_id)
    items = []
    for it in rows[:limit]:
        m = members.get(it["who_id"] or "")
        items.append({"key": it["key"], "url": links.play_url(it["key"]), "title": it["title"], "artist": it["artist"],
                      "thumb": it["thumb"], "source": it["source"], "platform": "niconico" if it["key"].startswith("nico:") else "youtube",
                      "who": {"name": (m or {}).get("name") or it["who"]["name"] or "だれか", "image": (m or {}).get("avatar") or it["who"]["image"]},
                      "at": it["at"], "box_id": it["box_id"], "mine": bool(me and it["mine_id"] == me)})
    return {"items": items, "total": len(rows)}


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
    title = meta.display_title(title, artist) or title
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
