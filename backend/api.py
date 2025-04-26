# api.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, Request, Form, File, UploadFile
import uuid
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import asyncio
from bot import client, music_players
from music_player import MusicPlayer, Song, MUSIC_DIR, OAUTH2_USERNAME, OAUTH2_PASSWORD
import yt_dlp
import uvicorn
from fastapi.encoders import jsonable_encoder
from dotenv import load_dotenv
import os
from ytmusicapi import YTMusic
from discord import utils
import chat
from fastapi.responses import StreamingResponse
import aiofiles
import urllib.parse
from valorant_api import router as valorant_router
import re
from datetime import datetime, timedelta
import signal
from realtimeapi import router as realtime_router
from db import init_db, UploadedSong, add_uploaded_song, get_uploaded_songs_in_guild, find_uploaded_song_by_id, update_uploaded_song, delete_uploaded_song
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles  # ← 追加

ytmusic = YTMusic(language='ja', location='JP')

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動時
    init_db()  # テーブルが無ければ作る。既にあれば何もしない
    yield
    # シャットダウン時の処理（必要な場合）

app = FastAPI(lifespan=lifespan)

# ここでアップロード先ディレクトリを静的ファイルとして公開する
UPLOAD_DIR = "uploaded_music"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploaded_music", StaticFiles(directory=UPLOAD_DIR), name="uploaded_music")  # ← 追加

origins = [
    "http://localhost:3000",
    "https://discord-music-app.vercel.app",
    "http://localhost:8000",
]

# キャッシュ用の変数を定義
recommendations_cache = None
recommendations_cache_timestamp = None
CACHE_DURATION = timedelta(hours=3)  # キャッシュの有効期間

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # フロントエンドのURLを許可
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターを追加
app.include_router(chat.router)
app.include_router(valorant_router)
app.include_router(realtime_router)

class User(BaseModel):
    id: str
    name: str
    image: str

class Track(BaseModel):
    title: str
    artist: str
    thumbnail: str
    url: str
    added_by: Optional[User] = None  # ユーザー情報を追加

class QueueItem(BaseModel):
    track: Track
    position: int
    isCurrent: bool = False

class SearchItem(BaseModel):
    type: str  # 'song', 'video', 'album', 'playlist', 'artist'
    title: str
    artist: str
    thumbnail: str
    url: str
    browseId: Optional[str] = None
    artistId: Optional[str] = None
    items: Optional[List[Track]] = None  # アルバムやプレイリストの場合

class SearchResult(BaseModel):
    results: List[SearchItem]

class Server(BaseModel):
    id: str
    name: str

class VoiceChannel(BaseModel):
    id: str
    name: str

class AddUrlRequest(BaseModel):
    url: str
    user: Optional[User] = None
    
class PlayTrackRequest(BaseModel):
    track: Track
    user: Optional[User] = None
    
class ReorderRequest(BaseModel):
    start_index: int
    end_index: int
    
def extract_artist_id(artist_data):
    # 'id' や 'browseId' を試して取得
    return artist_data.get('id') or artist_data.get('browseId') or None

active_connections: Dict[str, List[WebSocket]] = {}

async def notify_clients(guild_id: str):
    connections = active_connections.get(guild_id, [])
    for connection in connections:
        try:
            current_track = await get_current_track(guild_id)
            queue = await get_queue(guild_id)
            is_playing_status = await is_playing(guild_id)
            history = await get_history(guild_id)  # 履歴を取得
            await connection.send_json({
                "type": "update",
                "data": {
                    "current_track": jsonable_encoder(current_track),
                    "queue": jsonable_encoder(queue),
                    "is_playing": is_playing_status,
                    "history": jsonable_encoder(history)
                }
            })
        except WebSocketDisconnect:
            print(f"Client disconnected: {connection}")
            active_connections[guild_id].remove(connection)
            if not active_connections[guild_id]:
                del active_connections[guild_id]
        except Exception as e:
            print(f"Error notifying client: {str(e)}")
            active_connections[guild_id].remove(connection)
            if not active_connections[guild_id]:
                del active_connections[guild_id]
                
async def add_and_play_track(guild_id: str, track: Track):
    player = music_players.get(guild_id)
    if player:
        await player.add_to_queue(track.url, added_by=track.added_by)
        await notify_clients(guild_id)

# レスポンス用のモデル
class SongResponse(BaseModel):
    id: str
    guild_id: str
    title: str
    artist: str
    filename: str
    thumbnail_filename: str
    uploader_id: str
    uploader_name: str
    full_path: str  # 必須にする

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

@app.get("/stream")
async def stream_audio(request: Request, url: str):
    decoded_url = urllib.parse.unquote(url)
    try:
        ytdl_opts = {
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
        with yt_dlp.YoutubeDL(ytdl_opts) as ydl:
            info = ydl.extract_info(decoded_url, download=False)
            if 'entries' in info:
                info = info['entries'][0]
            filename = ydl.prepare_filename(info)
            if not os.path.exists(filename):
                ydl.download([decoded_url])

        file_size = os.path.getsize(filename)
        headers = {}
        status_code = 200

        range_header = request.headers.get('Range')
        if range_header:
            range_start, range_end = range_header.strip().strip('bytes=').split('-')
            range_start = int(range_start) if range_start else 0
            range_end = int(range_end) if range_end else file_size - 1
            content_length = (range_end - range_start) + 1

            async def iterfile():
                async with aiofiles.open(filename, 'rb') as f:
                    await f.seek(range_start)
                    remaining = content_length
                    while remaining > 0:
                        chunk_size = min(1024 * 1024, remaining)
                        chunk = await f.read(chunk_size)
                        if not chunk:
                            break
                        yield chunk
                        remaining -= len(chunk)

            headers['Content-Range'] = f'bytes {range_start}-{range_end}/{file_size}'
            headers['Accept-Ranges'] = 'bytes'
            headers['Content-Length'] = str(content_length)
            status_code = 206
        else:
            async def iterfile():
                async with aiofiles.open(filename, 'rb') as f:
                    chunk = await f.read(1024 * 1024)
                    while chunk:
                        yield chunk
                        chunk = await f.read(1024 * 1024)
            headers['Content-Length'] = str(file_size)

        return StreamingResponse(iterfile(), media_type="audio/mpeg", headers=headers, status_code=status_code)
    except Exception as e:
        print(f"ストリーミング中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/set-volume/{guild_id}")
async def set_volume(guild_id: str, volume: float):
    if not 0.0 <= volume <= 1.0:
        raise HTTPException(status_code=400, detail="Volume must be between 0.0 and 1.0")
    player = music_players.get(guild_id)
    if player:
        await player.set_volume(volume)
        return {"message": "Volume set"}
    raise HTTPException(status_code=404, detail="No active music player found")

@app.get("/bot-guilds")
async def get_bot_guilds():
    bot_guilds = []
    for guild in client.guilds:
        bot_guilds.append({
            'id': str(guild.id),
            'name': guild.name
        })
    return bot_guilds

@app.post("/disconnect-voice-channel/{guild_id}")
async def disconnect_voice_channel(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild and guild.voice_client:
        await guild.voice_client.disconnect()
        if guild_id in music_players:
            del music_players[guild_id]
        await notify_clients(guild_id)
        return {"message": "ボイスチャネルから切断しました"}
    raise HTTPException(status_code=404, detail="指定されたギルドでボットはボイスチャネルに接続されていません")

@app.websocket("/ws/{guild_id}")
async def websocket_endpoint(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in active_connections:
        active_connections[guild_id] = []
    active_connections[guild_id].append(websocket)
    try:
        current_track = await get_current_track(guild_id)
        queue = await get_queue(guild_id)
        is_playing_status = await is_playing(guild_id)
        await websocket.send_json({
            "type": "update",
            "data": {
                "current_track": jsonable_encoder(current_track),
                "queue": jsonable_encoder(queue),
                "is_playing": is_playing_status
            }
        })
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        active_connections[guild_id].remove(websocket)
        if not active_connections[guild_id]:
            del active_connections[guild_id]
            
@app.get("/recommendations", response_model=List[dict])
async def get_recommendations():
    global recommendations_cache, recommendations_cache_timestamp
    try:
        now = datetime.now()
        if recommendations_cache and recommendations_cache_timestamp:
            if now - recommendations_cache_timestamp < CACHE_DURATION:
                return recommendations_cache
        home = ytmusic.get_home(limit=5)
        sections = []
        for section in home:
            section_title = section.get('title', 'おすすめ')
            contents = []
            for item in section.get('contents', []):
                if item.get('videoId'):
                    video_url = f"https://music.youtube.com/watch?v={item['videoId']}"
                    thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
                    artist_name = ', '.join([artist['name'] for artist in item.get('artists', [])]) or "Unknown Artist"
                    artist_data = item.get('artists', [{}])[0]
                    artist_browseId = extract_artist_id(artist_data)
                    contents.append(
                        SearchItem(
                            type='song',
                            title=item['title'],
                            artist=artist_name,
                            thumbnail=adjust_thumbnail_size(thumbnail),
                            url=video_url,
                            artistId=artist_browseId
                        )
                    )
                elif item.get('playlistId'):
                    playlist_url = f"https://music.youtube.com/playlist?list={item['playlistId']}"
                    thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
                    contents.append(
                        SearchItem(
                            type='playlist',
                            title=item['title'],
                            artist=item.get('author', [{}])[0].get('name', 'Unknown Artist'),
                            thumbnail=adjust_thumbnail_size(thumbnail),
                            url=playlist_url,
                            browseId=item['playlistId']
                        )
                    )
                elif item.get('browseId'):
                    browse_url = f"https://music.youtube.com/browse/{item['browseId']}"
                    thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
                    contents.append(
                        SearchItem(
                            type='album' if item.get('year') else 'artist',
                            title=item['title'],
                            artist=', '.join([artist['name'] for artist in item.get('artists', [])]) or "Unknown Artist",
                            thumbnail=adjust_thumbnail_size(thumbnail),
                            url=browse_url,
                            browseId=item['browseId']
                        )
                    )
            if contents:
                sections.append({
                    "title": section_title,
                    "contents": contents
                })

        recommendations_cache = sections
        recommendations_cache_timestamp = now

        return sections
    except Exception as e:
        print(f"おすすめの曲と動画の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mood-categories")
async def get_mood_categories():
    try:
        categories = ytmusic.get_mood_categories()
        return categories
    except Exception as e:
        print(f"ムードカテゴリの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mood-playlists/{params}", response_model=List[SearchItem])
async def get_mood_playlists(params: str):
    try:
        playlists = ytmusic.get_mood_playlists(params)
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
        for song in charts.get('songs', {}).get('items', [])[:20]:
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
        related = ytmusic.get_watch_playlist(videoId=video_id, limit=11)
        search_items = []
        for track in related.get('tracks', [])[1:]:
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
async def get_history(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        history_items = []
        for i, item in enumerate(list(player.history)):
            history_items.append(
                QueueItem(
                    track=Track(
                        title=item.title,
                        artist=item.artist,
                        thumbnail=item.thumbnail,
                        url=item.url,
                        added_by=item.added_by
                    ),
                    position=i,
                    isCurrent=False
                )
            )
        return history_items
    return []

@app.post("/remove-from-queue/{guild_id}")
async def remove_from_queue(guild_id: str, position: int):
    player = music_players.get(guild_id)
    if player:
        try:
            await player.remove_from_queue(position)
            await notify_clients(guild_id)
            return {"message": "Track removed from queue"}
        except IndexError:
            raise HTTPException(status_code=422, detail="Invalid position")
    raise HTTPException(status_code=404, detail="No active music player found")

@app.get("/servers", response_model=List[Server])
async def get_servers():
    return [Server(id=str(guild.id), name=guild.name) for guild in client.guilds]

@app.get("/voice-channels/{guild_id}", response_model=List[VoiceChannel])
async def get_voice_channels(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild:
        return [VoiceChannel(id=str(channel.id), name=channel.name) for channel in guild.voice_channels]
    raise HTTPException(status_code=404, detail="Guild not found")

@app.post("/join-voice-channel/{guild_id}/{channel_id}")
async def join_voice_channel(guild_id: str, channel_id: str):
    guild = client.get_guild(int(guild_id))
    channel = guild.get_channel(int(channel_id))
    if guild and channel and channel.type.name == "voice":
        if guild.voice_client is None:
            await channel.connect()
        else:
            await guild.voice_client.move_to(channel)
        music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients)
        await notify_clients(guild_id)
        return {"message": "Joined voice channel"}
    raise HTTPException(status_code=404, detail="Guild or Channel not found")

@app.get("/bot-voice-status/{guild_id}")
async def get_bot_voice_status(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild and guild.voice_client:
        return {"channel_id": str(guild.voice_client.channel.id)}
    return {"channel_id": None}

@app.get("/current-track/{guild_id}", response_model=Optional[Track])
async def get_current_track(guild_id: str):
    player = music_players.get(guild_id)
    if player and player.current:
        return Track(
            title=player.current.title,
            artist=player.current.artist,
            thumbnail=player.current.thumbnail,
            url=player.current.url,
            added_by=player.current.added_by
        )
    return None

@app.get("/queue/{guild_id}", response_model=List[QueueItem])
async def get_queue(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        queue_items = []
        for i, item in enumerate(list(player.queue)):
            queue_items.append(
                QueueItem(
                    track=Track(
                        title=item.title,
                        artist=item.artist,
                        thumbnail=item.thumbnail,
                        url=item.url,
                        added_by=item.added_by
                    ),
                    position=i,
                    isCurrent=(i == 0)
                )
            )
        return queue_items
    return []

@app.get("/is-playing/{guild_id}")
async def is_playing(guild_id: str):
    player = music_players.get(guild_id)
    return player.is_playing() if player else False

@app.post("/play/{guild_id}")
async def play_track(guild_id: str, request: PlayTrackRequest, background_tasks: BackgroundTasks):
    track = request.track
    track.added_by = request.user
    background_tasks.add_task(add_and_play_track, guild_id, track)
    return {"message": "Track is being added to queue and will start playing soon"}

@app.post("/pause/{guild_id}")
async def pause(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.pause()
        await notify_clients(guild_id)
        return {"message": "Playback paused"}
    raise HTTPException(status_code=404, detail="No active music player found")

@app.post("/resume/{guild_id}")
async def resume(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.resume()
        await notify_clients(guild_id)
        return {"message": "Playback resumed"}
    raise HTTPException(status_code=404, detail="No active music player found")

@app.post("/skip/{guild_id}")
async def skip(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.skip()
        await notify_clients(guild_id)
        return {"message": "Skipped to next track"}
    raise HTTPException(status_code=404, detail="No active music player found")

@app.post("/previous/{guild_id}")
async def previous(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.previous()
        await notify_clients(guild_id)
        return {"message": "Moved to previous track"}
    raise HTTPException(status_code=404, detail="No active music player found")

def adjust_thumbnail_size(thumbnail_url, width=400, height=400):
    """サムネイルURLのサイズを調整する"""
    if not thumbnail_url:
        return ''
    thumbnail_url = re.sub(r'w\d+-h\d+', f'w{width}-h{height}', thumbnail_url)
    return thumbnail_url

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
        search_items = []
        if filter == 'artists':
            for artist in results:
                if 'browseId' not in artist:
                    continue
                browse_id = artist['browseId']
                url = f"https://music.youtube.com/browse/{browse_id}"
                thumbnail = artist['thumbnails'][0]['url'] if artist.get('thumbnails') else ""
                search_items.append(
                    SearchItem(
                        type='artist',
                        title=artist.get('artist', artist.get('title', '')),
                        artist=artist.get('artist', artist.get('title', '')),
                        thumbnail=adjust_thumbnail_size(thumbnail),
                        url=url,
                        browseId=browse_id
                    )
                )
        return SearchResult(results=search_items)
    else:
        results = await asyncio.gather(
            fetch_results('songs'),
            fetch_results('videos'),
            fetch_results('albums'),
            fetch_results('artists'),
            fetch_results('playlists')
        )

        search_tasks = {
            'songs': results[0],
            'videos': results[1],
            'albums': results[2],
            'artists': results[3],
            'playlists': results[4]
        }

        search_items = []
        for song in search_tasks['songs']:
            if 'videoId' not in song:
                continue
            video_url = f"https://music.youtube.com/watch?v={song['videoId']}"
            thumbnail = song['thumbnails'][0]['url'] if song.get('thumbnails') else ""
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
        for video in search_tasks['videos']:
            if 'videoId' not in video:
                continue
            video_url = f"https://music.youtube.com/watch?v={video['videoId']}"
            thumbnail = video['thumbnails'][0]['url'] if video.get('thumbnails') else ""
            artist_name = ', '.join([artist['name'] for artist in video.get('artists', [])]) or "Unknown Artist"
            search_items.append(
                SearchItem(
                    type='video',
                    title=video['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
        for album in search_tasks['albums']:
            if 'browseId' not in album:
                continue
            browse_id = album['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = album['thumbnails'][0]['url'] if album.get('thumbnails') else ""
            artist_name = ', '.join([artist['name'] for artist in album.get('artists', [])]) or "Unknown Artist"
            search_items.append(
                SearchItem(
                    type=album.get('type', 'album').lower(),
                    title=album['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=url,
                    browseId=browse_id
                )
            )
        for artist in search_tasks['artists']:
            if 'browseId' not in artist:
                continue
            browse_id = artist['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = artist['thumbnails'][0]['url'] if artist.get('thumbnails') else ""
            search_items.append(
                SearchItem(
                    type='artist',
                    title=artist.get('artist', artist.get('title', '')),
                    artist=artist.get('artist', artist.get('title', '')),
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=url,
                    browseId=browse_id
                )
            )
        for playlist in search_tasks['playlists']:
            if 'browseId' not in playlist:
                continue
            browse_id = playlist['browseId']
            url = f"https://music.youtube.com/playlist?list={browse_id.replace('VL', '')}"
            thumbnail = playlist['thumbnails'][0]['url'] if playlist.get('thumbnails') else ""
            search_items.append(
                SearchItem(
                    type='playlist',
                    title=playlist['title'],
                    artist=playlist.get('author', 'Unknown Author'),
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=url,
                    browseId=browse_id.replace('VL', '')
                )
            )
        return SearchResult(results=search_items)

@app.get("/playlist/{browse_id}", response_model=List[Track])
async def get_playlist_items(browse_id: str):
    try:
        playlist = ytmusic.get_playlist(browse_id)
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

@app.post("/add-url/{guild_id}")
async def add_url(guild_id: str, request: AddUrlRequest, background_tasks: BackgroundTasks):
    track = Track(url=request.url, title="Loading...", artist="Unknown", thumbnail="", added_by=request.user)
    background_tasks.add_task(add_and_play_track, guild_id, track)
    return {"message": "URL is being processed and will be added to queue soon"}

@app.post("/reorder-queue/{guild_id}")
async def reorder_queue(guild_id: str, reorder_request: ReorderRequest):
    player = music_players.get(guild_id)
    if player:
        await player.reorder_queue(reorder_request.start_index, reorder_request.end_index)
        await notify_clients(guild_id)
        return {"message": "Queue reordered"}
    raise HTTPException(status_code=404, detail="No active music player found")

async def start_discord_bot():
    await client.start(DISCORD_TOKEN)

async def start_web_server():
    config = uvicorn.Config(app, host="0.0.0.0", port=8000, loop="asyncio")
    server = uvicorn.Server(config)
    await server.serve()

async def start_both():
    await asyncio.gather(
        start_discord_bot(),
        start_web_server()
    )

async def shutdown_async(loop):
    """非同期でのシャットダウン処理"""
    print("シャットダウン処理を開始します...")
    
    # Discordクライアントを切断
    if client.is_ready():
        await client.close()
        print("Discordクライアントを切断しました")
    
    # すべてのタスクをキャンセル (自分自身のタスクは除く)
    tasks = [t for t in asyncio.all_tasks(loop=loop) if t is not asyncio.current_task()]
    if tasks:
        print(f"{len(tasks)}個のタスクをキャンセル中...")
        for task in tasks:
            task.cancel()
        
        # キャンセルされたタスクが完了するのを待つ (タイムアウト付き)
        try:
            await asyncio.wait(tasks, timeout=5)
            print("タスクのキャンセルが完了しました")
        except asyncio.TimeoutError:
            print("一部のタスクがタイムアウトしました")
    
    # ループを停止
    loop.stop()
    print("シャットダウン完了")

def shutdown(loop):
    """シグナルハンドラから呼び出されるシャットダウン関数"""
    # 非同期のシャットダウン処理をスケジュール
    asyncio.create_task(shutdown_async(loop))
    
    # ループが次のイテレーションで停止するように設定
    loop.stop()

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: shutdown(loop))
    try:
        loop.run_until_complete(start_both())
    except asyncio.CancelledError:
        pass
    finally:
        # ここでのシャットダウン処理が正しく実行されるように調整
        if not loop.is_closed():
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()
        print("プログラムを終了します")