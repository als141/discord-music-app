from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import asyncio
from bot import bot, music_players
from music_player import MusicPlayer, Song
import yt_dlp
import uvicorn
from fastapi.encoders import jsonable_encoder
from dotenv import load_dotenv
import os
from ytmusicapi import YTMusic
from discord import utils

ytmusic = YTMusic("oauth.json", language='ja', location='JP')

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")

app = FastAPI()

origins = [
    "http://localhost:3000",
    "https://discord-music-app.vercel.app"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # フロントエンドのURLを許可
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Track(BaseModel):
    title: str
    artist: str
    thumbnail: str
    url: str

class QueueItem(BaseModel):
    track: Track
    position: int
    isCurrent: bool = False

class SearchResult(BaseModel):
    tracks: List[Track]

class Server(BaseModel):
    id: str
    name: str

class VoiceChannel(BaseModel):
    id: str
    name: str

class AddUrlRequest(BaseModel):
    url: str

class ReorderRequest(BaseModel):
    start_index: int
    end_index: int

active_connections: Dict[str, List[WebSocket]] = {}

async def notify_clients(guild_id: str):
    connections = active_connections.get(guild_id, [])
    for connection in connections:
        try:
            current_track = await get_current_track(guild_id)
            queue = await get_queue(guild_id)
            is_playing_status = await is_playing(guild_id)
            await connection.send_json({
                "type": "update",
                "data": {
                    "current_track": jsonable_encoder(current_track),
                    "queue": jsonable_encoder(queue),
                    "is_playing": is_playing_status
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
        await player.add_to_queue(track.url)
        # 再生はplayer内で制御するため、ここでは呼び出さない

@app.get("/bot-guilds")
async def get_bot_guilds():
    bot_guilds = []
    for guild in bot.guilds:
        bot_guilds.append({
            'id': str(guild.id),
            'name': guild.name
        })
    return bot_guilds

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
@app.get("/recommendations", response_model=SearchResult)
async def get_recommendations():
    """おすすめの曲と動画を最大10件取得"""
    try:
        home = ytmusic.get_home(limit=10)
        tracks = []
        for section in home:
            for item in section.get('contents', []):
                if item.get('videoId'):
                    video_url = f"https://music.youtube.com/watch?v={item['videoId']}"
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
        return SearchResult(tracks=tracks)
    except Exception as e:
        print(f"おすすめの曲と動画の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/charts", response_model=SearchResult)
async def get_charts():
    """日本の音楽チャート上位20曲を取得"""
    try:
        charts = ytmusic.get_charts(country='JP')
        tracks = []
        for song in charts.get('songs', {}).get('items', [])[:20]:
            video_url = f"https://music.youtube.com/watch?v={song['videoId']}" if 'videoId' in song else ""
            thumbnail = song['thumbnails'][0]['url'] if 'thumbnails' in song and song['thumbnails'] else ""
            artist_name = song['artists'][0]['name'] if 'artists' in song and song['artists'] else "Unknown Artist"

            tracks.append(
                Track(
                    title=song['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
        return SearchResult(tracks=tracks)

    except Exception as e:
        print(f"チャートの取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/related/{video_id}", response_model=SearchResult)
async def get_related_songs(video_id: str):
    """指定された楽曲IDに関連する動画を10件取得"""
    try:
        related = ytmusic.get_watch_playlist(videoId=video_id, limit=10)
        tracks = []
        for track in related.get('tracks', [])[1:]: # 最初の曲は重複するためスキップ
            if track.get('videoId'): # videoIdが存在することを確認
                video_url = f"https://music.youtube.com/watch?v={track['videoId']}"
                thumbnail = track['thumbnail'][0]['url'] if 'thumbnail' in track and track['thumbnail'] else ""
                artist_name = track['artists'][0]['name'] if 'artists' in track and track['artists'] else "Unknown Artist"
                tracks.append(
                    Track(
                        title=track['title'],
                        artist=artist_name,
                        thumbnail=adjust_thumbnail_size(thumbnail),
                        url=video_url
                    )
                )
        return SearchResult(tracks=tracks)
    except Exception as e:
        print(f"関連動画の取得中にエラーが発生しました: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
    return [Server(id=str(guild.id), name=guild.name) for guild in bot.guilds]

@app.get("/voice-channels/{guild_id}", response_model=List[VoiceChannel])
async def get_voice_channels(guild_id: str):
    guild = bot.get_guild(int(guild_id))
    if guild:
        return [VoiceChannel(id=str(channel.id), name=channel.name) for channel in guild.voice_channels]
    raise HTTPException(status_code=404, detail="Guild not found")

@app.post("/join-voice-channel/{guild_id}/{channel_id}")
async def join_voice_channel(guild_id: str, channel_id: str):
    guild = bot.get_guild(int(guild_id))
    channel = guild.get_channel(int(channel_id))
    if guild and channel and channel.type.name == "voice":
        if guild.voice_client is None:
            await channel.connect()
        else:
            await guild.voice_client.move_to(channel)
        music_players[guild_id] = MusicPlayer(bot, guild, guild_id, notify_clients)
        await notify_clients(guild_id)
        return {"message": "Joined voice channel"}
    raise HTTPException(status_code=404, detail="Guild or Channel not found")

@app.get("/bot-voice-status/{guild_id}")
async def get_bot_voice_status(guild_id: str):
    guild = bot.get_guild(int(guild_id))
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
            url=player.current.url
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
                        url=item.url
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
async def play_track(guild_id: str, track: Track, background_tasks: BackgroundTasks):
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
        return {"message": "Skipped to next track"}
    raise HTTPException(status_code=404, detail="No active music player found")

@app.post("/previous/{guild_id}")
async def previous(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.previous()
        return {"message": "Moved to previous track"}
    raise HTTPException(status_code=404, detail="No active music player found")

def adjust_thumbnail_size(thumbnail_url, width=400, height=400):
    """サムネイルURLのサイズを調整する（デフォルトでは800x800に拡大）"""
    if thumbnail_url and "w60-h60" in thumbnail_url:
        return thumbnail_url.replace("w60-h60", f"w{width}-h{height}")
    return thumbnail_url

@app.get("/search", response_model=SearchResult)
async def search(query: str):
    results = ytmusic.search(query)

    tracks = []
    for result in results:
        if result['resultType'] in ('song', 'video'):  # song と video の両方を処理
            video_url = f"https://music.youtube.com/watch?v={result['videoId']}" if result['resultType'] == 'song' else f"https://www.youtube.com/watch?v={result['videoId']}"
            thumbnail = result['thumbnails'][0]['url'] if 'thumbnails' in result and result['thumbnails'] else "" # サムネイルがない場合の処理を追加
            artist_name = result['artists'][0]['name'] if 'artists' in result and result['artists'] else "Unknown Artist" # アーティストがない場合の処理を追加

            tracks.append(
                Track(
                    title=result['title'],
                    artist=artist_name,
                    thumbnail=adjust_thumbnail_size(thumbnail),
                    url=video_url
                )
            )
    return SearchResult(tracks=tracks)

@app.post("/add-url/{guild_id}")
async def add_url(guild_id: str, request: AddUrlRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(add_and_play_track, guild_id, Track(url=request.url, title="Loading...", artist="Unknown", thumbnail=""))
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
    await bot.start(DISCORD_TOKEN)

async def start_web_server():
    config = uvicorn.Config(app, host="::", port=8000, loop="asyncio")
    server = uvicorn.Server(config)
    await server.serve()

async def start_both():
    await asyncio.gather(
        start_discord_bot(),
        start_web_server()
    )

if __name__ == "__main__":
    asyncio.run(start_both())
