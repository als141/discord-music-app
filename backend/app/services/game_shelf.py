"""ゲーム置き場（voice プロセスで集めて、web プロセスが board を返す）。

集めるもの（どれも Discord には一切書き込まない）
- #ゲーム置き場（`IRINA_GAME_CHANNEL_IDS`）に貼られた Steam / X / Epic のリンク。X は記事本文から Steam のゲームを特定
- ゲームの情報: Steam（価格・セール・発売・評価・同時接続数）+ Claude Sonnet 5.5 の「何人で・どう遊ぶか」
- いま: VC にいる人（voice_presence）と、Discord の「プレイ中」（プレゼンス）→ 遊んだ記録（game_sessions）
- 期限つき: Epic の無料配布、置き場のゲームのセール開始・無料化（game_deal_events）

通知（どちらも既定オフ、本人がオンにしたときだけ）
- game_gather: VC の人数が本人の決めた人数（2〜8）に届いたら（本人が VC にいないとき、3 時間に 1 回まで）
- game_deals: 毎日 19 時に、その日のセール開始・無料配布をまとめて 1 通（やりたいを付けたゲームを先頭に）
"""
import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from .. import db
from . import game_db as gdb
from . import game_sources as src

JST = timezone(timedelta(hours=9))
DODEKA = "1093915551174234212"


def _ids(env: str, default: str) -> Set[str]:
    return {x.strip() for x in (os.getenv(env) or default).split(",") if x.strip()}


def game_guild_ids() -> Set[str]:
    return _ids("IRINA_GAME_GUILD_IDS", DODEKA)


def game_channel_ids() -> Set[str]:
    return _ids("IRINA_GAME_CHANNEL_IDS", "1381958352267116574")


def yen(v: Optional[int]) -> Optional[int]:
    return None if v is None else int(v) // 100


def _avatar(user) -> str:
    try:
        return str(user.display_avatar.url)
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# 1. 投稿を集める
# ---------------------------------------------------------------------------

async def collect(message) -> int:
    """on_message から。#ゲーム置き場のリンクを控える（何も送らない）"""
    try:
        if message.guild is None or message.author.bot:
            return 0
        gid, cid = str(message.guild.id), str(message.channel.id)
        if gid not in game_guild_ids() or cid not in game_channel_ids():
            return 0
        links = src.classify_links(message.content or "")
        if not links:
            return 0
        name = getattr(message.author, "display_name", None) or message.author.name
        saved = 0
        for l in links:
            ok = await asyncio.to_thread(
                gdb.add_post, guild_id=gid, channel_id=cid, message_id=str(message.id), kind=l["kind"], url=l["url"],
                ref=l["ref"], posted_by_id=str(message.author.id), posted_by_name=name,
                posted_by_image=_avatar(message.author),
                posted_at=message.created_at.astimezone(timezone.utc).isoformat())
            saved += 1 if ok else 0
        await asyncio.to_thread(gdb.upsert_member, gid, str(message.author.id), name, _avatar(message.author))
        if saved:
            print(f"[game] {saved} link(s) from #{getattr(message.channel, 'name', cid)}")
            asyncio.create_task(resolve_pending())
        return saved
    except Exception as e:
        print(f"[game] collect failed: {type(e).__name__}: {e}")
        return 0


# ---------------------------------------------------------------------------
# 2. ゲームの情報を揃える
# ---------------------------------------------------------------------------

_resolve_lock: Optional[asyncio.Lock] = None


async def ensure_game(appid: str, news: Optional[List[str]] = None, *, with_profile: bool = True) -> Optional[str]:
    """Steam の情報と「何人で遊ぶか」を揃える。体験版は本編の appid を返す（本編が無ければそのまま）"""
    g = await asyncio.to_thread(gdb.get_game, appid)
    if not g or not g.get("details_at"):
        d = await src.steam_details(appid)
        if not d:
            await asyncio.to_thread(gdb.upsert_game, appid, fail_count=((g or {}).get("fail_count") or 0) + 1,
                                    details_at=None)
            return None
        summ = src.summarize_details(d)
        rev = await src.steam_reviews(appid)
        await asyncio.to_thread(gdb.upsert_game, appid, **summ, details_at=gdb.now_iso(), price_at=gdb.now_iso(),
                                review_desc=(rev or {}).get("desc"), review_total=(rev or {}).get("total"),
                                review_pct=(rev or {}).get("pct"))
        await asyncio.to_thread(gdb.record_price, appid, summ.get("price_final"), summ.get("discount_percent") or 0)
        if summ.get("type") == "demo" and summ.get("fullgame_appid"):
            full = await ensure_game(summ["fullgame_appid"], news, with_profile=with_profile)
            return full or appid
        g = await asyncio.to_thread(gdb.get_game, appid)
        details = d
    else:
        if g.get("type") == "demo" and g.get("fullgame_appid"):
            full = await ensure_game(g["fullgame_appid"], news, with_profile=with_profile)
            return full or appid
        details = None
    if with_profile and not g.get("profile") and src.claude_enabled():
        if details is None:
            details = await src.steam_details(appid)
        if details:
            try:
                news = news if news is not None else await asyncio.to_thread(gdb.news_for_app, appid)
                prof = await src.claude_profile(details, news or [])
                if prof:
                    await asyncio.to_thread(gdb.upsert_game, appid, profile=json.dumps(prof, ensure_ascii=False),
                                            profile_at=gdb.now_iso())
                    print(f"[game] profile {g.get('name') or appid}: max={prof.get('max_players_online')} "
                          f"fit={prof.get('party_fit')} ${prof.get('usd')}")
            except Exception as e:
                print(f"[game] profile failed {appid}: {type(e).__name__}: {str(e)[:120]}")
    return appid


async def _resolve_x(post: Dict[str, Any]) -> Optional[str]:
    text = post.get("x_text")
    if not text:
        text = await src.x_post_text(post["ref"])
        if text:
            await asyncio.to_thread(gdb.update_post, post["id"], x_text=text)
    if not text:
        return None
    m = src.STEAM_APP_RE.search(text)
    if m:
        return m.group(1)
    for title in src.titles_in(text)[:2]:
        a = await src.steam_find_exact(title)
        if a:
            return a
    title = await src.claude_title_from_news(text)
    return await src.steam_find_exact(title) if title else None


async def resolve_pending(limit: int = 30) -> int:
    global _resolve_lock
    if _resolve_lock is None:
        _resolve_lock = asyncio.Lock()
    if _resolve_lock.locked():
        return 0
    async with _resolve_lock:
        done = 0
        for p in await asyncio.to_thread(gdb.pending_posts, limit):
            try:
                appid = p.get("appid") if p["kind"] == "steam" else await _resolve_x(p)
                final = await ensure_game(appid) if appid else None
                await asyncio.to_thread(gdb.update_post, p["id"], appid=final or appid, resolved=1 if (final or p["tries"] >= 2) else 0,
                                        tries=p["tries"] + 1)
                done += 1
            except Exception as e:
                await asyncio.to_thread(gdb.update_post, p["id"], tries=p["tries"] + 1)
                print(f"[game] resolve failed {p['url'][:60]}: {type(e).__name__}: {str(e)[:100]}")
        return done


# ---------------------------------------------------------------------------
# 3. 定期更新（価格・無料配布・同時接続数）と通知のまとめ
# ---------------------------------------------------------------------------

def _shelf_appids(guild_id: str) -> List[str]:
    ids = {p["appid"] for p in gdb.posts_for_guild(guild_id) if p.get("appid")}
    ids |= {r["appid"] for r in gdb.recent_play(guild_id, 60) if r.get("appid")}
    return sorted(ids)


async def refresh_prices() -> int:
    appids: Set[str] = set()
    for gid in game_guild_ids():
        appids |= set(await asyncio.to_thread(_shelf_appids, gid))
    games = {g["appid"]: g for g in await asyncio.to_thread(gdb.all_games, appids)}
    targets = [a for a, g in games.items() if g.get("details_at") and g.get("type") != "demo"]
    prices = await src.steam_prices(targets)
    changed = 0
    for a, po in prices.items():
        g = games[a]
        if po is None and not g.get("is_free") and g.get("coming_soon"):
            continue  # 発売前
        final = po.get("final") if po else (0 if g.get("is_free") else g.get("price_final"))
        disc = int((po or {}).get("discount_percent") or 0)
        prev = await asyncio.to_thread(gdb.record_price, a, final, disc)
        await asyncio.to_thread(gdb.upsert_game, a, price_initial=(po or {}).get("initial", g.get("price_initial")),
                                price_final=final, discount_percent=disc, price_at=gdb.now_iso())
        if prev is not None:
            pdisc, pfinal = prev
            if final == 0 and disc >= 100 and pfinal:
                await asyncio.to_thread(gdb.add_deal_event, kind="free", appid=a, discount=disc, price_final=final)
                changed += 1
            elif disc >= 20 and disc >= (pdisc or 0) + 20:
                await asyncio.to_thread(gdb.add_deal_event, kind="sale", appid=a, discount=disc, price_final=final)
                changed += 1
    print(f"[game] prices refreshed: {len(prices)} games, {changed} new deal(s)")
    return changed


async def refresh_offers() -> int:
    new = 0
    offers = await src.epic_free_offers() + await src.gamerpower_steam_offers()
    for o in offers:
        if not o.get("appid"):
            # Epic のタイトルが Steam にもあれば、人数などの情報を借りる
            o["appid"] = await src.steam_find_exact(o["title"])
            if o["appid"]:
                await ensure_game(o["appid"])
        if await asyncio.to_thread(gdb.upsert_offer, o) and o.get("active"):
            await asyncio.to_thread(gdb.add_deal_event, kind="epic_free", offer_id=o["id"], appid=o.get("appid"))
            new += 1
    print(f"[game] offers refreshed: {len(offers)} offer(s), {new} new")
    return new


async def link_steam(user_id: str, profile: str) -> Dict[str, Any]:
    """本人が入力した Steam のプロフィールを連携する。所持ゲーム・ウィッシュリストを取り込む"""
    steamid = await src.steam_resolve_profile(profile)
    if not steamid:
        return {"ok": False, "error": "Steam のプロフィールが見つかりませんでした"}
    player = await src.steam_player(steamid) or {}
    owned = await src.steam_owned_games(steamid)
    wish = await src.steam_wishlist(steamid)
    await asyncio.to_thread(gdb.save_steam_link, user_id, steamid, player.get("name"), player.get("avatar"),
                            bool(player.get("public")), owned, wish)
    return {"ok": True, "steamid": steamid, "name": player.get("name"), "avatar": player.get("avatar"),
            "games": len(owned) if owned is not None else None, "wishlist": len(wish) if wish is not None else None,
            "private": owned is None}


async def sync_steam_links() -> None:
    for l in await asyncio.to_thread(gdb.steam_links_all):
        try:
            player = await src.steam_player(l["steamid"]) or {}
            owned = await src.steam_owned_games(l["steamid"])
            wish = await src.steam_wishlist(l["steamid"])
            await asyncio.to_thread(gdb.save_steam_link, l["user_id"], l["steamid"], player.get("name"),
                                    player.get("avatar"), bool(player.get("public")), owned, wish)
        except Exception as e:
            print(f"[game] steam sync failed: {type(e).__name__}: {str(e)[:100]}")
        await asyncio.sleep(1)


async def refresh_players() -> None:
    appids: Set[str] = set()
    for gid in game_guild_ids():
        appids |= set(await asyncio.to_thread(_shelf_appids, gid))
    for g in await asyncio.to_thread(gdb.all_games, appids):
        prof = gdb.loads(g.get("profile"), {})
        if g.get("coming_soon") or not set(prof.get("modes") or []) & {"online_coop", "online_pvp", "mmo"}:
            continue
        n = await src.steam_current_players(g["appid"])
        if n is not None:
            await asyncio.to_thread(gdb.upsert_game, g["appid"], current_players=n, players_at=gdb.now_iso())
        await asyncio.sleep(0.3)


def _due(key: str, hours: float) -> bool:
    v = gdb.kv_get(key)
    if not v:
        return True
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(v) > timedelta(hours=hours)
    except ValueError:
        return True


async def scheduler() -> None:
    """voice プロセスの on_ready から 1 回だけ起動"""
    await asyncio.sleep(60)
    while True:
        try:
            # 取り込みスクリプト（scripts/backfill_game_shelf.py）が動いている間は Steam を二重に叩かない
            if not await asyncio.to_thread(_due, "game_backfill_lock", 1):
                await asyncio.sleep(300)
                continue
            await resolve_pending(40)
            if await asyncio.to_thread(_due, "game_prices_at", 6):
                await refresh_prices()
                await asyncio.to_thread(gdb.kv_set, "game_prices_at", gdb.now_iso())
            if await asyncio.to_thread(_due, "game_offers_at", 6):
                await refresh_offers()
                await asyncio.to_thread(gdb.kv_set, "game_offers_at", gdb.now_iso())
            if src.steam_key() and await asyncio.to_thread(_due, "game_steam_sync_at", 24):
                await sync_steam_links()
                await asyncio.to_thread(gdb.kv_set, "game_steam_sync_at", gdb.now_iso())
            if await asyncio.to_thread(_due, "game_players_at", 12):
                await refresh_players()
                await asyncio.to_thread(gdb.kv_set, "game_players_at", gdb.now_iso())
            now = datetime.now(JST)
            today = now.strftime("%Y-%m-%d")
            if now.hour >= 19 and gdb.kv_get("game_deals_digest_day") != today:
                await asyncio.to_thread(gdb.kv_set, "game_deals_digest_day", today)
                await send_deals_digest()
            await asyncio.to_thread(gdb.prune_sessions, 60)
            # 「自分のプレイ中を出す」をオフにした人の記録は残さない（設定の反映待ちの間に入った分も）
            await asyncio.to_thread(gdb.delete_sessions_for, hidden_users())
        except Exception as e:
            print(f"[game] scheduler error: {type(e).__name__}: {str(e)[:160]}")
        await asyncio.sleep(600)


# ---------------------------------------------------------------------------
# 4. いま（プレゼンスと VC）
# ---------------------------------------------------------------------------

_current: Dict[Tuple[str, str], str] = {}
_prefs_cache: Dict[str, Any] = {"at": 0.0, "data": {}}


def _prefs() -> Dict[str, Dict[str, Any]]:
    import time
    if time.monotonic() - _prefs_cache["at"] > 30:
        _prefs_cache["data"] = db.get_all_notif_prefs()
        _prefs_cache["at"] = time.monotonic()
    return _prefs_cache["data"]


def hidden_users() -> Set[str]:
    return {u for u, p in _prefs().items() if not p.get("show_playing", True)}


def _playing(member) -> Optional[Tuple[str, Optional[str]]]:
    import discord
    for a in getattr(member, "activities", None) or ():
        if getattr(a, "type", None) == discord.ActivityType.playing and getattr(a, "name", None):
            app_id = getattr(a, "application_id", None)
            return a.name, (str(app_id) if app_id else None)
    return None


async def _map_name(name: str) -> Optional[str]:
    known, appid = await asyncio.to_thread(gdb.get_name_map, name)
    if known:
        return appid
    appid = await src.steam_find_exact(name)
    await asyncio.to_thread(gdb.set_name_map, name, appid)
    if appid:
        await asyncio.to_thread(gdb.set_session_appid, name, appid)
        asyncio.create_task(ensure_game(appid))
    return appid


async def on_presence(member) -> None:
    try:
        if member.bot or str(member.guild.id) not in game_guild_ids():
            return
        gid, uid = str(member.guild.id), str(member.id)
        key = (gid, uid)
        playing = _playing(member) if uid not in hidden_users() else None
        prev = _current.get(key)
        if playing and playing[0] == prev:
            return
        if prev and not playing:
            _current.pop(key, None)
            await asyncio.to_thread(gdb.end_session, gid, uid)
            return
        if playing:
            _current[key] = playing[0]
            known, appid = await asyncio.to_thread(gdb.get_name_map, playing[0])
            await asyncio.to_thread(gdb.open_session, gid, uid, playing[0], playing[1], appid if known else None)
            await asyncio.to_thread(gdb.upsert_member, gid, uid, member.display_name, _avatar(member))
            if not known:
                await _map_name(playing[0])
    except Exception as e:
        print(f"[game] presence failed: {type(e).__name__}: {str(e)[:120]}")


_vc_count: Dict[str, int] = {}


def _vc_rows(guild) -> List[Dict[str, Any]]:
    rows = []
    afk = getattr(guild, "afk_channel", None)
    for ch in list(getattr(guild, "voice_channels", [])) + list(getattr(guild, "stage_channels", [])):
        if afk is not None and ch.id == afk.id:
            continue
        for m in ch.members:
            if m.bot:
                continue
            rows.append({"user_id": str(m.id), "user_name": m.display_name, "user_image": _avatar(m),
                         "channel_id": str(ch.id), "channel_name": ch.name})
    return rows


async def seed(client) -> None:
    """on_ready: 今の VC とプレイ中を取り込む（通知はしない）"""
    try:
        await asyncio.to_thread(gdb.close_open_sessions)
        _current.clear()
        for gid in game_guild_ids():
            guild = client.get_guild(int(gid))
            if not guild:
                continue
            rows = _vc_rows(guild)
            await asyncio.to_thread(gdb.replace_voice_presence, gid, rows)
            _vc_count[gid] = len(rows)
            for m in guild.members:
                if not m.bot and _playing(m):
                    await on_presence(m)
        print(f"[game] seeded: vc={_vc_count} playing={len(_current)}")
    except Exception as e:
        print(f"[game] seed failed: {type(e).__name__}: {str(e)[:120]}")


async def on_voice_change(guild) -> None:
    try:
        gid = str(guild.id)
        if gid not in game_guild_ids():
            return
        rows = _vc_rows(guild)
        await asyncio.to_thread(gdb.replace_voice_presence, gid, rows)
        for r in rows:
            await asyncio.to_thread(gdb.upsert_member, gid, r["user_id"], r["user_name"], r["user_image"])
        prev = _vc_count.get(gid, len(rows))
        _vc_count[gid] = len(rows)
        if len(rows) > prev:
            await _notify_gather(gid, prev, rows)
    except Exception as e:
        print(f"[game] voice change failed: {type(e).__name__}: {str(e)[:120]}")


GATHER_MIN_INTERVAL_SEC = 3 * 3600


async def _notify_gather(gid: str, prev: int, rows: List[Dict[str, Any]]) -> None:
    from . import push
    if not push.configured():
        return
    count = len(rows)
    in_vc = {r["user_id"] for r in rows}
    prefs = await asyncio.to_thread(db.get_all_notif_prefs)
    wanted = {u for u, p in prefs.items() if p.get("game_gather") and prev < int(p.get("gather_min") or 3) <= count
              and u not in in_vc}
    if not wanted:
        return
    users = [u for u in wanted if await asyncio.to_thread(db.throttle_ok, u, "game_gather", GATHER_MIN_INTERVAL_SEC)]
    devices = [d for d in await asyncio.to_thread(db.list_push_devices, users)] if users else []
    if not devices:
        return
    playing: Dict[str, int] = {}
    hidden = hidden_users()
    for s in await asyncio.to_thread(gdb.open_sessions, gid):
        if s["user_id"] in in_vc and s["user_id"] not in hidden:
            playing[s["game_name"]] = playing.get(s["game_name"], 0) + 1
    channels = sorted({r["channel_name"] for r in rows if r.get("channel_name")})
    body = f"{'・'.join(channels)} に {count} 人"
    if playing:
        top = sorted(playing.items(), key=lambda x: -x[1])[0]
        body += f"（{top[0]} を {top[1]} 人がプレイ中）"
    res = await push.send_logged(kind="game_gather", title=f"VC に {count} 人そろいました", body=body,
                                 url="/?tab=games", devices=devices, ttl=1800, urgency="high",
                                 topic="irina-gather", tag="irina-gather")
    if res["sent"]:
        await asyncio.to_thread(db.throttle_mark, sorted({d["user_id"] for d in devices}), "game_gather")


async def send_deals_digest() -> None:
    from . import push
    if not push.configured():
        return
    since = gdb.kv_get("game_deals_digest_at") or (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    events = await asyncio.to_thread(gdb.deal_events_since, since)
    await asyncio.to_thread(gdb.kv_set, "game_deals_digest_at", gdb.now_iso())
    if not events:
        return
    prefs = await asyncio.to_thread(db.get_all_notif_prefs)
    subs = [u for u, p in prefs.items() if p.get("game_deals")]
    if not subs:
        return
    games = {g["appid"]: g for g in await asyncio.to_thread(gdb.all_games, {e["appid"] for e in events if e.get("appid")})}

    def line(e) -> Optional[str]:
        g = games.get(e.get("appid") or "")
        if e["kind"] == "epic_free":
            o = gdb.get_offer(e["offer_id"]) or {}
            end = o.get("ends_at")
            until = f"（{datetime.fromisoformat(end.replace('Z', '+00:00')).astimezone(JST):%-m/%-d}まで）" if end else ""
            return f"Epic で {o.get('title') or (g or {}).get('name')} が無料{until}"
        if not g:
            return None
        if e["kind"] == "free":
            return f"{g['name']} が無料"
        return f"{g['name']} {e.get('discount_percent')}%オフ ¥{yen(e.get('price_final')):,}"

    for gid in game_guild_ids():
        mk = await asyncio.to_thread(gdb.marks, gid)
        for uid in subs:
            if not await asyncio.to_thread(db.throttle_ok, uid, "game_deals", 20 * 3600):
                continue
            devices = await asyncio.to_thread(db.list_push_devices, [uid])
            if not devices:
                continue
            want = {a for a, m in mk.items() if uid in m.get("want", [])}
            ordered = sorted(events, key=lambda e: (0 if e.get("appid") in want else 1, e["at"]))
            lines = [l for l in (line(e) for e in ordered) if l]
            if not lines:
                continue
            body = " ／ ".join(lines[:3]) + (f" ほか{len(lines) - 3}件" if len(lines) > 3 else "")
            res = await push.send_logged(kind="game_deals", title="ゲーム置き場: セール・無料配布", body=body,
                                         url="/?tab=games", devices=devices, ttl=24 * 3600)
            if res["sent"]:
                await asyncio.to_thread(db.throttle_mark, [uid], "game_deals")
        break


# ---------------------------------------------------------------------------
# 5. board（web プロセスの API が返す）
# ---------------------------------------------------------------------------

_JP_DATE = re.compile(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日")


def _release_date(text: str) -> Optional[datetime]:
    m = _JP_DATE.search(text or "")
    if not m:
        return None
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=JST)
    except ValueError:
        return None


def _card(g: Dict[str, Any], posts: List[Dict[str, Any]], mk: Dict[str, List[str]], played: Optional[Dict[str, Any]],
          playing_now: List[str], lowest: Optional[int]) -> Dict[str, Any]:
    prof = gdb.loads(g.get("profile"), {})
    first = posts[0] if posts else None
    return {
        "appid": g["appid"],
        "name": g.get("name") or "",
        "image": g.get("header_image"),
        "hook": prof.get("hook_ja") or g.get("short_desc") or "",
        "players": {"min": prof.get("min_players"), "max": prof.get("max_players_online"), "best": prof.get("best_with")},
        "modes": prof.get("modes") or [],
        "vibe": prof.get("vibe") or [],
        "fit": prof.get("party_fit"),
        "price": {"final": yen(g.get("price_final")), "initial": yen(g.get("price_initial")),
                  "discount": g.get("discount_percent") or 0, "free": bool(g.get("is_free")), "lowest": yen(lowest)},
        "release": {"text": g.get("release_text") or "", "soon": bool(g.get("coming_soon"))},
        "review": {"desc": g.get("review_desc"), "pct": g.get("review_pct"), "total": g.get("review_total")},
        "live_players": g.get("current_players"),
        "posted": {"by": first.get("posted_by_id") if first else None, "at": first.get("posted_at") if first else None,
                   "count": len(posts), "last_at": posts[-1].get("posted_at") if posts else None},
        "want": mk.get("want", []), "own": mk.get("own", []),
        "played": (played or {}).get("users", []), "last_played_at": (played or {}).get("last_at"),
        "playing_now": playing_now,
        "news": [(p.get("x_text") or "")[:140] for p in reversed(posts) if p.get("x_text")][:2],
        "store_url": f"https://store.steampowered.com/app/{g['appid']}/",
    }


_BEST_RANGE = re.compile(r"(\d+)\s*(?:人)?\s*(?:[〜~\-–ー]\s*(\d+))?")


def _score(c: Dict[str, Any], n: int, present: Set[str]) -> Tuple[float, List[str]]:
    reasons: List[str] = []
    p = c["players"]
    s = float(c.get("fit") or 2) * 2
    mx, mn = p.get("max"), p.get("min") or 1
    if mx:
        reasons.append(f"最大{mx}人" if mx < 16 else f"{mx}人まで")
    modes = set(c.get("modes") or [])
    reasons.append("協力" if "online_coop" in modes else "対戦" if "online_pvp" in modes else "")
    owners = (set(c["own"]) | set(c["played"])) & present if present else set(c["own"]) | set(c["played"])
    if owners:
        s += 1.5 + 0.3 * len(owners)
        reasons.append(f"{len(owners)}人が持ってる/遊んだ" if present else "誰かが遊んだ")
    if c["want"]:
        s += 0.5 * len(c["want"])
        reasons.append(f"やりたい{len(c['want'])}")
    pr = c["price"]
    if pr["free"] or pr["final"] == 0:
        s += 1.5
        reasons.append("無料")
    elif pr["discount"] >= 50:
        s += 1.0
        reasons.append(f"{pr['discount']}%オフ ¥{pr['final']:,}")
    elif pr["final"] is not None:
        reasons.append(f"¥{pr['final']:,}")
        if pr["final"] > 3000 and not owners:
            s -= 0.5
    if (c["review"].get("pct") or 0) >= 85 and (c["review"].get("total") or 0) >= 200:
        s += 0.5
    if c["last_played_at"]:
        s += 0.5
    # いちばん楽しい人数（Claude の best_with「2〜4人」など）に今夜の人数が入っているか
    # 先頭の「5〜8人」だけを読む（「5〜8人(5v5や3v3で…)」の括弧の中の数字は拾わない）
    m = _BEST_RANGE.search(p.get("best") or "")
    if m:
        lo = int(m.group(1))
        hi = int(m.group(2) or m.group(1))
        if lo <= n <= hi:
            s += 1.0
        elif n < lo:
            s -= 1.0 * min(lo - n, 3)
    # 同点のときは、評価が高い・最近置かれたものを上に
    s += (c["review"].get("pct") or 0) / 1000
    if c["posted"].get("last_at"):
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(c["posted"]["last_at"])).days
            s += max(0.0, 0.3 - age / 300)
        except ValueError:
            pass
    return s, [r for r in reasons if r]


def build_board(guild_id: str, players: Optional[int] = None) -> Dict[str, Any]:
    hidden = hidden_users()
    voice = [v for v in gdb.voice_presence(guild_id)]
    sessions = [s for s in gdb.open_sessions(guild_id) if s["user_id"] not in hidden]
    recent = [r for r in gdb.recent_play(guild_id, 30)]
    for r in recent:
        r["users"] = [u for u in r["users"] if u not in hidden]
    recent = [r for r in recent if r["users"]]
    posts = gdb.posts_for_guild(guild_id)
    by_app: Dict[str, List[Dict[str, Any]]] = {}
    for p in posts:
        if p.get("appid"):
            by_app.setdefault(p["appid"], []).append(p)
    played_by_app = {r["appid"]: r for r in recent if r.get("appid")}
    playing_by_app: Dict[str, List[str]] = {}
    for s in sessions:
        if s.get("appid"):
            playing_by_app.setdefault(s["appid"], []).append(s["user_id"])
    offers = gdb.current_offers()
    appids = set(by_app) | set(played_by_app) | set(playing_by_app) | {o["appid"] for o in offers if o.get("appid")}
    games = {g["appid"]: g for g in gdb.all_games(appids) if g.get("details_at") and g.get("type") != "demo"}
    mk = gdb.marks(guild_id)
    # Steam を連携した人の所持・ウィッシュリスト・2 週間以内のプレイを、やりたい/持ってる/遊んだ に足す
    steam = gdb.steam_ownership(games.keys())
    for a, st in steam.items():
        e = mk.setdefault(a, {"want": [], "own": []})
        e["own"] = sorted(set(e.get("own", [])) | set(st["own"]))
        e["want"] = sorted((set(e.get("want", [])) | set(st["want"])) - set(e["own"]))
        if st["recent"]:
            r = played_by_app.setdefault(a, {"users": [], "last_at": None})
            r["users"] = sorted(set(r.get("users") or []) | (set(st["recent"]) - hidden))
    cards = {a: _card(g, by_app.get(a, []), mk.get(a, {}), played_by_app.get(a), playing_by_app.get(a, []),
                      gdb.lowest_price(a)) for a, g in games.items()}

    # 今夜どれ
    in_vc = {v["user_id"] for v in voice}
    n = players or (len(in_vc) if len(in_vc) >= 2 else 4)
    present = in_vc if (players is None or players == len(in_vc)) and len(in_vc) >= 2 else set()
    picks = []
    for c in cards.values():
        p = c["players"]
        if c["release"]["soon"] or not p.get("max") or p["max"] < n or (p.get("min") or 1) > n:
            continue
        if not set(c["modes"]) & {"online_coop", "online_pvp", "mmo"}:
            continue
        sc, why = _score(c, n, present)
        picks.append({"appid": c["appid"], "score": round(sc, 2), "why": why})
    picks.sort(key=lambda x: -x["score"])

    # 期限つき（無料配布・セール・発売）
    now = datetime.now(JST)
    sales = sorted([c for c in cards.values() if c["price"]["discount"] >= 20 and c["posted"]["count"]],
                   key=lambda c: -c["price"]["discount"])[:12]
    releases = []
    for c in cards.values():
        d = _release_date(c["release"]["text"])
        if d and c["posted"]["count"] and timedelta(days=-14) <= d - now <= timedelta(days=21):
            releases.append({"appid": c["appid"], "date": d.strftime("%Y-%m-%d"), "released": d <= now})
    releases.sort(key=lambda r: r["date"])

    # いま
    playing: Dict[str, Dict[str, Any]] = {}
    for s in sessions:
        k = s.get("appid") or f"name:{s['game_name']}"
        g = playing.setdefault(k, {"game_name": s["game_name"], "appid": s.get("appid"), "users": [], "since": s["started_at"]})
        g["users"].append(s["user_id"])
        g["since"] = min(g["since"], s["started_at"])

    mem = gdb.members(guild_id)
    for p in posts:
        if p.get("posted_by_id") and p["posted_by_id"] not in mem:
            mem[p["posted_by_id"]] = {"name": p.get("posted_by_name"), "image": p.get("posted_by_image")}
    for v in voice:
        mem.setdefault(v["user_id"], {"name": v.get("user_name"), "image": v.get("user_image")})

    news = [{"url": p["url"], "text": (p.get("x_text") or "")[:200], "posted_by": p.get("posted_by_id"),
             "posted_at": p["posted_at"]} for p in posts if p["kind"] == "x" and not p.get("appid") and p.get("x_text")][-20:]
    return {
        "guild_id": guild_id,
        "now": {"voice": [{"user_id": v["user_id"], "channel": v.get("channel_name"), "since": v["joined_at"]} for v in voice],
                "playing": sorted(playing.values(), key=lambda g: -len(g["users"]))},
        "tonight": {"players": n, "from_voice": bool(present), "picks": picks[:8], "fits": len(picks)},
        "deadlines": {
            "offers": [{**{k: o[k] for k in ("id", "source", "title", "url", "image", "appid", "starts_at", "ends_at")},
                        "active": bool(o["active"])} for o in offers],
            "sales": [c["appid"] for c in sales],
            "releases": releases,
        },
        "recent": [{"appid": r.get("appid"), "game_name": r["game_name"], "users": r["users"], "last_at": r["last_at"],
                    "minutes": r["minutes"]} for r in recent[:16]],
        "games": sorted(cards.values(), key=lambda c: c["posted"]["last_at"] or "", reverse=True),
        "news": news,
        "members": mem,
        "updated_at": gdb.now_iso(),
    }
