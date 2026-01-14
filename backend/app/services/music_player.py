import asyncio
import os
import yt_dlp
import discord
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from typing import Optional, List, Callable, Any
from dataclasses import dataclass

from ..config import get_settings
from ..logging import get_logger

# 設定を取得
settings = get_settings()

# ロガーを設定
logger = get_logger(__name__)

def get_ytdl_format_options() -> dict:
    """
    yt-dlp の設定オプションを取得

    注意: JavaScriptランタイム（deno）をインストールすることで
    YouTube署名解読が高速化され、警告が解消されます。
    インストール方法: https://deno.com/ または apt/brew等で deno をインストール
    """
    # フォーマット選択: 確実に取得できるようにフォールバックを多く設定
    # 139: 低品質AAC (48k) - 常に利用可能
    # bestaudio: 最高品質オーディオ
    format_string = 'bestaudio/best/139'

    options = {
        'format': format_string,
        'outtmpl': f'{settings.music.directory}/%(title)s-%(id)s.%(ext)s',
        'restrictfilenames': True,
        'nocheckcertificate': True,
        'ignoreerrors': False,  # エラーを検出するためFalseに
        'no_warnings': True,  # 既知の警告（SABR等）を抑制
        'default_search': 'auto',
        'source_address': '0.0.0.0',
        'retries': 5,
        'fragment_retries': 5,
        'socket_timeout': 60,
        'extractor_retries': 5,
        # ログ出力を抑制（本番環境向け）
        'quiet': True,
        'verbose': False,
        # プログレス表示を無効化（サーバー環境向け）
        'noprogress': True,
        # プレイリスト処理を無効化（単一動画のみ）
        'noplaylist': True,
    }

    # YouTube認証用クッキーファイル（環境変数COOKIES_FILEで設定）
    cookies_path = settings.music.cookies_file
    logger.info(f"COOKIES_FILE env value: '{cookies_path}'")
    if cookies_path:
        actual_cookies_path = None

        if os.path.isfile(cookies_path):
            # 直接ファイルが指定された場合
            actual_cookies_path = cookies_path
        elif os.path.isdir(cookies_path):
            # ディレクトリの場合（Cloud Run Secret Manager）
            # ディレクトリ内のファイルを探す
            for filename in os.listdir(cookies_path):
                file_path = os.path.join(cookies_path, filename)
                if os.path.isfile(file_path):
                    actual_cookies_path = file_path
                    break

        if actual_cookies_path:
            options['cookiefile'] = actual_cookies_path
            logger.info(f"YouTube cookies file loaded: {actual_cookies_path}")
        else:
            logger.warning(f"Cookies file NOT FOUND at: {cookies_path}")
    else:
        logger.info("COOKIES_FILE not set, skipping cookies authentication")

    return options

def get_ffmpeg_options(is_local_file: bool = False) -> dict:
    """FFmpeg の設定オプションを取得"""
    if is_local_file:
        # ローカルファイル用のオプション（reconnectオプションは不要）
        return {
            'before_options': '-analyzeduration 0',
            'options': '-vn'
        }
    else:
        # ストリーミング用のオプション
        return {
            'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -analyzeduration 0',
            'options': '-vn'
        }

# yt-dlp インスタンス（遅延初期化）
_ytdl_instance = None

def get_ytdl():
    """yt-dlpインスタンスを遅延初期化して取得"""
    global _ytdl_instance
    if _ytdl_instance is None:
        options = get_ytdl_format_options()
        _ytdl_instance = yt_dlp.YoutubeDL(options)
        # 起動時に必ず出力
        print(f"[STARTUP] yt-dlp initialized with cookiefile: {options.get('cookiefile', 'NOT SET')}")
    return _ytdl_instance

# 後方互換性のための定数
MUSIC_DIR = settings.music.directory
OAUTH2_USERNAME = settings.music.oauth2_username
OAUTH2_PASSWORD = settings.music.oauth2_password

@dataclass
class Song:
    """音楽トラックを表すデータクラス"""
    source: Optional[str]  # 実際の再生に使うファイルパス
    title: str
    url: str  # YouTube等のURL、またはローカル絶対パス
    thumbnail: str
    artist: str
    added_by: Optional[Any] = None  # User オブジェクトまたは None
    video_id: Optional[str] = None  # YouTubeのビデオID（キャッシュ検索用）

    def __post_init__(self):
        # デフォルト値の設定
        if not self.title:
            self.title = "Unknown Title"
        if not self.artist:
            self.artist = "Unknown Artist"
        if not self.thumbnail:
            self.thumbnail = ""

class MusicPlayer:
    """音楽プレイヤークラス"""

    def __init__(self, bot, guild, guild_id: str, notify_clients: Callable):
        self.bot = bot
        self.guild = guild
        self.guild_id = guild_id
        self.notify_clients = notify_clients

        self.queue: deque[Song] = deque()
        self.history: deque[Song] = deque()
        self.next = asyncio.Event()
        self.current: Optional[Song] = None
        self.volume: float = 1.0  # ボリューム（0.0 - 1.0）

        self.voice_client = guild.voice_client
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.shutdown_flag = False  # シャットダウンフラグ

        # 状態バージョン管理（フロントエンドとの同期用）
        self.state_version: int = 0

        logger.info(f"音楽プレイヤーを初期化 (Guild: {guild.name}, ID: {guild_id})")
        
        # 非同期で音楽ループを開始
        self.bot.loop.create_task(self.player_loop())

    async def player_loop(self):
        """メインの音楽再生ループ"""
        await self.bot.wait_until_ready()
        logger.info(f"音楽プレイヤーループを開始 (Guild: {self.guild_id})")

        consecutive_errors = 0  # 連続エラーカウンター
        max_consecutive_errors = 5  # 連続エラー上限

        while not self.bot.is_closed() and not self.shutdown_flag:
            self.next.clear()

            # Voice client の状態確認
            # guild.voice_client から最新の参照を取得
            if self.guild.voice_client:
                self.voice_client = self.guild.voice_client

            if not self.voice_client or not self.voice_client.is_connected():
                logger.warning("Voice clientが接続されていません")
                # 接続待機（最大30秒）
                for _ in range(30):
                    await asyncio.sleep(1)
                    if self.guild.voice_client and self.guild.voice_client.is_connected():
                        self.voice_client = self.guild.voice_client
                        logger.info("Voice client接続を検出")
                        break
                    if self.shutdown_flag:
                        break
                continue

            if not self.queue:
                await self.next.wait()
                continue

            song = self.queue[0]
            if song.source is None:
                try:
                    logger.debug(f"音源を準備中: {song.title}")
                    song = await self.bot.loop.run_in_executor(self.executor, self.prepare_source, song)
                    self.queue[0] = song
                    consecutive_errors = 0  # 成功したらリセット
                except Exception as e:
                    logger.error(f"音源準備中にエラー: {e}", exc_info=True)
                    consecutive_errors += 1
                    if consecutive_errors >= max_consecutive_errors:
                        logger.error(f"連続エラー上限 ({max_consecutive_errors}) に達しました。一時停止します。")
                        await asyncio.sleep(10)  # 10秒待機
                        consecutive_errors = 0
                    self.queue.popleft()
                    await self.notify_clients(self.guild_id)
                    continue

            self.current = song
            logger.info(f"再生準備: {song.title} ({song.source})")

            if self.voice_client.is_playing():
                logger.debug("既に再生中 - 停止します")
                self.voice_client.stop()

            try:
                # ファイルパスの絶対パス化
                source_path = song.source
                if not source_path.startswith(('http://', 'https://')) and not os.path.isabs(source_path):
                    source_path = os.path.abspath(source_path)
                
                # ローカルファイルの存在確認
                if not source_path.startswith(('http://', 'https://')) and not os.path.exists(source_path):
                    logger.error(f"ファイルが見つかりません: {source_path}")
                    self.queue.popleft()
                    continue

                # ローカルファイルかどうかを判定
                is_local = not source_path.startswith(('http://', 'https://'))
                ffmpeg_opts = get_ffmpeg_options(is_local_file=is_local)
                audio_source = discord.FFmpegPCMAudio(
                    source_path,
                    before_options=ffmpeg_opts['before_options'],
                    options=ffmpeg_opts['options']
                )
                
                transformed_source = discord.PCMVolumeTransformer(audio_source, volume=self.volume)
                
                if self.current:
                    self.history.append(self.current)
                
                logger.info(f"再生開始: {song.title}")
                self.voice_client.play(
                    transformed_source,
                    after=lambda e: self.bot.loop.call_soon_threadsafe(
                        lambda: self.play_next_song(e)
                    )
                )
                await self.notify_clients(self.guild_id)
            except Exception as e:
                logger.error(f"再生エラー: {e}", exc_info=True)
                self.queue.popleft()
                continue

            await self.next.wait()

        logger.info(f"音楽プレイヤーループを終了 (Guild: {self.guild_id})")

    def play_next_song(self, error):
        """次の曲を再生する"""
        if error:
            logger.error(f"再生中にエラーが発生: {error}")
        if self.queue:
            self.queue.popleft()
        # 再生終了時に現在の曲をリセットする
        self.current = None
        self.bot.loop.create_task(self.notify_clients_wrapper())
        self.next.set()

    async def notify_clients_wrapper(self):
        """クライアント通知のラッパー"""
        await self.notify_clients(self.guild_id)

    async def set_volume(self, volume: float):
        """ボリュームを設定する（0.0 - 1.0）"""
        if not 0.0 <= volume <= 1.0:
            raise ValueError("Volume must be between 0.0 and 1.0")
        
        self.volume = volume
        
        # 現在再生中の場合はボリュームを即座に適用
        if self.voice_client and hasattr(self.voice_client.source, 'volume'):
            self.voice_client.source.volume = volume
        
        await self.notify_clients(self.guild_id)
        logger.info(f"ボリュームを{int(volume * 100)}%に設定しました (Guild: {self.guild_id})")

    def get_volume(self) -> float:
        """現在のボリュームを取得する"""
        return self.volume

    def prepare_source(self, song: Song, max_retries: int = 3) -> Song:
        """音楽ソースを準備する（リトライ機能付き）"""
        import glob as glob_module
        last_error = None

        for attempt in range(max_retries):
            try:
                if self.is_local_path(song.url):
                    if not os.path.exists(song.url):
                        raise FileNotFoundError(f"ファイルが存在しません: {song.url}")
                    song.source = song.url
                    logger.debug(f"ローカルファイルを使用: {song.url}")
                else:
                    if attempt > 0:
                        logger.info(f"ダウンロードリトライ ({attempt + 1}/{max_retries}): {song.title}")

                    # キャッシュチェック: video_idを使ってファイルを検索（extract_info不要）
                    if song.video_id:
                        cache_pattern = os.path.join(
                            settings.music.directory,
                            f"*-{song.video_id}.*"
                        )
                        cached_files = glob_module.glob(cache_pattern)
                        if cached_files:
                            # 最新のキャッシュファイルを使用
                            cached_file = cached_files[0]
                            logger.info(f"キャッシュを使用: {cached_file}")
                            song.source = cached_file
                            return song

                    logger.debug(f"音楽をダウンロード中: {song.title} ({song.url})")

                    # ダウンロード実行（1回のextract_info呼び出しのみ）
                    info = get_ytdl().extract_info(song.url, download=True)
                    if info is None:
                        raise Exception("動画情報の取得に失敗しました")

                    if 'entries' in info:
                        info = info['entries'][0] if info['entries'] else None
                        if info is None:
                            raise Exception("プレイリストに有効な動画がありません")

                    # 元のファイル名をそのまま使用（拡張子変換なし）
                    filename = get_ytdl().prepare_filename(info)

                    if not os.path.exists(filename):
                        logger.error(f"ダウンロードされたファイルが見つかりません: {filename}")
                        raise FileNotFoundError(f"ダウンロードされたファイルが見つかりません: {filename}")

                    song.source = filename

                logger.debug(f"音源準備完了: {song.source}")
                return song

            except Exception as e:
                last_error = e
                logger.warning(f"ソース準備エラー (試行 {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    import time
                    time.sleep(2 ** attempt)  # 指数バックオフ: 1秒, 2秒, 4秒...

        logger.error(f"ソース準備に{max_retries}回失敗しました: {last_error}", exc_info=True)
        raise last_error

    def is_local_path(self, path: str) -> bool:
        """パスがローカルファイルパスかどうか判定する"""
        return os.path.isabs(path)

    async def add_to_queue(self, url: str, added_by=None) -> None:
        """楽曲をキューに追加する"""
        loop = asyncio.get_event_loop()
        songs = await loop.run_in_executor(self.executor, self.get_song_info, url, added_by)
        for s in songs:
            self.queue.append(s)
        await self.notify_clients(self.guild_id)
        # 再生中でなければ必ず再生ループを再開する
        if self.voice_client and not self.voice_client.is_playing():
            self.next.set()

    def get_song_info(self, url: str, added_by=None) -> List[Song]:
        """URLから楽曲情報を取得する"""
        logger.info(f"楽曲情報を取得中: {url}")

        # 検索用URLの場合、"ytsearch:"スキームを"ytsearch1:"に置換する
        if url.startswith("ytsearch:"):
            # "ytsearch:"の場合、結果数が1件になるように変更
            if not url.startswith("ytsearch1:"):
                url = "ytsearch1:" + url[len("ytsearch:"):]
            try:
                search_result = get_ytdl().extract_info(url, download=False)
                if search_result is None:
                    raise Exception(f"検索結果が取得できません: {url}")
                if 'entries' in search_result and search_result['entries']:
                    info = search_result['entries'][0]
                    if info is None:
                        raise Exception("検索結果のエントリが無効です")
                else:
                    raise Exception("検索結果が見つかりません")
                return [self.build_song(info, added_by)]
            except Exception as e:
                logger.error(f"検索エラー: {e}", exc_info=True)
                raise

        # 通常の処理
        if self.is_local_path(url):
            filename = os.path.basename(url)
            return [Song(
                source=None,
                title=filename,
                url=url,
                thumbnail="",
                artist="LocalFile",
                added_by=added_by
            )]

        # YouTube/外部URLの処理
        try:
            logger.debug(f"yt-dlpで情報を取得中: {url}")
            info = get_ytdl().extract_info(url, download=False)

            if info is None:
                logger.error(f"yt-dlpがNoneを返しました: {url}")
                raise Exception(f"動画情報の取得に失敗しました: {url}")

            # プレイリストの場合
            if 'entries' in info:
                songs = []
                entries = info.get('entries', [])
                if not entries:
                    raise Exception("プレイリストに有効なエントリがありません")

                for entry in entries:
                    if entry is None:
                        logger.warning("プレイリスト内の無効なエントリをスキップ")
                        continue
                    try:
                        songs.append(self.build_song(entry, added_by))
                    except Exception as e:
                        logger.warning(f"エントリの処理に失敗: {e}")
                        continue

                if not songs:
                    raise Exception("プレイリストから有効な曲を取得できませんでした")

                logger.info(f"プレイリストから {len(songs)} 曲を取得")
                return songs
            else:
                # 単一の動画
                logger.info(f"単一動画を取得: {info.get('title', 'Unknown')}")
                return [self.build_song(info, added_by)]

        except yt_dlp.utils.DownloadError as e:
            logger.error(f"yt-dlp ダウンロードエラー: {e}", exc_info=True)
            raise Exception(f"動画のダウンロードに失敗しました: {str(e)}")
        except Exception as e:
            logger.error(f"楽曲情報取得エラー: {e}", exc_info=True)
            raise

    def build_song(self, info: dict, added_by=None) -> Song:
        """yt-dlp の情報から Song オブジェクトを構築する"""
        title = info.get('title', 'Unknown Title')
        webpage_url = info.get('webpage_url', '')
        thumbnail = info.get('thumbnail', '')
        artist = info.get('uploader', 'Unknown Artist')
        video_id = info.get('id', '')  # YouTubeのビデオIDを保存
        return Song(
            source=None,
            title=title,
            url=webpage_url,
            thumbnail=thumbnail,
            artist=artist,
            added_by=added_by,
            video_id=video_id
        )

    async def remove_from_queue(self, position: int) -> None:
        """指定した位置のトラックをキューから削除する"""
        if 0 <= position < len(self.queue):
            queue_list = list(self.queue)
            del queue_list[position]
            self.queue = deque(queue_list)

    async def pause(self) -> None:
        """再生を一時停止する"""
        if self.voice_client and self.voice_client.is_playing():
            self.voice_client.pause()
            await self.notify_clients(self.guild_id)

    async def resume(self) -> None:
        """再生を再開する"""
        if self.voice_client and self.voice_client.is_paused():
            self.voice_client.resume()
            await self.notify_clients(self.guild_id)

    async def skip(self) -> None:
        """現在の曲をスキップする"""
        if self.voice_client and self.voice_client.is_playing():
            self.voice_client.stop()
        await self.notify_clients(self.guild_id)

    async def previous(self) -> bool:
        """前の曲に戻る"""
        if self.history:
            if self.voice_client and self.voice_client.is_playing():
                self.voice_client.stop()
            if self.current:
                self.queue.appendleft(self.current)
            prev_song = self.history.pop()
            self.current = prev_song
            if prev_song.source is None:
                prev_song = await self.bot.loop.run_in_executor(
                    self.executor, self.prepare_source, prev_song
                )
                self.current = prev_song
            if self.voice_client:
                # ファイルパスの絶対パス化
                source_path = prev_song.source
                if not source_path.startswith(('http://', 'https://')) and not os.path.isabs(source_path):
                    source_path = os.path.abspath(source_path)
                
                # ローカルファイルかどうかを判定
                is_local = not source_path.startswith(('http://', 'https://'))
                ffmpeg_opts = get_ffmpeg_options(is_local_file=is_local)
                audio_source = discord.FFmpegPCMAudio(
                    source_path,
                    before_options=ffmpeg_opts['before_options'],
                    options=ffmpeg_opts['options']
                )
                transformed_source = discord.PCMVolumeTransformer(audio_source, volume=self.volume)
                self.voice_client.play(
                    transformed_source,
                    after=lambda _: self.bot.loop.call_soon_threadsafe(self.next.set)
                )
            await self.notify_clients(self.guild_id)
            return True
        return False

    async def reorder_queue(self, start_index: int, end_index: int) -> None:
        """キューの順序を変更する"""
        if 0 <= start_index < len(self.queue) and 0 <= end_index < len(self.queue):
            queue_list = list(self.queue)
            item = queue_list.pop(start_index)
            queue_list.insert(end_index, item)
            self.queue = deque(queue_list)

    def is_playing(self) -> bool:
        """現在再生中かどうかを返す"""
        return bool(self.voice_client and self.voice_client.is_playing())

    def increment_version(self) -> int:
        """状態バージョンをインクリメントして返す"""
        self.state_version += 1
        return self.state_version

    def get_version(self) -> int:
        """現在の状態バージョンを返す"""
        return self.state_version

    async def shutdown(self):
        """プレイヤーを適切にシャットダウンする"""
        try:
            logger.info(f"音楽プレイヤーをシャットダウン中 (Guild: {self.guild_id})")
            
            # 再生停止
            if self.voice_client and self.voice_client.is_playing():
                self.voice_client.stop()
            
            # プレイヤーループを停止
            self.shutdown_flag = True
            self.next.set()  # ループを終了させる
            
            # Executor をシャットダウン
            if self.executor:
                self.executor.shutdown(wait=False)
            
            # ボイスクライアントを切断
            if self.voice_client:
                await self.voice_client.disconnect()
            
            logger.info(f"音楽プレイヤーのシャットダウン完了 (Guild: {self.guild_id})")
            
        except Exception as e:
            logger.error(f"音楽プレイヤーのシャットダウン中にエラー (Guild: {self.guild_id}): {e}")

    def destroy(self):
        """プレイヤーを破棄し、ボイスクライアントを切断する"""
        if self.voice_client:
            return self.bot.loop.create_task(self.voice_client.disconnect())