import asyncio
import os
import yt_dlp
import discord
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from collections import deque

MUSIC_DIR = "music"

# OAuth2認証情報
OAUTH2_USERNAME = "oauth2"  # 必要に応じて変更
OAUTH2_PASSWORD = "" # 初回認証後は不要

# yt-dlpの設定
ytdl_format_options = {
    'format': 'bestaudio/best',
    'outtmpl': f'{MUSIC_DIR}/%(title)s-%(id)s.%(ext)s',
    'restrictfilenames': True,
    'noplaylist': False,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0',
    'username': OAUTH2_USERNAME,
    'password': OAUTH2_PASSWORD,
}

ytdl = yt_dlp.YoutubeDL(ytdl_format_options)
guild_queues = defaultdict(asyncio.Queue)

class Song:
    def __init__(self, source, title, url, thumbnail, artist):
        self.source = source
        self.title = title
        self.url = url
        self.thumbnail = thumbnail
        self.artist = artist

class MusicPlayer:
    def __init__(self, bot, guild, guild_id, notify_clients):
        self.bot = bot
        self.guild = guild
        self.guild_id = guild_id
        self.notify_clients = notify_clients
        self.queue = deque()
        self.history = deque()
        self.next = asyncio.Event()
        self.current = None
        self.voice_client = guild.voice_client
        self.bot.loop.create_task(self.player_loop())
        self.executor = ThreadPoolExecutor(max_workers=3)

    async def player_loop(self):
        await self.bot.wait_until_ready()
        while not self.bot.is_closed():
            self.next.clear()
            if not self.queue:
                await self.next.wait()
                continue

            song = self.queue[0]  # キューの先頭の曲を取得

            if song.source is None:
                # ダウンロードとソースの設定
                try:
                    song = await self.bot.loop.run_in_executor(self.executor, self.download_song, song)
                    self.queue[0] = song  # キューの曲を更新
                except Exception as e:
                    print(f'楽曲の処理中にエラーが発生しました: {str(e)}')
                    self.queue.popleft()  # エラーが発生した曲をキューから削除
                    continue

            self.current = song
            if not self.voice_client.is_playing():
                try:
                    self.voice_client.play(discord.FFmpegPCMAudio(song.source),
                                        after=lambda _: self.bot.loop.call_soon_threadsafe(self.next.set))
                    # 再生が開始された直後にクライアントに通知
                    await self.notify_clients(self.guild_id)
                except Exception as e:
                    print(f"Error playing audio: {e}")
            else:
                print("Voice client is already playing. Waiting for current song to finish.")

            await self.next.wait()
            # 再生終了後
            self.current = None
            finished_song = self.queue.popleft()  # 再生が終了した曲をキューから削除
            self.history.append(finished_song)    # 履歴に追加
            await self.notify_clients(self.guild_id)

    def download_song(self, song):
        try:
            info = ytdl.extract_info(song.url, download=False)
            if 'entries' in info:
                info = info['entries'][0]

            filename = ytdl.prepare_filename(info)
            if not os.path.exists(filename):
                ytdl.download([song.url])

            song.source = filename
            return song
        except yt_dlp.utils.DownloadError as e:
            print(f"ダウンロードエラー: {song.url}\n{e}")
            return None # ダウンロードエラー時はNoneを返す
        except Exception as e:
            print(f"予期せぬエラー: {song.url}\n{e}")
            return None # エラー時はNoneを返す

    def get_song_info(self, url):
        info = ytdl.extract_info(url, download=False)

        if 'entries' in info:
            return [self._get_single_song_info(entry) for entry in info['entries']]
        else:
            return [self._get_single_song_info(info)]

    def _get_single_song_info(self, info):
        title = info.get('title', 'Unknown Title')
        webpage_url = info.get('webpage_url', '')
        thumbnail = info.get('thumbnail', '')
        artist = info.get('uploader', 'Unknown Artist')
        return Song(None, title, webpage_url, thumbnail, artist)


    async def join_voice_channel(self, channel_id: str):
        channel = self.guild.get_channel(int(channel_id))
        if channel and channel.type.name == "voice":
            if self.voice_client and self.voice_client.channel.id == channel.id:
                # 既に同じチャンネルにいる場合は何もしない
                return
            elif self.voice_client:
                await self.voice_client.move_to(channel)
            else:
                self.voice_client = await channel.connect()
            await self.notify_clients(self.guild_id)
        else:
            raise ValueError("Invalid voice channel")

    async def add_to_queue(self, url):
        loop = asyncio.get_event_loop()
        songs = await loop.run_in_executor(self.executor, self.get_song_info, url)
        for song in songs:
            self.queue.append(song)
        await self.notify_clients(self.guild_id)
        if not self.voice_client.is_playing() and self.current is None:
            self.next.set()

    async def pause(self):
        if self.voice_client.is_playing():
            self.voice_client.pause()
            await self.notify_clients(self.guild_id)

    async def resume(self):
        if self.voice_client.is_paused():
            self.voice_client.resume()
            await self.notify_clients(self.guild_id)

    async def skip(self):
        if self.voice_client.is_playing():
            # 現在の曲を履歴に追加
            if self.current:
                self.history.append(self.current)
            self.voice_client.stop()
        await self.notify_clients(self.guild_id)

    async def previous(self):
        if self.history:
            # 現在の再生を停止
            if self.voice_client.is_playing():
                self.voice_client.stop()

            # 現在の曲をキューの先頭に戻す
            if self.current:
                self.queue.appendleft(self.current)

            # 履歴から前の曲を取得
            previous_song = self.history.pop()

            # 前の曲を現在の曲に設定
            self.current = previous_song

            # 曲がダウンロードされていない場合はダウンロード
            if previous_song.source is None:
                previous_song = await self.bot.loop.run_in_executor(self.executor, self.download_song, previous_song)
                self.current = previous_song  # ダウンロード後に再度設定

            # 前の曲を再生
            self.voice_client.play(discord.FFmpegPCMAudio(previous_song.source),
                                after=lambda _: self.bot.loop.call_soon_threadsafe(self.next.set))

            # クライアントに通知
            await self.notify_clients(self.guild_id)
        else:
            print("履歴に前の曲がありません。")

    async def reorder_queue(self, start_index: int, end_index: int):
        try:
            queue_list = list(self.queue)
            # 再生中の曲（インデックス0）を移動させない
            if start_index == 0 or end_index == 0:
                return
            item = queue_list.pop(start_index)
            queue_list.insert(end_index, item)
            self.queue = deque(queue_list)
        except IndexError:
            pass  # インデックスが範囲外の場合は無視

    def destroy(self):
        return self.bot.loop.create_task(self.voice_client.disconnect())

    def is_playing(self):
        return self.voice_client and self.voice_client.is_playing()
