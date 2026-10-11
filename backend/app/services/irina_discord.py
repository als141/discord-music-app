"""イリーナを Discord 側にも「居る」ようにする（voice プロセス）。前提は「邪魔をしない」＝投稿せず、気配だけ。

- bot のステータス: 音楽が鳴っていないとき「ゲーム に 3人 · Apex」
- VC ステータス: 音楽が鳴っていない VC で 2 人以上が同じゲーム中なら「🎮 R.E.P.O. · 3人」。人が書いたステータスは上書きしない
- #ゲーム置き場 の新しい投稿に人数のリアクション（1️⃣〜🔟、無料なら 🆓）
- チャンネルトピック: 1 日 1 回「今日の界隈」「界隈の新曲」（人が書いた部分は残す）
- 今週のドデカ（weekly_recap）を日曜 21 時に

募集（ロビー）は 2026-10-11 にオーナー指定で外した（「募集の機能はいらない」）。
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

import discord

from . import game_db as gdb
from . import game_shelf
from . import now_playing_status

JST = timezone(timedelta(hours=9))
APP_URL = os.getenv("IRINA_APP_ORIGIN") or "https://discord-music-app.vercel.app"
ROSE, GREEN, GREY = 0xE0245E, 0x16A34A, 0x9AA0A6
KEYCAPS = {1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣", 10: "🔟"}


def _pairs(env: str, default: str) -> Dict[str, str]:
    out = {}
    for x in (os.getenv(env) or default).split(","):
        if ":" in x:
            k, v = x.split(":", 1)
            out[k.strip()] = v.strip()
    return out


# ギルド → #一般（今週のドデカを出す）/ bot 用チャンネル（イリーナの調査メモを出す。通知オフ推奨のチャンネル）
GENERAL_CHANNELS = _pairs("IRINA_GENERAL_CHANNELS", "1093915551174234212:1093915551648194611,1080511818658762752:1080511818658762755")
BOT_CHANNELS = _pairs("IRINA_BOT_CHANNELS", "1093915551174234212:1156255909446680676,1080511818658762752:1232618506303045702")

_client: Optional[discord.Client] = None
_task: Optional[asyncio.Task] = None
_vc_human: Dict[int, Optional[str]] = {}     # channel_id -> gateway で見た最新のステータス（人が書いたかどうかの判定用）
_vc_mine: Dict[int, Optional[str]] = {}      # channel_id -> イリーナが最後に書いたゲームのステータス
_idle_text: Optional[str] = None
_tick_n = 0


# ---------------------------------------------------------------- 起動

def configure(client: discord.Client) -> None:
    """bot 起動前に 1 回。VC ステータスの更新を受け取る"""
    global _client
    _client = client
    try:
        # discord.py 2.7.1 は VOICE_CHANNEL_STATUS_UPDATE を扱わないので、受け取ってステータスを控える
        state = client._connection

        def parse_voice_channel_status_update(data):
            try:
                _vc_human[int(data["id"])] = data.get("status") or None
            except Exception:
                pass
        state.parsers["VOICE_CHANNEL_STATUS_UPDATE"] = parse_voice_channel_status_update
    except Exception as e:
        print(f"[irina-discord] status hook failed: {type(e).__name__}: {e}")


def start() -> None:
    """on_ready から（何度呼ばれても 1 つだけ）"""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def _loop() -> None:
    global _tick_n
    await asyncio.sleep(10)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[irina-discord] tick failed: {type(e).__name__}: {str(e)[:200]}")
        _tick_n += 1
        await asyncio.sleep(15)


async def tick() -> None:
    if _client is None or not _client.is_ready():
        return
    for gid in game_shelf.game_guild_ids():
        guild = _client.get_guild(int(gid))
        if not guild:
            continue
        await _vc_game_status(guild)
    await _presence()
    if _tick_n % 4 == 0:  # 1 分ごと
        await _react_posts()
    if _tick_n % 40 == 5:  # 10 分ごとに「今日の分」を書いたか確かめる
        await _channel_topics()
        from . import weekly_recap
        await weekly_recap.maybe_post(_client)


# ---------------------------------------------------------------- 気配

async def _presence() -> None:
    """音楽が鳴っていないときの bot のステータス"""
    global _idle_text
    text = None
    for gid in sorted(game_shelf.game_guild_ids()):
        vp = await asyncio.to_thread(gdb.voice_presence, gid)
        if len(vp) >= 2:
            chans = sorted({v.get("channel_name") or "" for v in vp})
            playing = await asyncio.to_thread(gdb.open_sessions, gid)
            in_vc = {v["user_id"] for v in vp}
            games: Dict[str, int] = {}
            for s in playing:
                if s["user_id"] in in_vc:
                    games[s["game_name"]] = games.get(s["game_name"], 0) + 1
            top = max(games.items(), key=lambda x: x[1])[0] if games else None
            text = f"{'・'.join(c for c in chans if c)} に {len(vp)}人" + (f" · {top}" if top else "")
            break
    if text != _idle_text:
        _idle_text = text
        await now_playing_status.set_idle(text)


async def _vc_game_status(guild: discord.Guild) -> None:
    """音楽が鳴っていない VC で 2 人以上が同じゲームをしていたら「🎮 R.E.P.O. · 3人」。人が書いたステータスは上書きしない"""
    if now_playing_status.is_playing(guild.id) or guild.id in now_playing_status._vc_disabled_guilds:
        return
    hidden = game_shelf.hidden_users()
    sessions = {s["user_id"]: s["game_name"] for s in gdb.open_sessions(str(guild.id)) if s["user_id"] not in hidden}
    for ch in guild.voice_channels:
        humans = [m for m in ch.members if not m.bot]
        counts: Dict[str, int] = {}
        for m in humans:
            g = sessions.get(str(m.id))
            if g:
                counts[g] = counts.get(g, 0) + 1
        best = max(counts.items(), key=lambda x: x[1]) if counts else None
        want = f"🎮 {best[0]} · {best[1]}人"[:100] if best and best[1] >= 2 else None
        mine = _vc_mine.get(ch.id)
        seen = _vc_human.get(ch.id, mine)
        if seen and seen != mine and not (seen or "").startswith("♪ "):
            continue  # 人が書いたステータス（または他の bot）。触らない
        if want == mine:
            continue
        if want is None and mine is None:
            continue
        _vc_mine[ch.id] = want
        now_playing_status._schedule_vc_status(guild, ch, want)


async def _react_posts() -> None:
    """#ゲーム置き場 の新しい投稿（2 日以内）に、人数（1️⃣〜🔟）と無料（🆓）のリアクション"""
    if _client is None:
        return
    since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    done = []
    posts = await asyncio.to_thread(gdb.posts_to_react, game_shelf.game_guild_ids(), since)
    by_msg: Dict[str, List[int]] = {}
    for p in posts:
        by_msg.setdefault(p["message_id"], []).append(p["id"])
    handled: Set[str] = set()
    for p in posts:
        if p["message_id"] in handled:
            continue  # 1 つの投稿にリンクが複数あっても、リアクションは最初に分かった 1 本ぶんだけ
        g = await asyncio.to_thread(gdb.get_game, p["appid"])
        if not g or not g.get("details_at"):
            continue
        prof = gdb.loads(g.get("profile"), {})
        if not prof and not g.get("is_free"):
            continue  # 人数が分かるまで待つ（プロフィールは数分で付く）
        emojis = []
        mx = prof.get("max_players_online")
        if mx:
            emojis.append(KEYCAPS.get(min(int(mx), 10)))
        if g.get("is_free"):
            emojis.append("🆓")
        ch = _client.get_channel(int(p["channel_id"]))
        if ch is not None and emojis:
            msg = ch.get_partial_message(int(p["message_id"]))
            for e in emojis:
                try:
                    await msg.add_reaction(e)
                except discord.HTTPException:
                    pass
        handled.add(p["message_id"])
        done.extend(by_msg[p["message_id"]])
    if done:
        await asyncio.to_thread(gdb.mark_reacted, done)
        print(f"[irina-discord] reacted to {len(done)} post(s)")


# ---------------------------------------------------------------- チャンネルトピック（1 日 1 回、通知も投稿も出ない）

TOPIC_MARK = "── "
TOPIC_GAME_CHANNELS = _pairs("IRINA_TOPIC_GAME_CHANNELS", "1093915551174234212:1381958352267116574")
TOPIC_SONG_CHANNELS = _pairs("IRINA_TOPIC_SONG_CHANNELS", "1093915551174234212:1426606582606860428")


def _merge_topic(current: Optional[str], mine: str) -> str:
    """人が書いた部分（区切り線より上）は残し、下のイリーナの部分だけ差し替える"""
    human = (current or "").split(f"\n{TOPIC_MARK}")[0]
    if (current or "").startswith(TOPIC_MARK):
        human = ""
    return ((human.rstrip() + "\n") if human.strip() else "") + TOPIC_MARK + mine


async def _set_topic(guild: discord.Guild, channel_id: Optional[str], mine: str) -> None:
    ch = guild.get_channel(int(channel_id)) if channel_id else None
    if not isinstance(ch, discord.TextChannel):
        return
    new = _merge_topic(ch.topic, mine)[:1024]
    if new == (ch.topic or ""):
        return
    try:
        await ch.edit(topic=new, reason="イリーナ: 今日の界隈")
        print(f"[irina-discord] topic updated: #{ch.name}")
    except discord.HTTPException as e:
        print(f"[irina-discord] topic failed #{ch.name}: {e}")


async def _channel_topics(force: bool = False) -> None:
    """#ゲーム置き場 に「今日の界隈」、#曲置き場 に「界隈の新曲」（17 時以降に 1 日 1 回）"""
    now = datetime.now(JST)
    if not force and (now.hour < 17 or gdb.kv_get("topic_day") == now.strftime("%Y-%m-%d")):
        return
    from ..scene import service as sc
    for gid in game_shelf.game_guild_ids():
        guild = _client.get_guild(int(gid)) if _client else None
        if not guild:
            continue
        try:
            board = await asyncio.to_thread(game_shelf.build_board, gid, None)
            scene = await asyncio.to_thread(sc.build_games, gid, board)
            songs = await asyncio.to_thread(sc.build_songs)
        except Exception as e:
            print(f"[irina-discord] topic build failed: {type(e).__name__}: {str(e)[:120]}")
            continue
        fresh = scene.get("fresh") or []
        if fresh:
            items = [f"{f['card']['name']}（{f.get('why') or (f['badges'] or [''])[0]}）" for f in fresh[:3]]
            await _set_topic(guild, TOPIC_GAME_CHANNELS.get(gid), f"今日の界隈（イリーナ）: " + " · ".join(items) + " ｜ /今夜 /界隈")
        top = (songs.get("songs") or [])[:3]
        if top:
            items = [f"{s.get('song') or s['videos'][0]['title']}（{(s.get('artist') or s['videos'][0]['channel']).split('/')[0].strip()}）" for s in top]
            await _set_topic(guild, TOPIC_SONG_CHANNELS.get(gid), "界隈の新曲（イリーナ）: " + " · ".join(items) + " ｜ /イントロ")
    gdb.kv_set("topic_day", now.strftime("%Y-%m-%d"))
