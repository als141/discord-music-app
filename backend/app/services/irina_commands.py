"""ゲーム置き場まわりのスラッシュコマンド（ドデカとテストサーバーだけ）。

- /募集   … 「21時〜 R.E.P.O. あと1人」。返信がそのまま募集のメッセージ（ボタンつき）。そろったらイリーナがメンション
- /今夜   … いまの VC の人数で遊べる候補を本人にだけ。［投票にする］で Discord の投票をみんなに出せる
- /チーム分け … いる VC の人をランダムに分ける（前回と同じ組み合わせを避ける）。［VC に分ける］で実際に移動、［戻す］で集める
- /界隈   … 配信者がいまやってる・話題の新作を本人にだけ

決める段の詰まり（人数・定番への引力）と、チーム分けの実需（21 か月で 23 回）に合わせた。返事は短く、本人にだけ見せられるものは本人にだけ。
"""
import asyncio
import json
import random
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import discord
from discord import app_commands

from . import game_db as gdb
from . import game_shelf
from . import irina_discord

JST = irina_discord.JST
APP_URL = irina_discord.APP_URL
TEAM_VCS = {k: v.split("|") for k, v in irina_discord._pairs(
    "IRINA_TEAM_VCS", "1093915551174234212:1226412500107657217|1226412555988107267,"
                      "1080511818658762752:1288754774115749910|1556013483693314139").items()}
TEAM_MARKS = ["🔴", "🔵", "🟢", "🟡"]


def _guilds() -> List[discord.Object]:
    return [discord.Object(id=int(g)) for g in sorted(game_shelf.game_guild_ids())]


def _lobby():
    from ..lobby import service as lobby
    return lobby


def _vc_humans(member: discord.abc.User) -> Tuple[Optional[discord.VoiceChannel], List[discord.Member]]:
    vs = getattr(member, "voice", None)
    ch = getattr(vs, "channel", None) if vs else None
    if ch is None:
        return None, []
    return ch, [m for m in ch.members if not m.bot]


# ---------------------------------------------------------------- 候補の名前（オートコンプリート）

def _game_choices(guild_id: str, text: str) -> List[app_commands.Choice[str]]:
    seen: Dict[str, str] = {}
    appids: List[str] = []
    # 今夜の候補・界隈の選定・最近遊ばれた・置き場の順
    from ..scene import curate as cur
    c = cur.current()
    appids += [p["appid"] for p in (c or {}).get("picks", [])]
    appids += [r["appid"] for r in gdb.recent_play(guild_id, 14) if r.get("appid")]
    appids += [p["appid"] for p in gdb.posts_for_guild(guild_id) if p.get("appid")]
    for g in gdb.all_games(appids):
        if g.get("name") and g.get("type") != "demo":
            seen[g["appid"]] = g["name"]
    order = {a: i for i, a in enumerate(dict.fromkeys(appids))}
    t = (text or "").lower()
    items = sorted(((a, n) for a, n in seen.items() if not t or t in n.lower()), key=lambda x: order.get(x[0], 9999))
    out = [app_commands.Choice(name="なにかやる（ゲームは集まってから）", value="-")] if not t else []
    out += [app_commands.Choice(name=n[:100], value=a) for a, n in items[:25 - len(out)]]
    return out[:25]


def _time_choices(text: str) -> List[app_commands.Choice[str]]:
    now = datetime.now(JST)
    out = [app_commands.Choice(name="今から", value="now")]
    for i in range(1, 8):
        h = (now.hour + i) % 24
        if 4 <= h < 12:
            continue
        out.append(app_commands.Choice(name=f"{h}:00", value=f"{h}:00"))
        if len(out) >= 6:
            break
    t = (text or "").strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", t):
        out.insert(1, app_commands.Choice(name=t, value=t))
    return out[:25]


# ---------------------------------------------------------------- /今夜

class PollButton(discord.ui.DynamicItem[discord.ui.Button], template=r"tonight:poll:(?P<n>\d+):(?P<ids>[\d,]+)"):
    """/今夜 の結果を Discord の投票にしてみんなに出す"""

    def __init__(self, n: int, appids: List[str]):
        super().__init__(discord.ui.Button(label="投票にする", style=discord.ButtonStyle.primary,
                                           custom_id=f"tonight:poll:{n}:{','.join(appids)}"[:100]))
        self.n, self.appids = n, appids

    @classmethod
    async def from_custom_id(cls, interaction, item, match):  # type: ignore[override]
        return cls(int(match["n"]), match["ids"].split(","))

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        games = {g["appid"]: g for g in await asyncio.to_thread(gdb.all_games, self.appids)}
        poll = discord.Poll(question=f"今夜どれ？（{self.n}人）", duration=timedelta(hours=1))
        for a in self.appids[:9]:
            if a in games:
                poll.add_answer(text=games[a]["name"][:55])
        poll.add_answer(text="いつもの")
        await interaction.response.send_message(f"{interaction.user.display_name} が投票を出しました", poll=poll)


async def tonight(interaction: discord.Interaction, players: Optional[int]) -> None:
    await interaction.response.defer(ephemeral=True, thinking=True)
    ch, humans = _vc_humans(interaction.user)
    n = players or (len(humans) if len(humans) >= 2 else 4)
    board = await asyncio.to_thread(game_shelf.build_board, str(interaction.guild_id), n)
    games = {g["appid"]: g for g in board["games"]}
    picks = [p for p in board["tonight"]["picks"] if p["appid"] in games][:6]
    if not picks:
        await interaction.followup.send(f"{n}人で遊べるゲームは置き場にまだありません", ephemeral=True)
        return
    lines = []
    for i, p in enumerate(picks, 1):
        g = games[p["appid"]]
        why = " · ".join(w for w in p["why"] if not re.fullmatch(r"(最大\d+人|\d+人まで|協力|対戦)", w))[:60]
        lines.append(f"**{i}. {g['name']}**  {why}")
    who = f"{ch.name} の {len(humans)}人" if ch and len(humans) >= 2 and not players else f"{n}人"
    embed = discord.Embed(title=f"今夜どれ？（{who}）", description="\n".join(lines), color=irina_discord.ROSE,
                          url=f"{APP_URL}/?tab=games")
    if games[picks[0]["appid"]].get("header_image"):
        embed.set_thumbnail(url=games[picks[0]["appid"]]["header_image"])
    view = discord.ui.View(timeout=None)
    view.add_item(PollButton(n, [p["appid"] for p in picks[:4]]))
    view.add_item(discord.ui.Button(label="アプリで見る", style=discord.ButtonStyle.link, url=f"{APP_URL}/?tab=games"))
    await interaction.followup.send(embed=embed, view=view, ephemeral=True)


# ---------------------------------------------------------------- /チーム分け

_TEAM_STATE: Dict[str, dict] = {}   # メッセージ ID → {guild, members, teams, home}


def _split(members: List[str], k: int, last: Optional[List[List[str]]]) -> List[List[str]]:
    """前回と同じチームになるペアがいちばん少ない分け方（20 回振って選ぶ）"""
    def pairs(teams):
        return {(a, b) for t in teams for a in t for b in t if a < b}
    prev = pairs(last or [])
    best, best_score = None, None
    for _ in range(20):
        xs = members[:]
        random.shuffle(xs)
        teams = [xs[i::k] for i in range(k)]
        score = len(pairs(teams) & prev)
        if best is None or score < best_score:
            best, best_score = teams, score
    return best or [members]


def _team_embed(teams: List[List[str]], note: str) -> discord.Embed:
    e = discord.Embed(title="チーム分け", color=irina_discord.ROSE)
    for i, t in enumerate(teams):
        e.add_field(name=f"{TEAM_MARKS[i % len(TEAM_MARKS)]} チーム{'ABCD'[i]}（{len(t)}人）", value=" ".join(f"<@{u}>" for u in t) or "—",
                    inline=True)
    e.set_footer(text=note)
    return e


class TeamButton(discord.ui.DynamicItem[discord.ui.Button], template=r"team:(?P<action>again|move|back)"):
    def __init__(self, action: str):
        labels = {"again": ("もう一回", discord.ButtonStyle.secondary), "move": ("VC に分ける", discord.ButtonStyle.primary),
                  "back": ("みんな戻す", discord.ButtonStyle.secondary)}
        label, style = labels[action]
        super().__init__(discord.ui.Button(label=label, style=style, custom_id=f"team:{action}"))
        self.action = action

    @classmethod
    async def from_custom_id(cls, interaction, item, match):  # type: ignore[override]
        return cls(match["action"])

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        st = _TEAM_STATE.get(str(interaction.message.id)) if interaction.message else None
        if not st:
            await interaction.response.send_message("このチーム分けは古いので、もう一度 `/チーム分け` してください", ephemeral=True)
            return
        guild = interaction.guild
        if self.action == "again":
            st["teams"] = _split(st["members"], len(st["teams"]), st["teams"])
            gdb.kv_set(f"team_last:{guild.id}", json.dumps(st["teams"]))
            await interaction.response.edit_message(embed=_team_embed(st["teams"], "もう一回振りました"), view=_team_view())
            return
        await interaction.response.defer()
        moved, failed = 0, 0
        vcs = TEAM_VCS.get(str(guild.id), [])
        for i, t in enumerate(st["teams"]):
            target = guild.get_channel(int(st["home"] if self.action == "back" else (vcs[i] if i < len(vcs) else st["home"])))
            for uid in t:
                m = guild.get_member(int(uid))
                if m is None or m.voice is None or target is None:
                    failed += 1
                    continue
                try:
                    await m.move_to(target, reason="イリーナのチーム分け")
                    moved += 1
                except discord.HTTPException:
                    failed += 1
        note = ("みんなを戻しました" if self.action == "back" else "VC に分けました") + (f"（{failed}人は移動できず）" if failed else "")
        await interaction.message.edit(embed=_team_embed(st["teams"], note), view=_team_view())


def _team_view() -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    for a in ("again", "move", "back"):
        v.add_item(TeamButton(a))
    return v


async def teams(interaction: discord.Interaction, count: int) -> None:
    ch, humans = _vc_humans(interaction.user)
    if not ch or len(humans) < 2:
        await interaction.response.send_message("VC に 2 人以上いるときに使えます（自分も VC に入ってから）", ephemeral=True)
        return
    count = max(2, min(count, 4, len(humans)))
    last = None
    try:
        last = json.loads(gdb.kv_get(f"team_last:{interaction.guild_id}") or "null")
    except ValueError:
        pass
    members = [str(m.id) for m in humans]
    split = _split(members, count, last)
    gdb.kv_set(f"team_last:{interaction.guild_id}", json.dumps(split))
    await interaction.response.send_message(embed=_team_embed(split, f"{ch.name} の {len(humans)}人 · 前回と同じ組み合わせはなるべく避けています"),
                                            view=_team_view(), allowed_mentions=discord.AllowedMentions.none())
    msg = await interaction.original_response()
    _TEAM_STATE[str(msg.id)] = {"guild": str(interaction.guild_id), "members": members, "teams": split, "home": str(ch.id)}


# ---------------------------------------------------------------- /界隈

async def scene(interaction: discord.Interaction) -> None:
    await interaction.response.defer(ephemeral=True, thinking=True)
    from ..scene import service as sc
    gid = str(interaction.guild_id)
    board = await asyncio.to_thread(game_shelf.build_board, gid, None)
    s = await asyncio.to_thread(sc.build_games, gid, board)
    fresh = s["fresh"][:5]
    streamers = s["streamers"][:4]
    e = discord.Embed(title="界隈で話題", color=irina_discord.ROSE, url=f"{APP_URL}/?tab=games")
    if fresh:
        e.add_field(name="話題の新作・インディー", inline=False, value="\n".join(
            f"**{i}. [{f['card']['name']}]({f['card']['store_url']})**  {f.get('why') or ' · '.join(f['badges'][:2])}" for i, f in enumerate(fresh, 1))[:1024])
    if streamers:
        e.add_field(name="配信者がいまやってる", inline=False, value="\n".join(
            f"**{x['name']}**  {len(x['channels'])}人（{'、'.join(c['name'].split('/')[0].strip() for c in x['channels'][:3])}）" for x in streamers)[:1024])
    if fresh and fresh[0]["card"].get("image"):
        e.set_thumbnail(url=fresh[0]["card"]["image"])
    view = discord.ui.View()
    view.add_item(discord.ui.Button(label="アプリで見る", style=discord.ButtonStyle.link, url=f"{APP_URL}/?tab=games"))
    await interaction.followup.send(embed=e, view=view, ephemeral=True)


# ---------------------------------------------------------------- /募集

async def boshu(interaction: discord.Interaction, game: Optional[str], need: int, start: str,
                calls: List[Optional[discord.Member]]) -> None:
    lobby = _lobby()
    gid, uid = str(interaction.guild_id), str(interaction.user.id)
    appid = game if game and game.isdigit() else None
    invite = [str(m.id) for m in calls if m is not None and not m.bot and m.id != interaction.user.id]
    await asyncio.to_thread(gdb.upsert_member, gid, uid, interaction.user.display_name, str(interaction.user.display_avatar.url))
    try:
        lb = await asyncio.to_thread(lobby.create, gid, uid, appid=appid, title=None, need=need, start=start or "now",
                                     invite=invite, origin="discord", discord_channel_id=str(interaction.channel_id))
    except ValueError as e:
        await interaction.response.send_message(str(e), ephemeral=True)
        return
    embed, view, h = irina_discord.render(lb)
    content = " ".join(f"<@{u}>" for u in invite) or None
    await interaction.response.send_message(content=content, embed=embed, view=view,
                                            allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False))
    msg = await interaction.original_response()
    await asyncio.to_thread(lobby.update_fields, lb["id"], discord_message_id=str(msg.id), render_hash=h)
    print(f"[irina-discord] /募集 #{lb['id']} by {uid} appid={appid} need={need} start={start}")


async def close_lobby(interaction: discord.Interaction) -> None:
    lobby = _lobby()
    mine = [lb for lb in await asyncio.to_thread(lobby.list_open, str(interaction.guild_id)) if lb["host_id"] == str(interaction.user.id)]
    if not mine:
        await interaction.response.send_message("立てている募集はありません", ephemeral=True)
        return
    for lb in mine:
        await asyncio.to_thread(lobby.close, lb["id"], "host")
    await interaction.response.send_message("締めました", ephemeral=True)


# ---------------------------------------------------------------- 登録

def register(tree: app_commands.CommandTree, client: discord.Client) -> None:
    client.add_dynamic_items(PollButton, TeamButton)
    guilds = _guilds()

    @tree.command(name="募集", description="「21時〜 R.E.P.O. あと1人」のように募集を立てる。そろったらイリーナが知らせます", guilds=guilds)
    @app_commands.rename(game="ゲーム", need="人数", start="時間", call1="呼ぶ1", call2="呼ぶ2", call3="呼ぶ3")
    @app_commands.describe(game="置き場・界隈のゲーム（選ばなければ「なにかやる」）", need="自分も入れて何人で", start="いつから",
                           call1="呼びたい人（メンションが飛びます）", call2="呼びたい人", call3="呼びたい人")
    async def _boshu(interaction: discord.Interaction, need: app_commands.Range[int, 2, 16] = 4, game: Optional[str] = None,
                     start: Optional[str] = "now", call1: Optional[discord.Member] = None, call2: Optional[discord.Member] = None,
                     call3: Optional[discord.Member] = None):
        await boshu(interaction, game, need, start or "now", [call1, call2, call3])

    @_boshu.autocomplete("game")
    async def _game_ac(interaction: discord.Interaction, current: str):
        return await asyncio.to_thread(_game_choices, str(interaction.guild_id), current)

    @_boshu.autocomplete("start")
    async def _time_ac(interaction: discord.Interaction, current: str):
        return _time_choices(current)

    @tree.command(name="募集を締める", description="自分が立てた募集を締める", guilds=guilds)
    async def _close(interaction: discord.Interaction):
        await close_lobby(interaction)

    @tree.command(name="今夜", description="いまの VC の人数で遊べるゲームを、自分にだけ出す（投票にもできる）", guilds=guilds)
    @app_commands.rename(players="人数")
    @app_commands.describe(players="人数（省くと自分のいる VC の人数）")
    async def _tonight(interaction: discord.Interaction, players: Optional[app_commands.Range[int, 2, 16]] = None):
        await tonight(interaction, players)

    @tree.command(name="チーム分け", description="自分のいる VC の人をチームに分ける（前回と同じ組み合わせは避ける）", guilds=guilds)
    @app_commands.rename(count="チーム数")
    @app_commands.describe(count="何チームに分けるか")
    async def _teams(interaction: discord.Interaction, count: app_commands.Range[int, 2, 4] = 2):
        await teams(interaction, count)

    @tree.command(name="界隈", description="配信者がいまやってるゲームと話題の新作を、自分にだけ出す", guilds=guilds)
    async def _scene(interaction: discord.Interaction):
        await scene(interaction)

    @tree.command(name="今週", description="今週のドデカ（VC の時間・遊ばれたゲーム・イントロ王など）を自分にだけ出す", guilds=guilds)
    @app_commands.rename(last="先週")
    @app_commands.describe(last="先週の分を見る")
    async def _week(interaction: discord.Interaction, last: bool = False):
        from . import weekly_recap
        await interaction.response.defer(ephemeral=True, thinking=True)
        start, end = weekly_recap.week_range()
        if last:
            start, end = start - timedelta(days=7), start
        st = await asyncio.to_thread(weekly_recap.stats, str(interaction.guild_id), start, end)
        await interaction.followup.send(embed=weekly_recap.embed(st, None if not last else None), ephemeral=True)
