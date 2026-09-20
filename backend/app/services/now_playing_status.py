"""再生中の曲を Discord に「投稿ゼロ」で映す。

- bot の Presence: 「〇〇 — アーティスト を再生中」（Listening）。何も鳴っていなければ既定の表示に戻す
- VC チャンネルステータス: VC 名の直下の 1 行に「♪ 曲名 — アーティスト」。
  `PUT /channels/{id}/voice-status` は即時連打すると 429/500 になるので **チャンネルごと 30 秒に 1 回**に
  デバウンスし、次に許される時点の「最新の値」だけを送る。権限が無ければ（Forbidden）そのサーバーでは自己無効化。
  切断・キュー終了時は None でクリア。

MusicPlayer から `update(guild, song_or_None)` が呼ばれる（`register_now_playing_hook`）。
bot.py 起動時に `configure(client)` を呼ぶこと。
"""
import asyncio
import time
from typing import Dict, Optional, Set, Tuple

import discord

IDLE_ACTIVITY_NAME = "バージョン1.0.0"   # 何も鳴っていないときの表示（ユーザー指定の文言）
VC_STATUS_MIN_INTERVAL_SEC = 30.0
VC_STATUS_MAX_LEN = 500

_client: Optional[discord.Client] = None
_playing: Dict[int, Tuple[str, str]] = {}                       # guild_id -> (title, artist)
_vc_desired: Dict[int, Optional[str]] = {}                      # channel_id -> 送りたいステータス（None=クリア）
_vc_last_sent: Dict[int, Tuple[float, Optional[str]]] = {}      # channel_id -> (monotonic, 送ったテキスト)
_vc_tasks: Dict[int, asyncio.Task] = {}
_vc_disabled_guilds: Set[int] = set()
_guild_channel: Dict[int, int] = {}                             # guild_id -> 最後にステータスを出した VC
_presence_lock: Optional[asyncio.Lock] = None


def configure(client: discord.Client) -> None:
    global _client
    _client = client


def _clean_artist(artist: Optional[str]) -> str:
    a = (artist or "").strip()
    return "" if a.lower() in ("", "unknown", "unknown artist") else a


def _status_text(title: str, artist: Optional[str]) -> str:
    a = _clean_artist(artist)
    text = f"♪ {title}" + (f" — {a}" if a else "")
    return text[:VC_STATUS_MAX_LEN]


async def update(guild: discord.Guild, song) -> None:
    """再生開始時は song、停止/キュー終了/切断時は None。呼び出し元（再生処理）に例外を漏らさない"""
    try:
        if song is not None:
            _playing[guild.id] = (str(getattr(song, "title", "") or ""), str(getattr(song, "artist", "") or ""))
        else:
            _playing.pop(guild.id, None)
        await _apply_presence()

        vc = getattr(guild.voice_client, "channel", None) if guild.voice_client else None
        if isinstance(vc, discord.VoiceChannel):
            _guild_channel[guild.id] = vc.id
        elif song is None and _client is not None:
            # 切断後（voice_client が消えた後）に呼ばれた場合は、最後にステータスを出した VC を消す
            vc = _client.get_channel(_guild_channel.get(guild.id, 0))
        if isinstance(vc, discord.VoiceChannel):
            _schedule_vc_status(guild, vc, _status_text(*_playing[guild.id]) if guild.id in _playing else None)
    except Exception as e:
        print(f"[now-playing] update failed ({type(e).__name__}): {e}")


async def clear_all() -> None:
    """シャットダウン時: 全 VC のステータスを（デバウンスを待たずに）消す"""
    for channel_id, (_, last_text) in list(_vc_last_sent.items()):
        if last_text is None or _client is None:
            continue
        channel = _client.get_channel(channel_id)
        if isinstance(channel, discord.VoiceChannel):
            try:
                await asyncio.wait_for(channel._state.http.edit_voice_channel_status(None, channel_id=channel.id), timeout=5)
            except Exception:
                pass


async def _apply_presence() -> None:
    global _presence_lock
    if _client is None or _client.is_closed():
        return
    if _presence_lock is None:
        _presence_lock = asyncio.Lock()
    if _playing:
        title, artist = list(_playing.values())[-1]  # 複数サーバーで鳴っていれば最後に始まった曲
        a = _clean_artist(artist)
        name = (f"{title} — {a}" if a else title)[:128]
        activity: discord.BaseActivity = discord.Activity(type=discord.ActivityType.listening, name=name)
    else:
        activity = discord.CustomActivity(name=IDLE_ACTIVITY_NAME)
    async with _presence_lock:
        try:
            await _client.change_presence(status=discord.Status.online, activity=activity)
        except Exception as e:
            print(f"[now-playing] presence 更新失敗: {type(e).__name__}: {e}")


def _schedule_vc_status(guild: discord.Guild, channel: discord.VoiceChannel, text: Optional[str]) -> None:
    if guild.id in _vc_disabled_guilds:
        return
    _vc_desired[channel.id] = text
    task = _vc_tasks.get(channel.id)
    if task is not None and not task.done():
        return  # 待機中のタスクが最新の desired を送る
    _vc_tasks[channel.id] = asyncio.create_task(_vc_apply_when_allowed(guild, channel))


async def _vc_apply_when_allowed(guild: discord.Guild, channel: discord.VoiceChannel) -> None:
    last_at, last_text = _vc_last_sent.get(channel.id, (0.0, None))
    wait = VC_STATUS_MIN_INTERVAL_SEC - (time.monotonic() - last_at)
    if wait > 0:
        await asyncio.sleep(wait)
    text = _vc_desired.get(channel.id)
    if text == last_text:
        return
    try:
        # discord.py 2.7.1 は VoiceChannel.edit(status=) を公開シグネチャに持たないので HTTP 層を直接呼ぶ
        # （PUT /channels/{id}/voice-status。None でクリア）
        await channel._state.http.edit_voice_channel_status(text, channel_id=channel.id)
        _vc_last_sent[channel.id] = (time.monotonic(), text)
        print(f"[now-playing] VC status {'cleared' if text is None else 'set'}: #{channel.name} ({guild.name})")
    except discord.Forbidden:
        _vc_disabled_guilds.add(guild.id)
        print(f"[now-playing] VC status の権限が無いので {guild.name} では無効化（bot ロールに『ボイスチャンネルステータスを設定』を付けると有効）")
        return
    except discord.HTTPException as e:
        print(f"[now-playing] VC status 更新失敗 {e.status}: {str(e)[:120]}（30秒後に再試行）")
        _vc_last_sent[channel.id] = (time.monotonic(), last_text)
    except Exception as e:
        print(f"[now-playing] VC status 更新失敗: {type(e).__name__}: {e}")
        return
    # 待っている間に desired が変わっていれば、次の許可時刻にもう一度
    if _vc_desired.get(channel.id) != _vc_last_sent.get(channel.id, (0.0, None))[1]:
        _vc_tasks[channel.id] = asyncio.create_task(_vc_apply_when_allowed(guild, channel))
