from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, Request, APIRouter
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
from fastapi.responses import StreamingResponse, Response
import aiofiles
import urllib.parse
from valorant_api import router as valorant_router
import re
from datetime import datetime, timedelta
import signal

ytmusic = YTMusic(language='ja', location='JP')

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")

app = FastAPI()

origins = [
    "http://localhost:3000",
    "https://discord-music-app.vercel.app"
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
            history = await get_history(guild_id) # 変更点: 履歴を取得
            await connection.send_json({
                "type": "update",
                "data": {
                    "current_track": jsonable_encoder(current_track),
                    "queue": jsonable_encoder(queue),
                    "is_playing": is_playing_status,
                    "history": jsonable_encoder(history) # 変更点: 履歴を追加
                }
            })
        except WebSocketDisconnect:
            print(f"Client disconnected: {connection}")
            active_connections[guild_id].remove(connection)
            if not active_connections[guild_id]:
                del active_connections[guild_id]
        except Exception as e:
            print(f"Error notifying client: {str(e)}")
            active_connections[guild_id].remove(connection) # エラーが発生した接続を削除
            if not active_connections[guild_id]:
                del active_connections[guild_id]
                
async def add_and_play_track(guild_id: str, track: Track):
    player = music_players.get(guild_id)
    if player:
        await player.add_to_queue(track.url, added_by=track.added_by)
        # 再生はplayer内で制御するため、ここでは呼び出さない

@app.get("/stream")
async def stream_audio(request: Request, url: str):
    decoded_url = urllib.parse.unquote(url)
    try:
        # 楽曲をダウンロード（既にダウンロード済みであればスキップ）
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
        # MusicPlayerのインスタンスを削除
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
        # 接続時に初期データを送信
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
            await asyncio.sleep(60)  # 接続を維持するためにスリープ
    except WebSocketDisconnect:
        active_connections[guild_id].remove(websocket)
        if not active_connections[guild_id]:
            del active_connections[guild_id]
            
# 関連動画など
@app.get("/recommendations", response_model=List[dict])
async def get_recommendations():
    global recommendations_cache, recommendations_cache_timestamp
    try:
        now = datetime.now()
        if recommendations_cache and recommendations_cache_timestamp:
            if now - recommendations_cache_timestamp < CACHE_DURATION:
                # キャッシュデータを返す
                return recommendations_cache
        home = ytmusic.get_home(limit=5)  # limitを増やして多くのセクションを取得
        sections = []
        for section in home:
            section_title = section.get('title', 'おすすめ')
            contents = []
            for item in section.get('contents', []):
                if item.get('videoId'):
                    # 曲や動画の場合
                    video_url = f"https://music.youtube.com/watch?v={item['videoId']}"
                    thumbnail = item['thumbnails'][0]['url'] if 'thumbnails' in item and item['thumbnails'] else ""
                    artist_name = ', '.join([artist['name'] for artist in item.get('artists', [])]) or "Unknown Artist"
                    # アーティストのIDを取得
                    artist_data = item.get('artists', [{}])[0]
                    artist_browseId = extract_artist_id(artist_data)
                    contents.append(
                        SearchItem(
                            type='song',
                            title=item['title'],
                            artist=artist_name,
                            thumbnail=adjust_thumbnail_size(thumbnail),
                            url=video_url,
                            artistId=artist_browseId  # ここで追加
                        )
                    )
                elif item.get('playlistId'):
                    # プレイリスト
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
                    # アルバムやアーティスト
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

        # キャッシュを更新
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
            thumbnail = playlist['thumbnails'][0]['url'] if 'thumbnails' in playlist and playlist['thumbnails'] else ""
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
    """指定された国の音楽チャート上位20曲を取得"""
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

        # 安全にデータを取得
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
        # サムネイルのサイズを調整
        for thumbnail in artist_info['thumbnails']:
            thumbnail['url'] = adjust_thumbnail_size(thumbnail.get('url', ''))

        return artist_info
    except Exception as e:
        print(f"アーティスト情報の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail="アーティスト情報の取得に失敗しました。")


@app.get("/related/{video_id}", response_model=SearchResult)
async def get_related_songs(video_id: str):
    """指定された楽曲IDに関連する動画を10件取得"""
    try:
        related = ytmusic.get_watch_playlist(videoId=video_id, limit=11)
        search_items = []
        for track in related.get('tracks', [])[1:]:  # 最初の曲はリクエストした曲なのでスキップ
            if track.get('videoId'):
                video_url = f"https://music.youtube.com/watch?v={track['videoId']}"
                thumbnail = track['thumbnail'][0]['url'] if 'thumbnail' in track and track['thumbnail'] else ""
                artist_name = ', '.join([artist['name'] for artist in track.get('artists', [])]) or "Unknown Artist"
                search_items.append(
                    SearchItem(
                        type='song',  # 関連動画は基本的に曲なので 'song' とします
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
            await player.remove_from_queue(position) # indexは0から始まるので、1を引く
            await notify_clients(guild_id)
            return {"message": "Track removed from queue"}
        except IndexError:
            raise HTTPException(status_code=422, detail="Invalid position") # 無効なpositionの場合は422エラー
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
    # サイズ指定のパターンを正規表現で置換
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
        # 取得した結果をSearchItemに変換
        search_items = []
        # 各タイプに応じた処理を追加
        # 'artists'の場合の処理
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
                        title=artist['artist'] if 'artist' in artist else artist['title'],
                        artist=artist['artist'] if 'artist' in artist else artist['title'],
                        thumbnail=adjust_thumbnail_size(thumbnail),
                        url=url,
                        browseId=browse_id
                    )
                )
        return SearchResult(results=search_items)
    else:

        # 並行して各カテゴリの検索を実行
        results = await asyncio.gather(
            fetch_results('songs'),
            fetch_results('videos'),
            fetch_results('albums'),
            fetch_results('artists'),
            fetch_results('playlists')
        )

        # 結果を対応するカテゴリにマッピング
        search_tasks = {
            'songs': results[0],
            'videos': results[1],
            'albums': results[2],
            'artists': results[3],
            'playlists': results[4]
        }

        search_items = []

        # 曲の処理
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

        # 動画の処理
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

        # アルバムの処理
        for album in search_tasks['albums']:
            if 'browseId' not in album:
                continue
            browse_id = album['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = album['thumbnails'][0]['url'] if album.get('thumbnails') else ""
            artist_name = ', '.join([artist['name'] for artist in album.get('artists', [])]) or "Unknown Artist"
            
            search_items.append(
                SearchItem(
                    type=album.get('type', 'album').lower(),  # album, single, ep
                    title=album['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=url,
                    browseId=browse_id
                )
            )

        # アーティストの処理
        for artist in search_tasks['artists']:
            if 'browseId' not in artist:
                continue
            browse_id = artist['browseId']
            url = f"https://music.youtube.com/browse/{browse_id}"
            thumbnail = artist['thumbnails'][0]['url'] if artist.get('thumbnails') else ""
            
            search_items.append(
                SearchItem(
                    type='artist',
                    title=artist['artist'] if 'artist' in artist else artist['title'],
                    artist=artist['artist'] if 'artist' in artist else artist['title'],
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=url,
                    browseId=browse_id
                )
            )

        # プレイリストの処理
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
    config = uvicorn.Config(app, host="::", port=8000, loop="asyncio")
    server = uvicorn.Server(config)
    await server.serve()

async def start_both():
    await asyncio.gather(
        start_discord_bot(),
        start_web_server()
    )

def shutdown():
    tasks = asyncio.all_tasks()
    for task in tasks:
        task.cancel()

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown)

    try:
        loop.run_until_complete(start_both())
    except asyncio.CancelledError:
        pass
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()