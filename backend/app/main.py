# main.py
from fastapi import FastAPI, HTTPException, Request, Form, File, UploadFile
import uuid
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict
import asyncio
import json
from .bot import client, music_players
from .api import voice_proxy
from .api.voice import router as voice_router, active_connections
from .services.history import load_history_queue_items
from .schemas import (
    User, Track, QueueItem, SearchItem, SearchResult, Server, VoiceChannel,
    AddUrlRequest, PlayTrackRequest, ReorderRequest, SongResponse
)
import yt_dlp
import uvicorn
from fastapi.encoders import jsonable_encoder
from dotenv import load_dotenv
import os
from ytmusicapi import YTMusic
from discord import utils
from .api import chat
import aiofiles
from .api.valorant import router as valorant_router
import re
from datetime import datetime, timedelta
import signal
from .api.realtime import router as realtime_router
from .db import (
    init_db, UploadedSong, add_uploaded_song, get_uploaded_songs_in_guild, find_uploaded_song_by_id,
    update_uploaded_song, delete_uploaded_song, get_top_tracks, get_history_stats,
    clear_player_state,
)
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles  # ← 追加

# ytmusicapi >= 1.12 は language='ja' だと filter 付き search が空配列になる
# （カテゴリ見出し "曲" と "song" を照合するため）。検索/関連曲/詳細取得は en 固定にし、
# UI 見出しが日本語で欲しい get_home / mood 系だけ ja インスタンスを使う。
# タイトル・アーティスト名自体は言語設定に関係なく原語で返る。
ytmusic = YTMusic(language='en', location='JP')
ytmusic_ja = YTMusic(language='ja', location='JP')


def _build_ytmusic_personal():
    """yt-dlp 用の cookies.txt（YouTube アカウントのログイン cookie）から、
    ytmusicapi のブラウザ認証インスタンスを作る。無ければ/壊れていれば None（公開ホームにフォールバック）。

    ホームの「おすすめ」「毎日のおすすめ」等の個人化セクションはログイン状態でしか出ないため。
    読み取り専用でしか使わない（高評価/登録などの書き込み API は呼ばない）。
    """
    import http.cookiejar
    from .config import COOKIES_FILE
    path = COOKIES_FILE
    if not path or not os.path.exists(path):
        return None
    try:
        cj = http.cookiejar.MozillaCookieJar(path)
        cj.load(ignore_discard=True, ignore_expires=True)
        cookies = {c.name: c.value for c in cj if 'youtube.com' in c.domain}
        if 'SAPISID' not in cookies and '__Secure-3PAPISID' not in cookies:
            print("[ytmusic personal] cookies に SAPISID が無いため個人化は無効")
            return None
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
            'Accept': '*/*', 'Accept-Language': 'ja-JP,ja;q=0.9', 'Content-Type': 'application/json',
            'X-Goog-AuthUser': '0', 'x-origin': 'https://music.youtube.com',
            'Cookie': '; '.join(f'{k}={v}' for k, v in cookies.items()),
            'Authorization': 'SAPISIDHASH placeholder',  # 実際の値は ytmusicapi が SAPISID から毎回生成する
        }
        inst = YTMusic(auth=json.dumps(headers), language='ja', location='JP')
        print("[ytmusic personal] cookies.txt からログイン済みインスタンスを作成")
        return inst
    except Exception as e:
        print(f"[ytmusic personal] 初期化失敗（公開ホームにフォールバック）: {type(e).__name__}: {e}")
        return None


ytmusic_personal = _build_ytmusic_personal()

# ホームに出す個人化セクション（YouTube Music の見出し名でホワイトリスト。履歴系は出さない）
HOME_PERSONAL_SECTIONS = ['おすすめ', '新作', 'おすすめの話題の曲', '毎日のおすすめ', 'おすすめのアルバム', 'おすすめのミュージック ビデオ', 'おすすめのミックス']
# 公開（未ログイン）ホームから常に出すセクション
HOME_PUBLIC_SECTIONS = ['新作']

# アルバム種別の正規化（ロケール依存の表記 → frontend が期待する 'album'/'single'/'ep'）
_ALBUM_TYPE_MAP = {
    'album': 'album', 'アルバム': 'album',
    'single': 'single', 'シングル': 'single',
    'ep': 'ep',
}

def _normalize_album_type(raw) -> str:
    if not raw:
        return 'album'
    return _ALBUM_TYPE_MAP.get(str(raw).strip().lower(), 'album')

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")

# プロセスの役割（無停止アップデート②）
#   all   : 従来どおり 1 プロセスで bot + 公開 API（既定。ローカル開発）
#   voice : Discord bot + MusicPlayer を持つ内部プロセス（Pi では 127.0.0.1:8081）
#   web   : 公開 API（Pi では :8080）。bot は起動せず、bot 依存ルートは voice へ中継する
#   （web だけに関わる変更は deploy.sh が web プロセスだけ再起動する＝再生中の音楽は止まらない）
IRINA_ROLE = (os.getenv("IRINA_ROLE") or "all").strip().lower()
if IRINA_ROLE not in ("all", "voice", "web"):
    raise RuntimeError(f"IRINA_ROLE は all / voice / web のいずれか: {IRINA_ROLE!r}")

class _WebRole(Exception):
    """lifespan 内で bot 起動をスキップするための内部例外"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    # アプリケーション起動時の処理
    print("アプリケーションを起動します...")
    
    # 背景タスクを管理するセット
    background_tasks = set()
    
    try:
        init_db()  # テーブルが無ければ作る
        print("データベースの初期化が完了しました。")
    except Exception as e:
        print(f"データベースの初期化中にエラーが発生しました: {e}")
        raise
    
    # Discordボットをバックグラウンドタスクとして起動（web ロールは起動しない）
    discord_task = None
    try:
        if IRINA_ROLE == "web":
            raise _WebRole()
        from .config import get_settings
        settings = get_settings()
        if hasattr(settings, 'discord') and hasattr(settings.discord, 'token'):
            discord_task = asyncio.create_task(client.start(settings.discord.token))
            background_tasks.add(discord_task)
            # タスクが完了したらセットから削除
            discord_task.add_done_callback(background_tasks.discard)
            print("Discordボットの起動タスクを開始しました。")
        else:
            print("Discord設定が見つかりません。環境変数DISCORD_TOKENを確認してください。")
    except _WebRole:
        print(f"IRINA_ROLE=web: Discord bot は起動しません。bot 依存ルートは {voice_proxy.VOICE_UPSTREAM} へ中継します。")
    except Exception as e:
        print(f"Discordボットの起動中にエラーが発生しました: {e}")
        print("Discordボット無しでWebAPIサーバーのみ起動します。")
    
    # アプリケーションで背景タスクを管理できるように設定
    app.state.background_tasks = background_tasks
    
    yield
    
    # アプリケーション終了時の処理
    print("アプリケーションをシャットダウンします...")

    if IRINA_ROLE == "web":
        await voice_proxy.close_sessions()

    # デプロイ跨ぎのレジューム: 全ギルドのキュー・再生位置を保存してから落ちる。
    # 先に shutdown_flag を立て、ffmpeg 強制終了の after コールバックが状態を壊すのを防ぐ
    for _gid, _pl in list(music_players.items()):
        _pl.shutdown_flag = True
    saved = 0
    for gid, player in list(music_players.items()):
        try:
            player._save_state_sync(force=True)
            player.freeze_state()  # この後の voice teardown で上書きされないように
            saved += 1
        except Exception as e:
            print(f"状態保存に失敗 (guild: {gid}): {e}")
    if saved:
        print(f"{saved}ギルドのプレイヤー状態を保存しました（再起動後にレジュームします）")

    try:
        # すべての背景タスクをキャンセル
        if background_tasks:
            print(f"{len(background_tasks)}個の背景タスクをキャンセルします...")
            for task in list(background_tasks):
                if not task.done():
                    task.cancel()
            
            # すべてのタスクが完了するまで短時間待機
            if background_tasks:
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(*background_tasks, return_exceptions=True),
                        timeout=3.0
                    )
                    cancelled_count = sum(1 for r in results if isinstance(r, asyncio.CancelledError))
                    print(f"{cancelled_count}個のタスクが正常にキャンセルされました。")
                except asyncio.TimeoutError:
                    print("一部のタスクが時間内に終了しませんでした。")
                except Exception as e:
                    print(f"タスク終了中にエラー: {e}")
        
        # Discordクライアントを明示的に閉じる
        if IRINA_ROLE != "web" and not client.is_closed():
            await asyncio.wait_for(client.close(), timeout=2.0)
        print("Discordボットを停止しました。")
        
        # 音楽プレイヤーをシャットダウン
        if music_players:
            print("音楽プレイヤーをシャットダウンします...")
            for guild_id, player in list(music_players.items()):
                try:
                    await player.shutdown()
                except Exception as e:
                    print(f"音楽プレイヤーのシャットダウンエラー (guild: {guild_id}): {e}")
            music_players.clear()
        
        # WebSocket接続をクリーンアップ
        if active_connections:
            print("WebSocket接続をクリーンアップします...")
            for guild_id, connections in list(active_connections.items()):
                for connection in list(connections):
                    try:
                        await connection.close()
                    except Exception:
                        pass
            active_connections.clear()
        
        print("シャットダウンが完了しました。")
        
    except Exception as e:
        print(f"シャットダウン中にエラーが発生しました: {e}")

app = FastAPI(lifespan=lifespan)

# ここでアップロード先ディレクトリを静的ファイルとして公開する
UPLOAD_DIR = "uploaded_music"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploaded_music", StaticFiles(directory=UPLOAD_DIR), name="uploaded_music")  # ← 追加

origins = [
    "http://localhost:3000",
    "https://discord-music-app.vercel.app",
    "https://api.atoriba.jp",
    "http://localhost:8000",
]

# キャッシュ用の変数を定義
recommendations_cache = None
recommendations_cache_timestamp = None
CACHE_DURATION = timedelta(hours=1)  # キャッシュの有効期間（個人化ホームは日替わりなので短め）

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # フロントエンドのURLを許可
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ヘルスチェック用ルートエンドポイント
@app.get("/")
async def health_check():
    info = {"status": "ok", "role": IRINA_ROLE}
    if IRINA_ROLE == "web":
        info["voice"] = await voice_proxy.upstream_health()
    return info

# ルーターを追加
app.include_router(chat.router)
app.include_router(valorant_router)
app.include_router(realtime_router)

# bot 依存ルート（api/voice.py）: voice/all はそのまま、web は voice プロセスへの中継ルートに差し替える
if IRINA_ROLE == "web":
    app.include_router(voice_proxy.build_proxy_router(voice_router))
else:
    app.include_router(voice_router)


def extract_artist_id(artist_data):
    # 'id' や 'browseId' を試して取得
    return artist_data.get('id') or artist_data.get('browseId') or None

@app.post("/upload-audio/{guild_id}")
async def upload_audio(
    guild_id: str,
    user_id: str = Form(...),
    user_name: str = Form(...),
    title: str = Form(...),
    artist: str = Form(...),
    audio_file: UploadFile = File(...),
    thumbnail_file: UploadFile = File(None),
):
    # 音声ファイルの拡張子チェック
    allowed_audio_extensions = ["mp3", "wav", "flac", "aac", "m4a"]
    audio_ext = audio_file.filename.split(".")[-1].lower()
    if audio_ext not in allowed_audio_extensions:
        raise HTTPException(status_code=400, detail="対応外の音声形式です。")

    # ユニークIDで保存ファイル名作成
    audio_id = str(uuid.uuid4())
    safe_audio_filename = f"{audio_id}.{audio_ext}"
    audio_path = os.path.join(UPLOAD_DIR, safe_audio_filename)
    full_audio_path = os.path.abspath(audio_path)

    # 音声ファイル保存
    try:
        async with aiofiles.open(audio_path, 'wb') as out_file:
            content = await audio_file.read()
            await out_file.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"音声ファイル保存失敗: {e}")

    # サムネイルファイルの処理
    thumb_filename = ""
    if thumbnail_file:
        thumb_ext = thumbnail_file.filename.split(".")[-1].lower()
        allowed_thumb_exts = ["jpg","jpeg","png","gif"]
        if thumb_ext not in allowed_thumb_exts:
            raise HTTPException(status_code=400, detail="サムネイルの拡張子が無効です。")
        safe_thumb_filename = f"{audio_id}.{thumb_ext}"
        thumb_path = os.path.join(UPLOAD_DIR, safe_thumb_filename)
        try:
            async with aiofiles.open(thumb_path, 'wb') as out_file:
                thumb_content = await thumbnail_file.read()
                await out_file.write(thumb_content)
            thumb_filename = safe_thumb_filename
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"サムネイル保存失敗: {e}")
    # DB登録
    new_song = UploadedSong(
        id=audio_id,
        guild_id=guild_id,
        title=title,
        artist=artist,
        filename=safe_audio_filename,
        thumbnail_filename=thumb_filename,
        uploader_id=user_id,
        uploader_name=user_name,
        full_path=full_audio_path,
    )
    add_uploaded_song(new_song)

    return {"message": "アップロード成功", "song": new_song}

@app.get("/uploaded-audio-list/{guild_id}", response_model=List[SongResponse])
async def get_uploaded_audio_list(guild_id: str):
    songs = get_uploaded_songs_in_guild(guild_id)
    return [SongResponse(**s.dict()) for s in songs]

@app.put("/uploaded-audio-edit/{guild_id}/{song_id}", response_model=SongResponse)
async def edit_uploaded_audio(
    guild_id: str,
    song_id: str,
    user_id: str = Form(...),
    title: str = Form(...),
    artist: str = Form(...),
):
    song = find_uploaded_song_by_id(guild_id, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="楽曲が見つかりません。")
    if song.uploader_id != user_id:
        raise HTTPException(status_code=403, detail="編集権限がありません。")

    song.title = title
    song.artist = artist
    update_uploaded_song(song)
    return SongResponse(**song.dict())

@app.delete("/uploaded-audio-delete/{guild_id}/{song_id}")
async def delete_uploaded_audio(guild_id: str, song_id: str, user_id: str):
    song = find_uploaded_song_by_id(guild_id, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="楽曲が存在しません。")
    if song.uploader_id != user_id:
        raise HTTPException(status_code=403, detail="削除権限がありません。")

    if os.path.exists(song.full_path):
        os.remove(song.full_path)
    thumb_abs = os.path.join(UPLOAD_DIR, song.thumbnail_filename)
    if song.thumbnail_filename and os.path.exists(thumb_abs):
        os.remove(thumb_abs)

    delete_uploaded_song(guild_id, song_id)
    return {"message": "削除成功"}


def _home_item_to_search_item(item: dict) -> Optional[SearchItem]:
    """ytmusicapi get_home のアイテムを SearchItem に変換（曲/動画・プレイリスト/ミックス・アルバム・アーティスト）"""
    thumbnail = item['thumbnails'][0]['url'] if item.get('thumbnails') else ""
    artists = [a.get('name') for a in (item.get('artists') or []) if isinstance(a, dict) and a.get('name')]
    if item.get('videoId'):
        artist_data = (item.get('artists') or [{}])[0]
        video_type = str(item.get('videoType') or '')
        return SearchItem(
            type='video' if ('OMV' in video_type or 'UGC' in video_type) else 'song',
            title=item.get('title') or 'Unknown',
            artist=', '.join(artists) or "Unknown Artist",
            thumbnail=adjust_thumbnail_size(thumbnail),
            url=f"https://music.youtube.com/watch?v={item['videoId']}",
            artistId=extract_artist_id(artist_data) if isinstance(artist_data, dict) else None,
        )
    if item.get('playlistId'):
        author = item.get('author')
        if isinstance(author, list) and author:
            author_name = (author[0] or {}).get('name')
        elif isinstance(author, dict):
            author_name = author.get('name')
        else:
            author_name = None
        return SearchItem(
            type='playlist',
            title=item.get('title') or 'Unknown Playlist',
            artist=author_name or item.get('description') or 'YouTube Music',
            thumbnail=adjust_thumbnail_size(thumbnail),
            url=f"https://music.youtube.com/playlist?list={item['playlistId']}",
            browseId=item['playlistId'],
        )
    if item.get('browseId'):
        bid = str(item['browseId'])
        is_album = bid.startswith('MPRE') or bool(item.get('year')) or bool(item.get('type'))
        return SearchItem(
            type=_normalize_album_type(item.get('type')) if is_album else 'artist',
            title=item.get('title') or 'Unknown',
            artist=', '.join(artists) or ("Unknown Artist" if is_album else item.get('title') or ''),
            thumbnail=adjust_thumbnail_size(thumbnail),
            url=f"https://music.youtube.com/browse/{bid}",
            browseId=bid,
        )
    return None


def _convert_home_sections(home: list, allow: List[str]) -> List[dict]:
    """タイトルのホワイトリストに一致するセクションだけを allow の順で返す"""
    by_title = {}
    for section in home or []:
        title = section.get('title') or ''
        if title in allow and title not in by_title:
            contents = [x for x in (_home_item_to_search_item(i) for i in section.get('contents', [])) if x]
            if contents:
                by_title[title] = {"title": title, "contents": contents}
    return [by_title[t] for t in allow if t in by_title]


@app.get("/recommendations", response_model=List[dict])
async def get_recommendations():
    """ホームのおすすめ。
    公開ホームの「新作」 + （cookies が有効なら）ログイン済みホームの個人化セクション
    （おすすめ / 新作 / おすすめの話題の曲 / 毎日のおすすめ / おすすめのアルバム / おすすめのミュージック ビデオ / おすすめのミックス）。
    履歴が透ける「もう一度聴く」「最近聞いていないお気に入り」等は出さない。1時間キャッシュ。
    """
    global recommendations_cache, recommendations_cache_timestamp
    try:
        now = datetime.now()
        if recommendations_cache and recommendations_cache_timestamp:
            if now - recommendations_cache_timestamp < CACHE_DURATION:
                return recommendations_cache

        sections: List[dict] = []
        seen = set()

        def _add(secs):
            for sec in secs:
                if sec["title"] not in seen:
                    seen.add(sec["title"])
                    sections.append(sec)

        # 1) 個人化（あれば）
        if ytmusic_personal is not None:
            try:
                personal_home = await asyncio.to_thread(ytmusic_personal.get_home, 30)
                _add(_convert_home_sections(personal_home, HOME_PERSONAL_SECTIONS))
            except Exception as e:
                print(f"[recommendations] 個人化ホームの取得に失敗（公開のみで続行）: {type(e).__name__}: {e}")

        # 2) 公開ホーム（常に）。個人化が取れなかったときは公開の「おすすめ」も足して空にならないようにする
        public_home = await asyncio.to_thread(ytmusic_ja.get_home, 12)
        public_allow = list(HOME_PUBLIC_SECTIONS) + ([] if any(s["title"] == 'おすすめ' for s in sections) else ['おすすめ'])
        public_sections = _convert_home_sections(public_home, public_allow)
        # 「新作」は先頭に、公開「おすすめ」は末尾に
        for sec in public_sections:
            if sec["title"] == '新作' and '新作' not in seen:
                seen.add('新作'); sections.insert(0, sec)
        for sec in public_sections:
            if sec["title"] != '新作':
                _add([sec])

        recommendations_cache = sections
        recommendations_cache_timestamp = now
        return sections
    except Exception as e:
        print(f"おすすめの曲と動画の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mood-categories")
async def get_mood_categories():
    try:
        categories = ytmusic_ja.get_mood_categories()
        return categories
    except Exception as e:
        print(f"ムードカテゴリの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mood-playlists/{params}", response_model=List[SearchItem])
async def get_mood_playlists(params: str):
    try:
        playlists = ytmusic_ja.get_mood_playlists(params)
        search_items = []
        for playlist in playlists:
            playlist_url = f"https://music.youtube.com/playlist?list={playlist['playlistId']}"
            thumbnail = playlist['thumbnails'][0]['url'] if playlist.get('thumbnails') else ""
            search_items.append(
                SearchItem(
                    type='playlist',
                    title=playlist['title'],
                    artist=playlist.get('author', 'Unknown Artist'),
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=playlist_url,
                    browseId=playlist['playlistId']
                )
            )
        return search_items
    except Exception as e:
        print(f"ムードプレイリストの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/charts", response_model=SearchResult)
async def get_charts(country: str = 'JP'):
    try:
        charts = ytmusic.get_charts(country=country)
        search_items = []
        # YouTube 側の仕様変更で 'songs' が無く 'videos' のみになる場合がある（dict/list 両対応）
        def _items(section):
            if isinstance(section, dict):
                return section.get('items') or []
            return section if isinstance(section, list) else []
        chart_items = _items(charts.get('songs')) or _items(charts.get('videos'))
        for song in chart_items[:20]:
            video_url = f"https://music.youtube.com/watch?v={song['videoId']}" if 'videoId' in song else ""
            thumbnail = song['thumbnails'][0]['url'] if 'thumbnails' in song and song['thumbnails'] else ""
            artist_name = ', '.join([artist['name'] for artist in song.get('artists', [])]) or "Unknown Artist"
            search_items.append(
                SearchItem(
                    type='song',
                    title=song['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
        return SearchResult(results=search_items)
    except Exception as e:
        print(f"チャートの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/artist/{artist_id}")
async def get_artist_info(artist_id: str):
    try:
        artist = ytmusic.get_artist(artist_id)
        artist_info = {
            "name": artist.get('name', 'Unknown Artist'),
            "description": artist.get('description', ''),
            "views": artist.get('views', ''),
            "subscribers": artist.get('subscribers', ''),
            "channelId": artist.get('channelId', artist_id),
            "subscribed": artist.get('subscribed', False),
            "thumbnails": artist.get('thumbnails', []),
            "songs": artist.get('songs', {}).get('results', []),
            "albums": artist.get('albums', {}).get('results', []),
            "singles": artist.get('singles', {}).get('results', []),
            "videos": artist.get('videos', {}).get('results', []),
            "related": artist.get('related', {}).get('results', []),
        }
        for thumbnail in artist_info['thumbnails']:
            thumbnail['url'] = adjust_thumbnail_size(thumbnail.get('url', ''))
        return artist_info
    except Exception as e:
        print(f"アーティスト情報の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail="アーティスト情報の取得に失敗しました。")

@app.get("/related/{video_id}", response_model=SearchResult)
async def get_related_songs(video_id: str):
    try:
        related = await asyncio.to_thread(ytmusic.get_watch_playlist, videoId=video_id, limit=11)
        search_items = []
        # 先頭は再生中の曲自身。limit は上流で無視されることがあるので明示的に10件へ絞る
        for track in related.get('tracks', [])[1:11]:
            if track.get('videoId'):
                video_url = f"https://music.youtube.com/watch?v={track['videoId']}"
                thumbnail = track['thumbnail'][0]['url'] if 'thumbnail' in track and track['thumbnail'] else ""
                artist_name = ', '.join([artist['name'] for artist in track.get('artists', [])]) or "Unknown Artist"
                search_items.append(
                    SearchItem(
                        type='song',
                        title=track['title'],
                        artist=artist_name,
                        thumbnail=adjust_thumbnail_size(thumbnail),
                        url=video_url
                    )
                )
        return SearchResult(results=search_items)
    except Exception as e:
        print(f"関連動画の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/history/{guild_id}", response_model=List[QueueItem])
async def get_history(guild_id: str, limit: int = 50, user_id: Optional[str] = None):
    """サーバーごとの再生履歴（SQLite 永続化。bot 再起動をまたいで残る）。
    互換のため古い→新しい順で返す（frontend 側で reverse して表示している）。"""
    return await load_history_queue_items(guild_id, limit, user_id)


@app.get("/history-stats/{guild_id}")
async def get_history_stats_endpoint(guild_id: str, days: int = 30, top: int = 10):
    """サーバーごとの再生統計（期間内の再生数・よく流れた曲・よく入れた人）"""
    stats, top_tracks = await asyncio.gather(
        asyncio.to_thread(get_history_stats, guild_id, days),
        asyncio.to_thread(get_top_tracks, guild_id, days, top),
    )
    stats["top_tracks"] = top_tracks
    return stats

def adjust_thumbnail_size(thumbnail_url, width=400, height=400):
    """サムネイルURLのサイズを調整する"""
    if not thumbnail_url:
        return ''
    thumbnail_url = re.sub(r'w\d+-h\d+', f'w{width}-h{height}', thumbnail_url)
    return thumbnail_url

def _build_search_items(filter_type: str, results: list) -> list:
    """検索結果をSearchItemリストに変換する。全filterタイプに対応。"""
    items = []
    if filter_type == 'songs':
        for song in results:
            if 'videoId' not in song:
                continue
            video_url = f"https://music.youtube.com/watch?v={song['videoId']}"
            thumbnail = song['thumbnails'][0]['url'] if song.get('thumbnails') else ""
            artist_name = ', '.join([a['name'] for a in song.get('artists', []) if a.get('name')]) or "Unknown Artist"
            items.append(SearchItem(type='song', title=song.get('title') or 'Unknown', artist=artist_name, thumbnail=adjust_thumbnail_size(thumbnail), url=video_url))
    elif filter_type == 'videos':
        for video in results:
            if 'videoId' not in video:
                continue
            video_url = f"https://music.youtube.com/watch?v={video['videoId']}"
            thumbnail = video['thumbnails'][0]['url'] if video.get('thumbnails') else ""
            artist_name = ', '.join([a['name'] for a in video.get('artists', []) if a.get('name')]) or "Unknown Artist"
            items.append(SearchItem(type='video', title=video.get('title') or 'Unknown', artist=artist_name, thumbnail=adjust_thumbnail_size(thumbnail), url=video_url))
    elif filter_type == 'albums':
        for album in results:
            if 'browseId' not in album:
                continue
            browse_id = album['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = album['thumbnails'][0]['url'] if album.get('thumbnails') else ""
            artist_name = ', '.join([a['name'] for a in album.get('artists', []) if a.get('name')]) or "Unknown Artist"
            items.append(SearchItem(type=_normalize_album_type(album.get('type')), title=album.get('title') or 'Unknown Album', artist=artist_name, thumbnail=adjust_thumbnail_size(thumbnail), url=url, browseId=browse_id))
    elif filter_type == 'artists':
        for artist in results:
            if 'browseId' not in artist:
                continue
            browse_id = artist['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = artist['thumbnails'][0]['url'] if artist.get('thumbnails') else ""
            items.append(SearchItem(type='artist', title=artist.get('artist') or artist.get('title') or '', artist=artist.get('artist') or artist.get('title') or 'Unknown Artist', thumbnail=adjust_thumbnail_size(thumbnail), url=url, browseId=browse_id))
    elif filter_type == 'playlists':
        for playlist in results:
            if 'browseId' not in playlist:
                continue
            browse_id = playlist['browseId']
            url = f"https://music.youtube.com/playlist?list={browse_id.replace('VL', '')}"
            thumbnail = playlist['thumbnails'][0]['url'] if playlist.get('thumbnails') else ""
            items.append(SearchItem(type='playlist', title=playlist.get('title') or 'Unknown Playlist', artist=playlist.get('author') or 'Unknown Author', thumbnail=adjust_thumbnail_size(thumbnail), url=url, browseId=browse_id.replace('VL', '')))
    return items

@app.get("/search", response_model=SearchResult)
async def search(query: str, filter: str = None):
    async def fetch_results(filter_type: str):
        try:
            return await asyncio.to_thread(
                ytmusic.search,
                query,
                filter=filter_type,
                limit=10
            )
        except Exception as e:
            print(f"Error fetching {filter_type}: {e}")
            return []

    if filter:
        results = await fetch_results(filter)
        search_items = _build_search_items(filter, results)
        return SearchResult(results=search_items)
    else:
        results = await asyncio.gather(
            fetch_results('songs'),
            fetch_results('videos'),
            fetch_results('albums'),
            fetch_results('artists'),
            fetch_results('playlists')
        )

        filter_types = ['songs', 'videos', 'albums', 'artists', 'playlists']
        search_items = []
        for i, filter_type in enumerate(filter_types):
            search_items.extend(_build_search_items(filter_type, results[i]))
        return SearchResult(results=search_items)

@app.get("/playlist/{browse_id}", response_model=List[Track])
async def get_playlist_items(browse_id: str):
    try:
        # 「マイ ミックス」等（RDTMAK… / RD…）は個人化プレイリスト。未ログインで取ると別人向けの中身が返るので、
        # cookies のログイン済みインスタンスがあればそちらで取得する
        client_inst = ytmusic_personal if (browse_id.startswith('RD') and ytmusic_personal is not None) else ytmusic
        playlist = await asyncio.to_thread(client_inst.get_playlist, browse_id, 200)
        tracks = []
        for item in playlist.get('tracks', []):
            video_id = item.get('videoId')
            video_url = f"https://music.youtube.com/watch?v={video_id}" if video_id else ""
            thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
            artist_name = item['artists'][0]['name'] if 'artists' in item and item['artists'] else "Unknown Artist"
            tracks.append(
                Track(
                    title=item['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
        return tracks
    except Exception as e:
        print(f"プレイリストの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/album/{browse_id}", response_model=List[Track])
async def get_album_items(browse_id: str):
    try:
        album = ytmusic.get_album(browse_id)
        tracks = []
        for item in album.get('tracks', []):
            video_id = item.get('videoId')
            video_url = f"https://music.youtube.com/watch?v={video_id}" if video_id else ""
            thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
            artist_name = item['artists'][0]['name'] if 'artists' in item and item['artists'] else "Unknown Artist"
            tracks.append(
                Track(
                    title=item['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
        return tracks
    except Exception as e:
        print(f"アルバムの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # FastAPI lifespan に任せて Discord bot を起動/停止させる
    uvicorn.run(app, host="0.0.0.0", port=8000)
