"""界隈フィード: メディア・Steam・配信者の動画を集めて、ゲーム置き場と曲置き場の「界隈で話題」を作る。

web プロセスで動く（Discord に依存しない）。scheduler は main.py の lifespan（web / all ロール）から 1 回だけ起動する。
"""
import asyncio
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from . import classify, sources, store
from ..services import game_db as gdb, game_shelf, game_sources as gsrc

FRESH_DAYS = 180          # 「新作・インディー」に出すのは発売から半年以内（と近日発売）
JIKKYOU_PER_RUN = 8       # 実況の再生数を測る本数（YouTube 検索 1 回 100 ユニット）
JIKKYOU_TTL_H = 24


def _due(key: str, hours: float) -> bool:
    last = gdb.kv_get(key)
    if not last:
        return True
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(last) > timedelta(hours=hours)
    except ValueError:
        return True


def _mark(key: str) -> None:
    gdb.kv_set(key, store.now_iso())


async def _appid_for(name: Optional[str], name_en: Optional[str], hint: Optional[str] = None) -> Optional[str]:
    if hint:
        return hint
    for n in [x for x in (name_en, name) if x]:
        known, appid = await asyncio.to_thread(gdb.get_name_map, n)
        if known:
            if appid:
                return appid
            continue
        appid = await gsrc.steam_find_exact(n)
        await asyncio.to_thread(gdb.set_name_map, n, appid)
        if appid:
            return appid
    return None


def _is_fresh(g: Optional[Dict[str, Any]]) -> bool:
    if not g:
        return False
    if g.get("coming_soon"):
        return True
    d = game_shelf._release_date(g.get("release_text") or "")
    return bool(d and datetime.now(timezone.utc) - d < timedelta(days=FRESH_DAYS))


# ---------------------------------------------------------------- 更新

async def refresh_media() -> None:
    arts = await sources.fetch_articles()
    new = await asyncio.to_thread(store.add_articles, arts)
    rows = await asyncio.to_thread(store.unclassified_articles, 150)
    if rows and gsrc.claude_enabled():
        ids = {f"a{i}": r for i, r in enumerate(rows)}
        res, usd = await classify.judge_articles([{"id": k, "text": f"{r['title']} — {r.get('body') or ''}"[:300]} for k, r in ids.items()])
        for k, r in ids.items():
            j = res.get(k)
            if j:
                await asyncio.to_thread(store.update_article, r["url"], game=j["game"], game_en=j["game_en"], multiplayer=j["multiplayer"],
                                        max_players=j["max_players"], hook=j["hook"], fit=j["fit"], why=j["why"],
                                        classified_at=store.now_iso())
        print(f"[scene] media: new={new} judged={len(res)}/{len(rows)} ${usd:.3f}")
    # 貼りそうな記事のゲームを Steam に結びつける
    for a in await asyncio.to_thread(store.recent_articles, 14, 2):
        if a.get("appid") or a.get("multiplayer") == "solo" and a.get("hook") not in ("free", "demo"):
            continue
        appid = await _appid_for(a.get("game"), a.get("game_en"), a.get("steam_hint"))
        if appid:
            appid = await game_shelf.ensure_game(appid, [a["title"]]) or appid
            await asyncio.to_thread(store.update_article, a["url"], appid=appid)


async def refresh_charts() -> None:
    lists = await sources.fetch_steam_lists()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for name, rows in lists.items():
        await asyncio.to_thread(store.save_chart, name, rows, day)
    # 詳細（発売日）を揃え、新しいものだけ「何人で遊ぶか」を付ける
    for name, rows in lists.items():
        for r in rows[:25]:
            g = await asyncio.to_thread(gdb.get_game, r["appid"])
            if not g or not g.get("details_at"):
                await game_shelf.ensure_game(r["appid"], with_profile=False)
                g = await asyncio.to_thread(gdb.get_game, r["appid"])
            if _is_fresh(g) and not (g or {}).get("profile"):
                await game_shelf.ensure_game(r["appid"])
    print(f"[scene] charts: " + " ".join(f"{k}={len(v)}" for k, v in lists.items()))


async def _ingest_videos(vids: List[Dict[str, Any]], label: str) -> None:
    new = await asyncio.to_thread(store.add_videos, vids)
    views = await sources.video_views([v["video_id"] for v in vids])
    for vid, n in views.items():
        await asyncio.to_thread(store.update_video, vid, views=n)
    rows = await asyncio.to_thread(store.unclassified_videos, 300)
    if not rows or not gsrc.claude_enabled():
        return
    ids = {f"v{i}": r for i, r in enumerate(rows)}
    res, usd = await classify.judge_videos([{"id": k, "text": f"{r['channel_name']} | {r['title']}"} for k, r in ids.items()])
    for k, r in ids.items():
        j = res.get(k)
        if not j:
            continue
        f = {"kind": j["kind"], "game": j["game"], "game_en": j["game_en"], "song": j["song"], "artist": j["artist"],
             "song_type": j.get("song_type"), "hook": j.get("hook"), "classified_at": store.now_iso()}
        if j["kind"] == "game" and (j["game"] or j["game_en"]):
            f["appid"] = await _appid_for(j["game"], j["game_en"])
            if f["appid"]:
                await game_shelf.ensure_game(f["appid"], with_profile=False)
        # 歌ってみた・踊ってみた・Shorts は原曲も探しておく（タップで原曲を流せるように）
        if j["kind"] == "song" and j["song"] and j.get("song_type") in ("cover", "dance", "short", "live"):
            f["orig_video_id"] = await asyncio.to_thread(sources.find_original, j["song"], j["artist"])
        await asyncio.to_thread(store.update_video, r["video_id"], **f)
    print(f"[scene] {label}: new={new} judged={len(res)}/{len(rows)} ${usd:.3f}")


async def refresh_videos() -> None:
    """配信者・VTuber（channels.json）の新着 7 日"""
    await _ingest_videos(await sources.fetch_channel_videos(7), "videos")


SHELF_CHANNELS = [x.strip() for x in (os.getenv("IRINA_PUSH_SHELF_CHANNEL_IDS") or "1426606582606860428").split(",") if x.strip()]


async def refresh_music() -> None:
    """曲置き場に貼られた動画の投稿元チャンネル（＝メンバーが好きな歌い手・アーティスト）の新着 30 日"""
    posted = await asyncio.to_thread(store.posted_video_ids, SHELF_CHANNELS)
    known = await asyncio.to_thread(store.known_video_channels)
    todo = [v for v in posted if v not in known]
    if todo:
        got = await sources.video_channels(todo)
        await asyncio.to_thread(store.save_video_channels, {v: t for v, t in got.items() if t[0]})
        await asyncio.to_thread(store.rebuild_music_channels)
    scene_ids = {c["channel_id"] for c in sources.channels()}
    chans = [{"channel_id": c["channel_id"], "name": c["name"], "group": "曲置き場"}
             for c in await asyncio.to_thread(store.music_channels) if c["channel_id"] not in scene_ids]
    await _ingest_videos(await sources.fetch_channel_videos(30, chans), f"music({len(chans)}ch)")
    # アイコン（曲の行に歌った人の顔を出す）
    have = await asyncio.to_thread(store.channel_images)
    need = [c["channel_id"] for c in chans if c["channel_id"] not in have]
    if need:
        await asyncio.to_thread(store.save_channel_images, await sources.channel_images(need))


async def refresh_jikkyou() -> None:
    """「新作・インディー」の上位で、実況の再生数が古い（無い）ものを測る"""
    if not sources.yt_key():
        return
    fresh = await asyncio.to_thread(_fresh_candidates)
    jk = await asyncio.to_thread(store.jikkyou)
    todo = []
    for c in fresh:
        j = jk.get(c["appid"])
        if j and datetime.now(timezone.utc) - datetime.fromisoformat(j["at"]) < timedelta(hours=JIKKYOU_TTL_H):
            continue
        todo.append(c)
        if len(todo) >= JIKKYOU_PER_RUN:
            break
    for c in todo:
        q = c.get("query") or c["name"]
        r = await sources.jikkyou_views(q)
        if r is not None:
            await asyncio.to_thread(store.save_jikkyou, c["appid"], q, r["views"], r["videos"], r["top_video"], r["top_title"])
    if todo:
        print(f"[scene] jikkyou: measured {len(todo)}")


async def scheduler() -> None:
    await asyncio.sleep(45)
    await asyncio.to_thread(store.init)
    while True:
        for key, hours, fn in (("scene_media_at", 2, refresh_media), ("scene_videos_at", 3, refresh_videos),
                               ("scene_music_at", 6, refresh_music), ("scene_charts_at", 6, refresh_charts),
                               ("scene_jikkyou_at", 6, refresh_jikkyou)):
            try:
                # ゲーム置き場の取り込みスクリプトが動いている間は Steam を二重に叩かない
                if not await asyncio.to_thread(_due, "game_backfill_lock", 1):
                    break
                if await asyncio.to_thread(_due, key, hours):
                    await fn()
                    await asyncio.to_thread(_mark, key)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[scene] {key} failed: {type(e).__name__}: {str(e)[:160]}")
        await asyncio.sleep(900)


# ---------------------------------------------------------------- 組み立て

def _images() -> Dict[str, str]:
    """チャンネル ID → アイコン（界隈の配信者は channels.json、曲置き場の投稿元は DB）"""
    out = store.channel_images()
    for c in sources.channels():
        if c.get("image"):
            out[c["channel_id"]] = c["image"]
    return out


def _gkey(appid: Optional[str], name: Optional[str]) -> str:
    return f"app:{appid}" if appid else "name:" + re.sub(r"[\s\W_]+", "", (name or "").lower())


def _fresh_candidates() -> List[Dict[str, Any]]:
    """新作・インディーの候補（appid ごと）と、そのシグナル。表示にも実況の計測順にも使う"""
    arts = store.recent_articles(14, 2)
    charts = store.latest_charts()
    vids = [v for v in store.videos_since(7, ["game"]) if v.get("appid")]
    jk = store.jikkyou()
    cand: Dict[str, Dict[str, Any]] = {}

    def c(appid: str) -> Dict[str, Any]:
        return cand.setdefault(appid, {"appid": appid, "articles": [], "outlets": set(), "chart": {}, "streamers": set(),
                                       "fit": 0, "hooks": set(), "query": None})
    for a in arts:
        if a.get("appid"):
            e = c(a["appid"])
            e["articles"].append({"src": a["src"], "title": a["title"], "url": a["url"], "at": a["published_at"]})
            e["outlets"].add(a["src"])
            e["fit"] = max(e["fit"], a.get("fit") or 0)
            e["hooks"].add(a.get("hook") or "")
            e["query"] = e["query"] or a.get("game")
    for lst, ranks in charts.items():
        for appid, rank in ranks.items():
            if (lst == "comingsoon" and rank <= 20) or rank <= 30:
                c(appid)["chart"][lst] = rank
    for v in vids:
        c(v["appid"])["streamers"].add(v["channel_name"])
    games = {g["appid"]: g for g in gdb.all_games(cand.keys())}
    out = []
    for appid, e in cand.items():
        g = games.get(appid)
        if not g or not g.get("details_at") or (g.get("type") or "game") != "game" or not _is_fresh(g):
            continue
        prof = gdb.loads(g.get("profile"), {})
        modes = set(prof.get("modes") or [])
        if prof and not modes & {"online_coop", "online_pvp", "local_coop", "local_pvp"} and not e["hooks"] & {"free", "demo"}:
            continue  # ソロ専用は出さない（無料・体験版は別）
        j = jk.get(appid) or {}
        s = 0.9 * len(e["outlets"]) + 0.5 * e["fit"] + 1.0 * len(e["streamers"])
        s += 0.7 * math.log10((j.get("views") or 0) + 1)
        tr = e["chart"].get("topsellers")
        s += 2.0 if tr and tr <= 10 else 1.0 if tr else 0
        s += 1.0 if e["chart"].get("popularnew") else 0
        s += 0.5 if e["chart"].get("comingsoon") else 0
        s += 0.3 * (prof.get("party_fit") or 0)
        s += 0.5 if e["hooks"] & {"free", "demo"} else 0
        out.append({**e, "outlets": sorted(e["outlets"]), "streamers": sorted(e["streamers"]), "hooks": sorted(h for h in e["hooks"] if h),
                    "name": g.get("name") or appid, "query": e["query"] or g.get("name"), "jikkyou": j or None, "score": round(s, 2)})
    out.sort(key=lambda x: -x["score"])
    return out


def _fmt_views(n: int) -> str:
    return f"{n / 10000:.0f}万回" if n >= 10000 else f"{n:,}回"


def build_games(guild_id: str, board: Dict[str, Any]) -> Dict[str, Any]:
    """ゲーム置き場の「界隈で話題」: 配信者がいまやってる / 話題の新作・インディー"""
    shelf_cards = {g["appid"]: g for g in board.get("games") or []}
    seen = store.seen()

    def card(appid: str) -> Optional[Dict[str, Any]]:
        if appid in shelf_cards:
            return shelf_cards[appid]
        g = gdb.get_game(appid)
        if not g or not g.get("details_at"):
            return None
        return game_shelf._card(g, [], {}, None, [], gdb.lowest_price(appid))

    # 配信者がいまやってる（7 日）
    imgs = _images()
    groups: Dict[str, Dict[str, Any]] = {}
    for v in store.videos_since(7, ["game"]):
        name = v.get("game") or v.get("game_en")
        if not name:
            continue
        k = _gkey(v.get("appid"), v.get("game_en") or name)
        e = groups.setdefault(k, {"key": k, "name": name, "appid": v.get("appid"), "channels": {}, "videos": 0, "views": 0, "top": None})
        e["videos"] += 1
        e["views"] += v.get("views") or 0
        e["channels"].setdefault(v["channel_name"], (v["channel_group"], imgs.get(v["channel_id"])))
        if not e["top"] or (v.get("views") or 0) > (e["top"].get("views") or 0):
            e["top"] = {"video_id": v["video_id"], "title": v["title"], "thumb": v.get("thumb"), "channel": v["channel_name"],
                        "views": v.get("views") or 0}
    streamers = sorted(groups.values(), key=lambda e: (-len(e["channels"]), -e["views"]))[:12]
    playing_out = []
    for e in streamers:
        cd = card(e["appid"]) if e["appid"] else None
        store.mark_seen(e["key"], "streamer_game", e["name"], e["appid"])
        playing_out.append({
            # 名前は配信での呼び方（Steam の日本語名「エーペックスレジェンズ」ではなく「Apex Legends」）
            "key": e["key"], "name": e["name"], "appid": e["appid"], "card": cd,
            "image": (cd or {}).get("image") or (e["top"] or {}).get("thumb"),
            "channels": [{"name": n, "group": gr, "image": im} for n, (gr, im) in e["channels"].items()],
            "videos": e["videos"], "views": e["views"], "top": e["top"],
            "on_shelf": bool(e["appid"] and e["appid"] in shelf_cards and shelf_cards[e["appid"]]["posted"]["count"]),
        })

    # 話題の新作・インディー
    fresh_out = []
    for e in _fresh_candidates()[:16]:
        cd = card(e["appid"])
        if not cd:
            continue
        badges = []
        j = e.get("jikkyou") or {}
        if (j.get("views") or 0) >= 1000:
            badges.append(f"実況 {_fmt_views(j['views'])}/2週")
        if e["streamers"]:
            badges.append(f"配信者 {len(e['streamers'])}人")
        tr = e["chart"].get("topsellers")
        if tr:
            badges.append(f"Steam 売上 {tr}位")
        elif e["chart"].get("popularnew"):
            badges.append("Steam 人気の新作")
        elif e["chart"].get("comingsoon"):
            badges.append("Steam 注目の近日発売")
        if len(e["outlets"]) >= 2:
            badges.append(f"{len(e['outlets'])}メディアが紹介")
        elif e["outlets"]:
            badges.append(e["outlets"][0])
        if "demo" in e["hooks"]:
            badges.append("体験版")
        if "free" in e["hooks"]:
            badges.append("無料")
        k = _gkey(e["appid"], None)
        store.mark_seen(k, "fresh", cd["name"], e["appid"])
        on_shelf = bool(cd["posted"]["count"])
        first = (seen.get(k) or {}).get("first_seen_at")
        fresh_out.append({
            "key": k, "appid": e["appid"], "card": cd, "badges": badges, "score": e["score"],
            "articles": e["articles"][:3], "streamers": e["streamers"], "jikkyou": e.get("jikkyou"),
            "on_shelf": on_shelf,
            # 界隈で先に見つけて、あとから誰かが貼った
            "found_first": bool(on_shelf and first and cd["posted"]["at"] and first < cd["posted"]["at"]),
        })
    return {"streamers": playing_out, "fresh": fresh_out, "updated_at": gdb.kv_get("scene_videos_at")}


def _person(name: str) -> str:
    n = re.sub(r"\s*-\s*topic$", "", (name or "").strip(), flags=re.I)
    n = re.split(r"\s*[/／|｜【(（]\s*", n)[0]
    return re.sub(r"[\s\W_]+", "", n.lower())


def build_songs() -> Dict[str, Any]:
    """曲置き場の「界隈の新曲」: 曲置き場に貼られたことのある歌い手・アーティストと、配信者・VTuber の
    新曲・MV・歌ってみた・踊ってみた（30 日）。何人もやっている曲（流行り）を上に"""
    posts = {c["channel_id"]: c["posts"] for c in store.music_channels()}
    imgs = _images()
    groups: Dict[str, Dict[str, Any]] = {}
    for v in store.videos_since(30, ["song"]):
        if v.get("song_type") == "other" or (v.get("song_type") == "live" and not v.get("song")):
            continue  # 曲名の無いライブ映像・歌枠は流せないので出さない
        song = v.get("song")
        k = re.sub(r"[\s\W_]+", "", (song or v["title"]).lower())
        e = groups.setdefault(k, {"key": k, "song": song, "artist": v.get("artist"), "orig_video_id": v.get("orig_video_id"),
                                  "videos": [], "channels": set(), "views": 0, "latest": v["published_at"], "posted_affinity": 0})
        e["videos"].append({"video_id": v["video_id"], "title": v["title"], "thumb": v.get("thumb"), "channel": v["channel_name"],
                            "channel_image": imgs.get(v["channel_id"]),
                            "group": v["channel_group"], "views": v.get("views") or 0, "at": v["published_at"],
                            "type": v.get("song_type"), "hook": v.get("hook")})
        e["channels"].add(v["channel_name"])
        # 「何人がやってるか」は人で数える（本人の公式と「- Topic」の自動チャンネルを 2 人にしない）
        # 原曲側（新曲・MV・公式の切り抜き）は何本あっても 1 人。原曲を出したチャンネルのショート等は数えない
        if v.get("song_type") in ("cover", "dance", "short", "live"):
            e.setdefault("performers", set()).add(_person(v["channel_name"]))
        else:
            e.setdefault("originals", set()).add(_person(v["channel_name"]))
        e["views"] += v.get("views") or 0
        e["latest"] = max(e["latest"], v["published_at"])
        e["orig_video_id"] = e["orig_video_id"] or v.get("orig_video_id")
        e["posted_affinity"] = max(e["posted_affinity"], posts.get(v["channel_id"], 0))
    out = []
    now = datetime.now(timezone.utc)
    for e in groups.values():
        # Shorts は後ろ、フル尺（MV・歌ってみた）を代表に
        e["videos"].sort(key=lambda x: (x["type"] == "short" or "#shorts" in x["title"].lower(), -x["views"]))
        age_days = (now - datetime.fromisoformat(e["latest"])).total_seconds() / 86400
        origs = e.pop("originals", set())
        people = len(e.pop("performers", set()) - origs) + (1 if origs else 0)
        score = 2.0 * (people - 1) + 0.8 * math.log10(e["views"] + 1) + 0.8 * e["posted_affinity"] - 0.08 * age_days
        top = e["videos"][0]
        out.append({**e, "people": people, "channels": sorted(e["channels"]), "score": round(score, 2), "hook": top.get("hook"),
                    "play_video_id": e["orig_video_id"] if top["type"] in ("short", "dance") and e["orig_video_id"] else top["video_id"]})
    out.sort(key=lambda e: -e["score"])
    return {"songs": out[:30], "updated_at": gdb.kv_get("scene_music_at") or gdb.kv_get("scene_videos_at")}
