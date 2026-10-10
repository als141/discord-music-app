"""イントロクイズ（/イントロ）。曲置き場にみんなが貼った曲を、イリーナが VC で 12 秒だけ流し、4 択のボタンで当てる。

- 出題元: 曲置き場（#曲置き場、なければ一般も）に貼られて曲名が分かっている曲。選択肢の残り 3 つも同じ置き場から
- 得点: 正解した順に 3 / 2 / 1 点。間違えたらその問題は終わり。全員答えるか、流し終わって 6 秒で次へ
- 音楽が流れている（キューがある）ときは始めない。クイズ中に曲が足されても、プレイヤーはクイズが終わるまで待つ
- イリーナが VC にいなければ、始めた人の VC に入り、終わったら出る
- 点数は quiz_scores に残す（「今週のイントロ王」用）
"""
import asyncio
import glob
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import discord
from discord import app_commands

from .. import db
from . import game_shelf

JST = timezone(timedelta(hours=9))
SHELF_CHANNELS = [x.strip() for x in (os.getenv("IRINA_PUSH_SHELF_CHANNEL_IDS") or "1426606582606860428").split(",") if x.strip()]
ROSE, GREEN = 0xE0245E, 0x16A34A
_active: Dict[int, str] = {}        # guild_id -> quiz id（この間はプレイヤーが待つ）
_quizzes: Dict[str, "Quiz"] = {}


def busy(guild_id) -> bool:
    """music_player の再生ループから: クイズ中は次の曲を流さない"""
    try:
        return int(guild_id) in _active
    except (TypeError, ValueError):
        return False


def init() -> None:
    with db._connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS quiz_scores (id INTEGER PRIMARY KEY, guild_id TEXT, user_id TEXT, points INTEGER, "
                  "correct INTEGER, rounds INTEGER, played_at TEXT)")


def _pool(guild_id: str) -> List[Dict[str, Any]]:
    """曲名が分かっている、置き場の曲（同じ曲名は 1 つ）"""
    with db._connect() as c:
        rows = c.execute(
            "SELECT video_id, title, artist, posted_by_name, channel_id, MAX(posted_at) FROM shared_links "
            "WHERE guild_id = ? AND title IS NOT NULL AND title != '' GROUP BY video_id", (guild_id,)).fetchall()
    seen, out = set(), []
    shelf = [r for r in rows if r[4] in SHELF_CHANNELS]
    for r in (shelf if len(shelf) >= 8 else rows):
        key = (r[1] or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append({"video_id": r[0], "title": r[1], "artist": r[2] or "", "posted_by": r[3] or ""})
    return out


# 曲ではない動画のカテゴリ（ニュース・スポーツ・旅行・ハウツー・教育・科学・社会・乗り物・動物）。
# 歌ってみたは「ゲーム」「エンタメ」「ブログ」に入っていることが多いので、そこは外さない
_NOT_MUSIC = {"25", "17", "19", "26", "27", "28", "29", "2", "15"}


def _music_only(pool: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """YouTube のカテゴリで、曲ではない動画（ニュースなど）を出題元から外す。カテゴリは app_kv に控える"""
    from . import game_db as gdb
    import json
    import urllib.parse
    import urllib.request
    key = os.getenv("YOUTUBE_API_KEY") or ""
    cats = json.loads(gdb.kv_get("quiz_video_categories") or "{}")
    todo = [p["video_id"] for p in pool if p["video_id"] not in cats]
    if key and todo:
        for i in range(0, len(todo), 50):
            q = urllib.parse.urlencode({"part": "snippet", "id": ",".join(todo[i:i + 50]), "key": key})
            try:
                with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/videos?{q}", timeout=15) as r:
                    for it in json.load(r).get("items") or []:
                        cats[it["id"]] = (it.get("snippet") or {}).get("categoryId") or ""
            except Exception as e:
                print(f"[quiz] category lookup failed: {type(e).__name__}")
                break
        for v in todo:
            cats.setdefault(v, "")
        gdb.kv_set("quiz_video_categories", json.dumps(cats))
    return [p for p in pool if cats.get(p["video_id"], "") not in _NOT_MUSIC]


def _download(video_id: str) -> Optional[str]:
    """曲のファイル（音楽プレイヤーと同じ置き場・キャッシュ）"""
    from .music_player import extract_info_with_fallback, settings
    hit = glob.glob(os.path.join(settings.music.directory, f"*-{video_id}.*"))
    hit = [h for h in hit if not h.endswith((".part", ".ytdl"))]
    if hit:
        return hit[0]
    info, ydl = extract_info_with_fallback(f"https://www.youtube.com/watch?v={video_id}", download=True)
    if info and "entries" in info:
        info = (info["entries"] or [None])[0]
    if not info:
        return None
    path = ydl.prepare_filename(info)
    return path if os.path.exists(path) else None


class AnswerButton(discord.ui.DynamicItem[discord.ui.Button], template=r"quiz:(?P<qid>[0-9a-f]{8}):(?P<r>\d+):(?P<i>\d)"):
    def __init__(self, qid: str, rnd: int, idx: int, label: str = "…"):
        super().__init__(discord.ui.Button(label=label[:80], style=discord.ButtonStyle.secondary, custom_id=f"quiz:{qid}:{rnd}:{idx}"))
        self.qid, self.rnd, self.idx = qid, rnd, idx

    @classmethod
    async def from_custom_id(cls, interaction, item, match):  # type: ignore[override]
        return cls(match["qid"], int(match["r"]), int(match["i"]), item.label or "…")

    async def callback(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        q = _quizzes.get(self.qid)
        if not q:
            await interaction.response.send_message("このクイズはもう終わっています", ephemeral=True)
            return
        await q.answer(interaction, self.rnd, self.idx)


class Quiz:
    def __init__(self, guild: discord.Guild, channel: discord.abc.Messageable, vc: discord.VoiceChannel, host: discord.Member,
                 songs: List[Dict[str, Any]], pool: List[Dict[str, Any]], seconds: int, mode: str):
        self.id = uuid.uuid4().hex[:8]
        self.guild, self.channel, self.vc, self.host = guild, channel, vc, host
        self.songs, self.pool, self.seconds, self.mode = songs, pool, seconds, mode
        self.scores: Dict[int, int] = {}
        self.correct: Dict[int, int] = {}
        self.names: Dict[int, str] = {}
        self.round = -1
        self.choices: List[str] = []
        self.answer_idx = 0
        self.answered: Dict[int, bool] = {}
        self.order: List[int] = []
        self.round_started = 0.0
        self.round_done = asyncio.Event()
        self.message: Optional[discord.Message] = None
        self.joined_vc = False

    # ---- 1 問
    def _view(self, reveal: bool = False) -> discord.ui.View:
        v = discord.ui.View(timeout=None)
        for i, c in enumerate(self.choices):
            b = AnswerButton(self.id, self.round, i, c)
            if reveal:
                b.item.disabled = True
                b.item.style = discord.ButtonStyle.success if i == self.answer_idx else discord.ButtonStyle.secondary
            v.add_item(b)
        return v

    def _embed(self, reveal: bool = False) -> discord.Embed:
        s = self.songs[self.round]
        if not reveal:
            e = discord.Embed(title=f"第{self.round + 1}問 / {len(self.songs)}", color=ROSE,
                              description=f"🎧 {self.seconds} 秒流します。曲名はどれ？（早いほど高得点）")
        else:
            got = [f"{self.names.get(u, '?')} +{p}" for u, p in self._round_points().items()]
            e = discord.Embed(title=f"第{self.round + 1}問の正解", color=GREEN,
                              description=f"**{s['title']}**" + (f" — {s['artist']}" if s["artist"] else "") +
                                          (f"\n-# {s['posted_by']} が曲置き場に貼った曲" if s.get("posted_by") else "") +
                                          ("\n" + "　".join(got) if got else "\n正解者なし"))
            e.set_thumbnail(url=f"https://i.ytimg.com/vi/{s['video_id']}/mqdefault.jpg")
        return e

    def _round_points(self) -> Dict[int, int]:
        pts = [3, 2, 1]
        return {u: pts[min(i, 2)] for i, u in enumerate(self.order)}

    async def answer(self, interaction: discord.Interaction, rnd: int, idx: int) -> None:
        uid = interaction.user.id
        if rnd != self.round or self.round_done.is_set():
            await interaction.response.send_message("この問題はもう終わりました", ephemeral=True)
            return
        if uid in self.answered:
            await interaction.response.send_message("この問題はもう答えています", ephemeral=True)
            return
        self.answered[uid] = idx == self.answer_idx
        self.names[uid] = getattr(interaction.user, "display_name", "?")
        if idx == self.answer_idx:
            self.order.append(uid)
            sec = time.monotonic() - self.round_started
            await interaction.response.send_message(f"正解！（{sec:.1f} 秒）", ephemeral=True)
        else:
            await interaction.response.send_message("ちがう…", ephemeral=True)
        humans = [m for m in self.vc.members if not m.bot]
        if humans and all(m.id in self.answered for m in humans):
            self.round_done.set()

    async def _play(self, path: str) -> None:
        vcl = self.guild.voice_client
        if vcl is None or not vcl.is_connected():
            return
        start = 0.0
        if self.mode != "intro":
            try:
                import subprocess
                out = await asyncio.to_thread(subprocess.run, ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                                               "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, timeout=10)
                dur = float(out.stdout.strip() or 0)
                start = dur * (0.42 if self.mode == "sabi" else random.uniform(0.2, 0.7))
            except Exception:
                start = 45.0
        before = f"-ss {start:.1f} -analyzeduration 0" if start else "-analyzeduration 0"
        af = (f"silenceremove=start_periods=1:start_threshold=-45dB," if self.mode == "intro" else "") + \
             f"afade=t=in:d=0.3,afade=t=out:st={max(0, self.seconds - 1.5):.1f}:d=1.5"
        src = discord.FFmpegPCMAudio(path, before_options=before, options=f"-vn -t {self.seconds} -af {af}")
        if vcl.is_playing():
            vcl.stop()
        vcl.play(discord.PCMVolumeTransformer(src, volume=0.6))

    async def run(self, files: Dict[str, str]) -> None:
        try:
            for r in range(len(self.songs)):
                self.round = r
                s = self.songs[r]
                others = [p["title"] for p in self.pool if p["title"] != s["title"]]
                self.choices = random.sample(others, 3) + [s["title"]]
                random.shuffle(self.choices)
                self.answer_idx = self.choices.index(s["title"])
                self.answered, self.order = {}, []
                self.round_done = asyncio.Event()
                if self.message is None:
                    self.message = await self.channel.send(embed=self._embed(), view=self._view())
                else:
                    await self.message.edit(embed=self._embed(), view=self._view())
                self.round_started = time.monotonic()
                await self._play(files[s["video_id"]])
                try:
                    await asyncio.wait_for(self.round_done.wait(), timeout=self.seconds + 6)
                except asyncio.TimeoutError:
                    pass
                self.round_done.set()
                vcl = self.guild.voice_client
                if vcl and vcl.is_playing():
                    vcl.stop()
                for u, p in self._round_points().items():
                    self.scores[u] = self.scores.get(u, 0) + p
                    self.correct[u] = self.correct.get(u, 0) + 1
                await self.message.edit(embed=self._embed(reveal=True), view=self._view(reveal=True))
                await asyncio.sleep(5)
            await self._finish()
        finally:
            _active.pop(self.guild.id, None)
            _quizzes.pop(self.id, None)
            if self.joined_vc and self.guild.voice_client and not self.guild.voice_client.is_playing():
                try:
                    await self.guild.voice_client.disconnect()
                except Exception:
                    pass

    async def _finish(self) -> None:
        ranking = sorted(self.scores.items(), key=lambda x: -x[1])
        medals = ["🥇", "🥈", "🥉"]
        lines = [f"{medals[i] if i < 3 else f'{i + 1}.'} **{self.names.get(u, '?')}**  {p}点（{self.correct.get(u, 0)}問正解）"
                 for i, (u, p) in enumerate(ranking)] or ["正解者なし…"]
        e = discord.Embed(title="イントロクイズ 結果", description="\n".join(lines), color=ROSE)
        e.set_footer(text="曲置き場にみんなが貼った曲から出題 · /イントロ でもう一回")
        await self.message.edit(embed=e, view=None)
        now = datetime.now(timezone.utc).isoformat()
        with db._connect() as c:
            c.executemany("INSERT INTO quiz_scores (guild_id, user_id, points, correct, rounds, played_at) VALUES (?, ?, ?, ?, ?, ?)",
                          [(str(self.guild.id), str(u), p, self.correct.get(u, 0), len(self.songs), now) for u, p in self.scores.items()])
        print(f"[quiz] {self.guild.name}: {len(self.songs)}問 終了 {[(self.names.get(u), p) for u, p in ranking]}")


async def start(interaction: discord.Interaction, music_players: Dict[str, Any], rounds: int, seconds: int, mode: str) -> None:
    guild = interaction.guild
    vs = getattr(interaction.user, "voice", None)
    vc = getattr(vs, "channel", None) if vs else None
    if guild is None or not isinstance(vc, discord.VoiceChannel):
        await interaction.response.send_message("VC に入ってから使ってください", ephemeral=True)
        return
    if guild.id in _active:
        await interaction.response.send_message("いまクイズ中です", ephemeral=True)
        return
    player = music_players.get(str(guild.id))
    if player is not None and (getattr(player, "current", None) is not None or len(getattr(player, "queue", [])) > 0):
        await interaction.response.send_message("音楽が流れている（キューがある）ので、止めてからどうぞ", ephemeral=True)
        return
    vcl = guild.voice_client
    if vcl is not None and vcl.channel and vcl.channel.id != vc.id and any(not m.bot for m in vcl.channel.members):
        await interaction.response.send_message(f"イリーナはいま {vcl.channel.name} にいます", ephemeral=True)
        return
    pool = await asyncio.to_thread(lambda: _music_only(_pool(str(guild.id))))
    if len(pool) < 4:
        await interaction.response.send_message("曲置き場の曲がまだ少なくて出題できません", ephemeral=True)
        return
    rounds = max(1, min(rounds, 10, len(pool)))
    await interaction.response.send_message(f"🎧 イントロクイズ（{rounds}問・{seconds}秒）を準備中… 曲置き場から出題します")
    _active[guild.id] = "preparing"
    try:
        songs, files = [], {}
        for s in random.sample(pool, len(pool)):
            if len(songs) >= rounds:
                break
            try:
                path = await asyncio.wait_for(asyncio.to_thread(_download, s["video_id"]), timeout=60)
            except Exception as e:
                print(f"[quiz] download failed {s['video_id']}: {type(e).__name__}")
                path = None
            if path:
                songs.append(s)
                files[s["video_id"]] = path
        if not songs:
            _active.pop(guild.id, None)
            await interaction.edit_original_response(content="曲を用意できませんでした（ダウンロードに失敗）")
            return
        joined = False
        if guild.voice_client is None:
            await vc.connect(self_deaf=True)
            joined = True
        elif guild.voice_client.channel.id != vc.id:
            await guild.voice_client.move_to(vc)
        q = Quiz(guild, interaction.channel, vc, interaction.user, songs, pool, seconds, mode)
        q.joined_vc = joined
        _quizzes[q.id] = q
        _active[guild.id] = q.id
        await interaction.edit_original_response(content=f"🎧 イントロクイズ スタート！（{len(songs)}問）")
        asyncio.create_task(q.run(files))
    except Exception as e:
        _active.pop(guild.id, None)
        print(f"[quiz] start failed: {type(e).__name__}: {e}")
        try:
            await interaction.edit_original_response(content="始められませんでした")
        except Exception:
            pass


def register(tree: app_commands.CommandTree, client: discord.Client, music_players: Dict[str, Any]) -> None:
    client.add_dynamic_items(AnswerButton)
    guilds = [discord.Object(id=int(g)) for g in sorted(game_shelf.game_guild_ids())]

    @tree.command(name="イントロ", description="曲置き場にみんなが貼った曲でイントロクイズ（VC で流して、ボタンで答える）", guilds=guilds)
    @app_commands.rename(rounds="問題数", seconds="秒数", mode="どこから")
    @app_commands.describe(rounds="何問（1〜10）", seconds="何秒流すか", mode="曲のどこを流すか")
    @app_commands.choices(mode=[app_commands.Choice(name="イントロ", value="intro"), app_commands.Choice(name="サビあたり", value="sabi"),
                                app_commands.Choice(name="どこか", value="random")])
    async def _intro(interaction: discord.Interaction, rounds: app_commands.Range[int, 1, 10] = 5,
                     seconds: app_commands.Range[int, 5, 30] = 12, mode: str = "intro"):
        await start(interaction, music_players, rounds, seconds, mode)
