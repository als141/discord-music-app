# music_player.py

import asyncio
import os
import yt_dlp
import discord
from concurrent.futures import ThreadPoolExecutor
from collections import deque

MUSIC_DIR = "music"
OAUTH2_USERNAME = "oauth2"
OAUTH2_PASSWORD = ""

ytdl_format_options = {
    'format': 'bestaudio',
    'outtmpl': f'{MUSIC_DIR}/%(title)s-%(id)s.%(ext)s',
    'restrictfilenames': True,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0',
    'username': OAUTH2_USERNAME,
    'password': OAUTH2_PASSWORD,
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '192',
    }],
    # 以下を追加
    'extract_flat': False,
    'forceduration': True,
    'forcejson': True,
    'noplaylist': True,
    'ffmpeg_location': '/usr/bin/ffmpeg',  # FFmpegのパスを指定
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn'
}

ffmpeg_options = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -analyzeduration 0',
    'options': '-vn'  # シンプルに音声のみ取得
}

ytdl = yt_dlp.YoutubeDL(ytdl_format_options)

class Song:
    def __init__(self, source, title, url, thumbnail, artist, added_by=None):
        self.source = source   # 実際の再生に使うファイルパス
        self.title = title
        self.url = url         # YouTube等のURL あるいは ローカル絶対パス
        self.thumbnail = thumbnail
        self.artist = artist
        self.added_by = added_by

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
        self.executor = ThreadPoolExecutor(max_workers=3)

        # 非同期で音楽ループを回す
        self.bot.loop.create_task(self.player_loop())

    async def player_loop(self):
        await self.bot.wait_until_ready()
        while not self.bot.is_closed():
            self.next.clear()
            
            # voice_clientの状態確認と再接続処理
            if not self.voice_client or not self.voice_client.is_connected():
                print("Voice clientが接続されていません")
                await asyncio.sleep(1)
                continue

            if not self.queue:
                await self.next.wait()
                continue

            song = self.queue[0]
            if song.source is None:
                try:
                    song = await self.bot.loop.run_in_executor(self.executor, self.prepare_source, song)
                    self.queue[0] = song
                except Exception as e:
                    print(f"音源準備中にエラー: {e}")
                    self.queue.popleft()
                    continue

            self.current = song
            print(f"再生準備: {song.title} ({song.source})")  # デバッグ出力追加

            # 再生状態のチェックを修正
            if self.voice_client.is_playing():
                print("既に再生中です - 停止します")
                self.voice_client.stop()

            try:
                if not os.path.exists(song.source):
                    print(f"ファイルが見つかりません: {song.source}")
                    self.queue.popleft()
                    continue

                audio_source = discord.FFmpegPCMAudio(
                    song.source,
                    before_options='-analyzeduration 0',
                    options='-vn'
                )
                
                transformed_source = discord.PCMVolumeTransformer(audio_source, volume=1.0)
                
                if self.current:
                    self.history.append(self.current)
                
                print(f"再生開始: {song.title}")  # デバッグ出力追加
                self.voice_client.play(
                    transformed_source,
                    after=lambda e: self.bot.loop.call_soon_threadsafe(
                        lambda: self.play_next_song(e)
                    )
                )
                await self.notify_clients(self.guild_id)
                
            except Exception as e:
                print(f"再生エラー: {e}")
                import traceback
                traceback.print_exc()
                self.queue.popleft()
                continue

            await self.next.wait()

    # インデントを修正 - クラスメソッドとして正しく配置
    def play_next_song(self, error):
        if error:
            print(f"再生中にエラーが発生: {error}")
        # 再生が終了したら、キューから削除
        if self.queue:
            self.queue.popleft()
        self.next.set()

    def prepare_source(self, song: Song) -> Song:
        try:
            if self.is_local_path(song.url):
                if not os.path.exists(song.url):
                    raise FileNotFoundError(f"ファイルが存在しません: {song.url}")
                song.source = song.url
            else:
                info = ytdl.extract_info(song.url, download=True)  # Trueに変更
                if 'entries' in info:
                    info = info['entries'][0]
                filename = ytdl.prepare_filename(info)
                
                # 拡張子の確認と変更
                base, ext = os.path.splitext(filename)
                if ext != '.mp3':
                    filename = base + '.mp3'
                
                if not os.path.exists(filename):
                    print(f"ダウンロードされたファイルが見つかりません: {filename}")
                    raise FileNotFoundError
                    
                song.source = filename
                
            print(f"準備完了: {song.source}")  # デバッグ用
            return song
            
        except Exception as e:
            print(f"ソース準備エラー: {e}")
            raise

    def is_local_path(self, path: str) -> bool:
        return os.path.isabs(path)

    async def add_to_queue(self, url, added_by=None):
        loop = asyncio.get_event_loop()
        songs = await loop.run_in_executor(self.executor, self.get_song_info, url, added_by)
        for s in songs:
            self.queue.append(s)
        await self.notify_clients(self.guild_id)
        if self.voice_client and not self.voice_client.is_playing() and self.current is None:
            self.next.set()

    def get_song_info(self, url, added_by=None):
        if self.is_local_path(url):
            # 絶対パスの場合(アップロード済み)
            filename = os.path.basename(url)
            return [Song(
                source=None,
                title=filename,
                url=url,
                thumbnail="",
                artist="LocalFile",
                added_by=added_by
            )]
        else:
            # YouTube等
            info = ytdl.extract_info(url, download=False)
            if 'entries' in info:
                songs = []
                for entry in info['entries']:
                    if entry is None:
                        continue
                    songs.append(self.build_song(entry, added_by))
                return songs
            else:
                return [self.build_song(info, added_by)]

    def build_song(self, info, added_by=None):
        title = info.get('title', 'Unknown Title')
        webpage_url = info.get('webpage_url', '')
        thumbnail = info.get('thumbnail', '')
        artist = info.get('uploader', 'Unknown Artist')
        return Song(
            source=None,
            title=title,
            url=webpage_url,
            thumbnail=thumbnail,
            artist=artist,
            added_by=added_by
        )

    async def remove_from_queue(self, position: int):
        if 0 <= position < len(self.queue):
            queue_list = list(self.queue)
            del queue_list[position]
            self.queue = deque(queue_list)

    async def pause(self):
        if self.voice_client and self.voice_client.is_playing():
            self.voice_client.pause()
            await self.notify_clients(self.guild_id)

    async def resume(self):
        if self.voice_client and self.voice_client.is_paused():
            self.voice_client.resume()
            await self.notify_clients(self.guild_id)

    async def skip(self):
        if self.voice_client and self.voice_client.is_playing():
            self.voice_client.stop()
        await self.notify_clients(self.guild_id)

    async def previous(self):
        if self.history:
            if self.voice_client and self.voice_client.is_playing():
                self.voice_client.stop()
            if self.current:
                self.queue.appendleft(self.current)

            prev_song = self.history.pop()
            self.current = prev_song

            if prev_song.source is None:
                prev_song = self.prepare_source(prev_song)
                self.current = prev_song

            if self.voice_client:
                self.voice_client.play(
                    discord.FFmpegPCMAudio(prev_song.source),
                    after=lambda _: self.bot.loop.call_soon_threadsafe(self.next.set)
                )
            await self.notify_clients(self.guild_id)

    async def reorder_queue(self, start_index: int, end_index: int):
        if 0 <= start_index < len(self.queue) and 0 <= end_index < len(self.queue):
            queue_list = list(self.queue)
            item = queue_list.pop(start_index)
            queue_list.insert(end_index, item)
            self.queue = deque(queue_list)

    def is_playing(self):
        return bool(self.voice_client and self.voice_client.is_playing())

    def destroy(self):
        if self.voice_client:
            return self.bot.loop.create_task(self.voice_client.disconnect())
