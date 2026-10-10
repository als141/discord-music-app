"""イリーナを Discord 側にも「居る」ようにする（voice プロセス）。前提は「邪魔をしない」。

オーナー指定（2026-10-11）: 募集はイリーナが Discord に投稿してよい・行くを押していない人にも知らせてよい。

- 募集（app/lobby が DB の正本。ここは Discord への映し）
  - 立った募集を、埋め込み＋ボタン（行く / やめる / アプリで見る）で 1 通だけ投稿し、以後は同じメッセージを編集する
  - 揃ったら、行く人にメンションで 1 回だけ返信する（「揃ったら教えて」）
  - 15 分以上先の募集は Discord のイベントにもする（「興味あり」は行くに数える。開始時刻に開始、締めたら終了）
  - 締めたら、メッセージを「締め切り」にしてボタンを外す
- 気配（投稿しない）
  - bot のステータス: 音楽が鳴っていないとき「募集中: R.E.P.O. あと1人」「ゲーム に 3人」
  - VC ステータス: 音楽が鳴っていない VC で 2 人以上が同じゲーム中なら「🎮 R.E.P.O. · 3人」。人が書いたステータスは上書きしない
  - #ゲーム置き場 の新しい投稿に人数のリアクション（1️⃣〜🔟、無料なら 🆓）
"""
import asyncio
import hashlib
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


# ギルド → 募集を投稿するテキストチャンネル / イベントを立てる VC
LOBBY_CHANNELS = _pairs("IRINA_LOBBY_CHANNELS", "1093915551174234212:1093915551648194611,1080511818658762752:1080511818658762755")
LOBBY_VCS = _pairs("IRINA_LOBBY_VCS", "1093915551174234212:1093915551648194615,1080511818658762752:1080511819103346828")

_client: Optional[discord.Client] = None
_task: Optional[asyncio.Task] = None
_vc_human: Dict[int, Optional[str]] = {}     # channel_id -> gateway で見た最新のステータス（人が書いたかどうかの判定用）
_vc_mine: Dict[int, Optional[str]] = {}      # channel_id -> イリーナが最後に書いたゲームのステータス
_idle_text: Optional[str] = None
_tick_n = 0


def _lobby():
    from ..lobby import service as lobby
    return lobby


# ---------------------------------------------------------------- 起動

def configure(client: discord.Client) -> None:
    """bot 起動前に 1 回。ボタン（再起動後も効く）を登録し、VC ステータスの更新を受け取る"""
    global _client
    _client = client
    client.add_dynamic_items(LobbyButton)
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
        _lobby().init()
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
        lobby = _lobby()
        for lb in await asyncio.to_thread(lobby.list_open, gid):
            await _sync_lobby(guild, lb)
        for lb in await asyncio.to_thread(lobby.recently_closed, gid, 6):
            await _finish_lobby(guild, lb)
        await _vc_game_status(guild)
    await _presence()
    if _tick_n % 4 == 0:  # 1 分ごと
        await _react_posts()
    if _tick_n % 40 == 5:  # 10 分ごとに「今日の分」を書いたか確かめる
        await _channel_topics()
        from . import weekly_recap
        await weekly_recap.maybe_post(_client)


# ---------------------------------------------------------------- 募集: 見た目

def _member(guild_id: str, uid: str) -> Dict[str, Optional[str]]:
    return gdb.members(guild_id).get(uid) or {}


def render(lb: Dict[str, Any]) -> tuple:
    """(embed, view, hash)"""
    lobby = _lobby()
    g = gdb.get_game(lb["appid"]) if lb.get("appid") else None
    prof = gdb.loads((g or {}).get("profile"), {})
    closed = bool(lb.get("closed_at"))
    going = lb["going"]
    left = max(0, lb["need"] - len(going))
    host = _member(lb["guild_id"], lb["host_id"])
    lines = []
    if closed:
        lines.append("締め切りました")
    elif left:
        lines.append(f"**あと{left}人**（{len(going)}/{lb['need']}）")
    else:
        lines.append(f"**そろった！**（{len(going)}/{lb['need']}）")
    if going:
        lines.append(" ".join(f"<@{u}>" for u in going))
    if g:
        mx, mn = prof.get("max_players_online"), prof.get("min_players")
        players = f"{mn}〜{mx}人" if mx and mn and mn > 1 and mn != mx else (f"最大{mx}人" if mx else "")
        price = "無料" if g.get("is_free") else (f"¥{(g.get('price_final') or 0) // 100:,}" if g.get("price_final") is not None else "")
        if g.get("discount_percent"):
            price = f"-{g['discount_percent']}% {price}"
        meta = " · ".join(x for x in (players, price) if x)
        if prof.get("hook_ja"):
            lines.append(f"-# {prof['hook_ja']}")
        if meta:
            lines.append(f"-# {meta}")
    embed = discord.Embed(title=f"{lobby.what(lb)}　{lobby.when(lb)}"[:256], description="\n".join(lines)[:4000],
                          color=GREY if closed else (GREEN if not left else ROSE),
                          url=f"{APP_URL}/?tab=games&lobby={lb['id']}")
    embed.set_author(name=f"{host.get('name') or 'だれか'}の募集", icon_url=host.get("image") or None)
    if g and g.get("header_image"):
        embed.set_thumbnail(url=g["header_image"])
    if not closed:
        embed.set_footer(text="ボタンかアプリで参加 · そろったらイリーナが知らせます")
    view = None if closed else LobbyView(lb["id"])
    key = f"{embed.title}|{embed.description}|{closed}|{embed.color}"
    return embed, view, hashlib.sha1(key.encode()).hexdigest()[:16]


class LobbyButton(discord.ui.DynamicItem[discord.ui.Button], template=r"lobby:(?P<action>join|leave):(?P<id>\d+)"):
    """「行く」「やめる」。custom_id に募集の番号を入れるので、再起動後に押されても効く"""

    def __init__(self, action: str, lobby_id: int):
        super().__init__(discord.ui.Button(
            label="行く" if action == "join" else "やめる",
            style=discord.ButtonStyle.success if action == "join" else discord.ButtonStyle.secondary,
            custom_id=f"lobby:{action}:{lobby_id}"))
        self.action = action
        self.lobby_id = lobby_id

    @classmethod
    async def from_custom_id(cls, interaction: discord.Interaction, item: discord.ui.Button, match):  # type: ignore[override]
        return cls(match["action"], int(match["id"]))

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        await on_lobby_button(interaction, self.action, self.lobby_id)


class LobbyView(discord.ui.View):
    def __init__(self, lobby_id: int):
        super().__init__(timeout=None)
        self.add_item(LobbyButton("join", lobby_id))
        self.add_item(LobbyButton("leave", lobby_id))
        self.add_item(discord.ui.Button(label="アプリで見る", style=discord.ButtonStyle.link,
                                        url=f"{APP_URL}/?tab=games&lobby={lobby_id}"))


async def on_lobby_button(interaction: discord.Interaction, action: str, lobby_id: int) -> None:
    lobby = _lobby()
    lb = await asyncio.to_thread(lobby.get, lobby_id)
    if not lb or lb.get("closed_at") or str(interaction.guild_id) != lb["guild_id"]:
        await interaction.response.send_message("この募集はもう締め切られています", ephemeral=True)
        return
    uid = str(interaction.user.id)
    if action == "leave" and uid == lb["host_id"]:
        await interaction.response.send_message("立てた人は抜けられません。やめるときはアプリの「締める」か `/募集` の締めるで", ephemeral=True)
        return
    await asyncio.to_thread(gdb.upsert_member, lb["guild_id"], uid, getattr(interaction.user, "display_name", None),
                            str(interaction.user.display_avatar.url))
    lb = await asyncio.to_thread(lobby.set_status, lobby_id, uid, "going" if action == "join" else "none")
    embed, view, h = render(lb)
    try:
        await interaction.response.edit_message(embed=embed, view=view)
        await asyncio.to_thread(lobby.update_fields, lobby_id, render_hash=h)
    except discord.HTTPException as e:
        print(f"[irina-discord] button edit failed: {e}")
    if _client is not None:
        guild = _client.get_guild(int(lb["guild_id"]))
        if guild:
            await _announce_full(guild, lb)


# ---------------------------------------------------------------- 募集: 同期

def _channel_for(guild: discord.Guild, lb: Dict[str, Any]) -> Optional[discord.abc.Messageable]:
    cid = lb.get("discord_channel_id") or LOBBY_CHANNELS.get(str(guild.id))
    ch = guild.get_channel(int(cid)) if cid else None
    return ch if isinstance(ch, (discord.TextChannel, discord.Thread, discord.VoiceChannel)) else None


async def _message(guild: discord.Guild, lb: Dict[str, Any]) -> Optional[discord.PartialMessage]:
    ch = _channel_for(guild, lb)
    if not ch or not lb.get("discord_message_id"):
        return None
    return ch.get_partial_message(int(lb["discord_message_id"]))


async def _sync_lobby(guild: discord.Guild, lb: Dict[str, Any]) -> None:
    lobby = _lobby()
    # 立った通知（アプリ・Discord・チャットのどこから立っても 1 回だけ）
    if not lb.get("created_notified_at"):
        try:
            await lobby.notify_created(lb)
        except Exception as e:
            print(f"[irina-discord] notify_created failed: {type(e).__name__}: {str(e)[:120]}")
    # まだ Discord に出ていなければ投稿（/募集 から立てたものは、コマンドの返信がそのメッセージ）
    if not lb.get("discord_message_id"):
        ch = _channel_for(guild, lb)
        if ch is None:
            return
        embed, view, h = render(lb)
        call = [u for u in lb["invited"] if u not in lb["going"]]
        content = " ".join(f"<@{u}>" for u in call) or None
        try:
            msg = await ch.send(content=content, embed=embed, view=view,
                                allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False))
            await asyncio.to_thread(lobby.update_fields, lb["id"], discord_channel_id=str(ch.id), discord_message_id=str(msg.id),
                                    render_hash=h)
            print(f"[irina-discord] lobby #{lb['id']} posted in #{getattr(ch, 'name', ch.id)}")
        except discord.HTTPException as e:
            print(f"[irina-discord] lobby post failed: {e}")
            return
        lb = await asyncio.to_thread(lobby.get, lb["id"])
    await _sync_event(guild, lb)
    lb = await asyncio.to_thread(lobby.get, lb["id"])
    embed, view, h = render(lb)
    if h != lb.get("render_hash"):
        m = await _message(guild, lb)
        if m:
            try:
                await m.edit(embed=embed, view=view)
                await asyncio.to_thread(lobby.update_fields, lb["id"], render_hash=h)
            except discord.NotFound:
                await asyncio.to_thread(lobby.update_fields, lb["id"], discord_message_id=None)
            except discord.HTTPException as e:
                print(f"[irina-discord] lobby edit failed: {e}")
    await _announce_full(guild, lb)


async def _announce_full(guild: discord.Guild, lb: Dict[str, Any]) -> None:
    """揃ったら行く人にメンションで 1 回だけ（「揃ったら教えて」）"""
    lobby = _lobby()
    if lb.get("full_announced_at") or len(lb["going"]) < lb["need"]:
        return
    await asyncio.to_thread(lobby.update_fields, lb["id"], full_announced_at=datetime.now(timezone.utc).isoformat())
    m = await _message(guild, lb)
    vc = LOBBY_VCS.get(str(guild.id))
    text = f"そろった！ {' '.join(f'<@{u}>' for u in lb['going'])}" + (f" → <#{vc}>" if vc else "")
    try:
        if m:
            await m.reply(text, mention_author=False, allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False))
        else:
            ch = _channel_for(guild, lb)
            if ch:
                await ch.send(text, allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False))
        print(f"[irina-discord] lobby #{lb['id']} full → announced")
    except discord.HTTPException as e:
        print(f"[irina-discord] full announce failed: {e}")


async def _sync_event(guild: discord.Guild, lb: Dict[str, Any]) -> None:
    """15 分以上先の募集は Discord のイベントにも。「興味あり」は行くに数える。開始時刻に開始"""
    lobby = _lobby()
    start = datetime.fromisoformat(lb["start_at"])
    now = datetime.now(timezone.utc)
    vc_id = LOBBY_VCS.get(str(guild.id))
    vc = guild.get_channel(int(vc_id)) if vc_id else None
    if not lb.get("event_id"):
        if start - now < timedelta(minutes=15) or not isinstance(vc, (discord.VoiceChannel, discord.StageChannel)):
            return
        try:
            ev = await guild.create_scheduled_event(
                name=f"{lobby.what(lb)}（募集）"[:100], start_time=start, entity_type=discord.EntityType.voice, channel=vc,
                privacy_level=discord.PrivacyLevel.guild_only,
                description=f"{_member(lb['guild_id'], lb['host_id']).get('name') or 'だれか'}の募集。{lb['need']}人で。"
                            f"「興味あり」を押すと行く人に数えます。\n{APP_URL}/?tab=games&lobby={lb['id']}")
            await asyncio.to_thread(lobby.update_fields, lb["id"], event_id=str(ev.id))
            print(f"[irina-discord] lobby #{lb['id']} event created")
        except discord.HTTPException as e:
            print(f"[irina-discord] event create failed: {e}")
            await asyncio.to_thread(lobby.update_fields, lb["id"], event_id="failed")
        return
    if lb["event_id"] == "failed":
        return
    ev = guild.get_scheduled_event(int(lb["event_id"]))
    if ev is None:
        return
    try:
        # 「興味あり」の人を行くに（1 分ごと）
        if _tick_n % 4 == 0:
            async for u in ev.users(limit=50):
                if not u.bot and str(u.id) not in lb["going"]:
                    await asyncio.to_thread(_add_member, lb["id"], str(u.id), "event")
        if ev.status == discord.EventStatus.scheduled and now >= start:
            await ev.start()
    except discord.HTTPException as e:
        print(f"[irina-discord] event sync failed: {e}")


def _add_member(lobby_id: int, uid: str, source: str) -> None:
    from .. import db
    with db._connect() as c:
        c.execute("INSERT OR IGNORE INTO lobby_members (lobby_id, user_id, status, source, at) VALUES (?, ?, 'going', ?, ?)",
                  (lobby_id, uid, source, datetime.now(timezone.utc).isoformat()))


async def _finish_lobby(guild: discord.Guild, lb: Dict[str, Any]) -> None:
    lobby = _lobby()
    embed, _, h = render(lb)
    if lb.get("discord_message_id") and h != lb.get("render_hash"):
        m = await _message(guild, lb)
        if m:
            try:
                await m.edit(embed=embed, view=None)
            except discord.HTTPException:
                pass
        await asyncio.to_thread(lobby.update_fields, lb["id"], render_hash=h)
    if lb.get("event_id") and lb["event_id"] not in ("failed", "done"):
        ev = guild.get_scheduled_event(int(lb["event_id"]))
        try:
            if ev is not None:
                if ev.status == discord.EventStatus.active:
                    await ev.end()
                elif ev.status == discord.EventStatus.scheduled:
                    await ev.cancel()
        except discord.HTTPException as e:
            print(f"[irina-discord] event finish failed: {e}")
        await asyncio.to_thread(lobby.update_fields, lb["id"], event_id="done")


# ---------------------------------------------------------------- 気配

async def _presence() -> None:
    """音楽が鳴っていないときの bot のステータス"""
    global _idle_text
    text = None
    for gid in sorted(game_shelf.game_guild_ids()):
        lobs = await asyncio.to_thread(_lobby().list_open, gid)
        if lobs:
            lb = lobs[0]
            left = max(0, lb["need"] - len(lb["going"]))
            text = f"募集中: {_lobby().what(lb)} " + (f"あと{left}人" if left else "そろった") + f"（{_lobby().when(lb)}）"
            break
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
            await _set_topic(guild, TOPIC_GAME_CHANNELS.get(gid), f"今日の界隈（イリーナ）: " + " · ".join(items) + " ｜ /募集 /今夜 /界隈")
        top = (songs.get("songs") or [])[:3]
        if top:
            items = [f"{s.get('song') or s['videos'][0]['title']}（{(s.get('artist') or s['videos'][0]['channel']).split('/')[0].strip()}）" for s in top]
            await _set_topic(guild, TOPIC_SONG_CHANNELS.get(gid), "界隈の新曲（イリーナ）: " + " · ".join(items) + " ｜ /イントロ")
    gdb.kv_set("topic_day", now.strftime("%Y-%m-%d"))
