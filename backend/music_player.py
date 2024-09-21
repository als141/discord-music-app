import asyncio
import os
import yt_dlp
import discord
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from collections import deque

MUSIC_DIR = "music"

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
    'source_address': '0.0.0.0'
}

ytdl = yt_dlp.YoutubeDL(ytdl_format_options)
guild_queues = defaultdict(asyncio.Queue)

class Song:
    def __init__(self, source, title, url, thumbnail):
        self.source = source
        self.title = title
        self.url = url
        self.thumbnail = thumbnail

class MusicPlayer:
    def __init__(self, bot, guild, guild_id, notify_clients):
        self.bot = bot
        self.guild = guild
        self.guild_id = guild_id
        self.notify_clients = notify_clients
        self.queue = deque()
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
            self.queue.popleft()  # 再生が終了した曲をキューから削除
            await self.notify_clients(self.guild_id)

    def download_song(self, song):
        info = ytdl.extract_info(song.url, download=False)
        if 'entries' in info:
            info = info['entries'][0]

        filename = ytdl.prepare_filename(info)
        if not os.path.exists(filename):
            ytdl.download([song.url])

        song.source = filename
        return song

    def get_song_info(self, url):
        info = ytdl.extract_info(url, download=False)
        if 'entries' in info:
            info = info['entries'][0]

        title = info.get('title', 'Unknown Title')
        webpage_url = info.get('webpage_url', url)
        thumbnail = info.get('thumbnail', '')

        return Song(None, title, webpage_url, thumbnail)

    async def add_to_queue(self, url):
        loop = asyncio.get_event_loop()
        song = await loop.run_in_executor(self.executor, self.get_song_info, url)
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
            self.voice_client.stop()
        await self.notify_clients(self.guild_id)

    async def previous(self):
        # 前の曲に戻る機能の実装（必要に応じて）
        pass

    async def reorder_queue(self, start_index: int, end_index: int):
        try:
            queue_list = list(self.queue)
            item = queue_list.pop(start_index)
            queue_list.insert(end_index, item)
            self.queue = deque(queue_list)
        except IndexError:
            pass  # インデックスが範囲外の場合は無視


    def destroy(self):
        return self.bot.loop.create_task(self.voice_client.disconnect())

    def is_playing(self):
        return self.voice_client and self.voice_client.is_playing()
