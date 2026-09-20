"""音声プロセス側の API（Discord bot / MusicPlayer に直接触るルートと WebSocket）。

IRINA_ROLE=voice|all のプロセスがこのルーターを持つ。IRINA_ROLE=web のプロセスでは
`voice_proxy.build_proxy_router(router)` が同じパス・同じメソッドの中継ルートを組み立てるので、
ここにルートを足せば web 側の中継も自動で増える（web 側に手を入れる必要はない）。
"""
import asyncio
import json
import time
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder

from ..bot import client, music_players, register_notify_clients
from ..db import clear_player_state
from ..schemas import AddUrlRequest, PlayTrackRequest, QueueItem, ReorderRequest, Server, Track, VoiceChannel
from ..services.history import load_history_queue_items
from ..services.music_player import MusicPlayer

router = APIRouter(tags=["voice"])

VOICE_CONNECT_TIMEOUT_SECONDS = 15

# ギルドごとの WebSocket 接続（web プロセスからの中継接続も、ここでは普通の接続として扱う）
active_connections: Dict[str, List[WebSocket]] = {}


async def _connect_or_move_voice_client(guild, channel):
    """ボイスチャンネルへの接続/移動をタイムアウト付きで安全に実行する."""
    if not guild.voice_client:
        print(f"[join] guild {guild.id} has no voice client. connecting to channel {channel.id}")
        await asyncio.wait_for(channel.connect(), timeout=VOICE_CONNECT_TIMEOUT_SECONDS)
        return

    current_channel_id = getattr(guild.voice_client.channel, "id", None)
    target_channel_id = getattr(channel, "id", None)
    if current_channel_id == target_channel_id and guild.voice_client.is_connected():
        print(f"[join] guild {guild.id} already connected to channel {target_channel_id}")
        return

    # voice_clientが存在するが切断状態の場合、クリーンアップしてから新規接続
    if not guild.voice_client.is_connected():
        print(f"[join] guild {guild.id} voice client exists but disconnected. cleaning up and reconnecting...")
        try:
            await asyncio.wait_for(guild.voice_client.disconnect(force=True), timeout=5.0)
        except Exception as e:
            print(f"[join] cleanup disconnect failed (ignored): {e}")
        # disconnectしてもvoice_clientが残る場合があるので少し待つ
        await asyncio.sleep(1)
        print(f"[join] guild {guild.id} reconnecting to channel {channel.id}")
        await asyncio.wait_for(channel.connect(), timeout=VOICE_CONNECT_TIMEOUT_SECONDS)
        return

    print(f"[join] guild {guild.id} moving voice client from {current_channel_id} to {target_channel_id}")
    try:
        await asyncio.wait_for(guild.voice_client.move_to(channel), timeout=VOICE_CONNECT_TIMEOUT_SECONDS)
    except Exception as e:
        # move_toが失敗した場合（内部タイムアウト等）、切断して新規接続を試みる
        print(f"[join] move_to failed: {e}. disconnecting and reconnecting...")
        try:
            await asyncio.wait_for(guild.voice_client.disconnect(force=True), timeout=5.0)
        except Exception:
            pass
        await asyncio.sleep(1)
        await asyncio.wait_for(channel.connect(), timeout=VOICE_CONNECT_TIMEOUT_SECONDS)


def _is_voice_channel(channel) -> bool:
    """音声チャンネル判定（voice / stage_voice）"""
    channel_type = getattr(channel, "type", None)
    if channel_type is None:
        return False
    try:
        type_name = str(channel_type)
    except Exception:
        return False
    return type_name in {"ChannelType.voice", "ChannelType.stage_voice", "voice", "stage_voice"}


async def build_player_state(guild_id: str, *, bump_version: bool) -> dict:
    """WebSocket / REST 共通のプレイヤー状態ペイロードを組み立てる。

    bump_version=True のとき（状態変更通知）は version を進める。
    初期送信・REST 取得・sync 要求のときは現在の version をそのまま返す。
    """
    current_track = await get_current_track(guild_id)
    queue = await get_queue(guild_id)
    is_playing_status = await is_playing(guild_id)
    history = await load_history_queue_items(guild_id)

    player = music_players.get(guild_id)
    if player:
        version = player.increment_version() if bump_version else player.get_version()
        epoch = player.state_epoch
        head = player.queue[0] if player.queue else None
        is_loading = bool(getattr(player, "is_preparing", False)) or bool(head is not None and getattr(head, "pending", False))
    else:
        version = 0
        epoch = None
        is_loading = False

    return {
        "current_track": jsonable_encoder(current_track),
        "queue": jsonable_encoder(queue),
        "is_playing": is_playing_status,
        "is_loading": is_loading,
        "history": jsonable_encoder(history),
        "version": version,
        "epoch": epoch,
        "has_player": player is not None,
        "timestamp": int(time.time() * 1000),  # ミリ秒単位のタイムスタンプ
    }


async def _send_state(websocket: WebSocket, guild_id: str, *, bump_version: bool) -> None:
    state = await build_player_state(guild_id, bump_version=bump_version)
    await websocket.send_json({"type": "update", "data": state})


async def notify_clients(guild_id: str):
    """WebSocketクライアントに音楽プレイヤーの状態変更を通知"""
    connections = active_connections.get(guild_id, [])
    if not connections:
        return

    try:
        message = {"type": "update", "data": await build_player_state(guild_id, bump_version=True)}
    except Exception as e:
        print(f"データ取得エラー (guild: {guild_id}): {str(e)}")
        return

    # 全接続へ並行送信。遅い/死んだ接続が他の接続の配信を遅らせないようにする
    async def _send(connection: WebSocket) -> bool:
        try:
            await asyncio.wait_for(connection.send_json(message), timeout=5)
            return True
        except Exception as e:
            print(f"WebSocket通知エラー (guild: {guild_id}): {type(e).__name__}: {str(e)}")
            return False

    results = await asyncio.gather(*(_send(c) for c in list(connections)), return_exceptions=False)
    disconnected_connections = [c for c, ok in zip(list(connections), results) if not ok]

    # 切断されたコネクションをクリーンアップ
    if disconnected_connections:
        for connection in disconnected_connections:
            try:
                active_connections[guild_id].remove(connection)
            except (ValueError, KeyError):
                pass

        if guild_id in active_connections and not active_connections[guild_id]:
            del active_connections[guild_id]
            print(f"ギルド {guild_id} の全接続が削除されました")


# Discord 側（自動参加 / スラッシュコマンド）で作られた MusicPlayer からも WebSocket 通知が飛ぶように登録
register_notify_clients(notify_clients)


@router.get("/player-state/{guild_id}")
async def get_player_state(guild_id: str):
    """WebSocket の update と同じ形のプレイヤー状態を REST で返す（再接続時・タブ復帰時の再同期用）"""
    return await build_player_state(guild_id, bump_version=False)


@router.post("/set-volume/{guild_id}")
async def set_volume(guild_id: str, volume: float):
    if not 0.0 <= volume <= 1.0:
        raise HTTPException(status_code=400, detail="Volume must be between 0.0 and 1.0")
    player = music_players.get(guild_id)
    if player:
        await player.set_volume(volume)
        return {"message": "Volume set"}
    raise HTTPException(status_code=404, detail="No active music player found")


@router.get("/bot-guilds")
async def get_bot_guilds():
    bot_guilds = []
    for guild in client.guilds:
        bot_guilds.append({
            'id': str(guild.id),
            'name': guild.name
        })
    return bot_guilds


@router.post("/disconnect-voice-channel/{guild_id}")
async def disconnect_voice_channel(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild and guild.voice_client:
        # 先に MusicPlayer を止めてから辞書から外す。del だけだと player_loop が生き残り、
        # 次に VC へ入ったときに古いキューを勝手に再生し始める（ゾンビプレイヤー）
        player = music_players.pop(guild_id, None)
        if player:
            try:
                await player.shutdown()
            except Exception as e:
                print(f"player shutdown error (guild: {guild_id}): {e}")
        # 明示的な切断 = セッション終了。保存済みキューも破棄
        try:
            await asyncio.to_thread(clear_player_state, guild_id)
        except Exception:
            pass
        if guild.voice_client:
            try:
                await guild.voice_client.disconnect(force=True)
            except Exception:
                pass
        await notify_clients(guild_id)
        return {"message": "ボイスチャネルから切断しました"}
    raise HTTPException(status_code=404, detail="指定されたギルドでボットはボイスチャネルに接続されていません")


@router.websocket("/ws/{guild_id}")
async def websocket_endpoint(websocket: WebSocket, guild_id: str):
    await websocket.accept()
    if guild_id not in active_connections:
        active_connections[guild_id] = []
    active_connections[guild_id].append(websocket)

    # ハートビートタスクを作成
    heartbeat_task = None

    try:
        # 初期データを送信
        await _send_state(websocket, guild_id, bump_version=False)

        # ハートビートタスクを開始
        async def heartbeat():
            try:
                while True:
                    await asyncio.sleep(30)  # 30秒間隔でハートビート
                    # 接続が生きているかテスト
                    await websocket.send_json({"type": "ping"})
            except asyncio.CancelledError:
                print(f"Heartbeat task cancelled for guild {guild_id}")
                raise
            except Exception as e:
                print(f"Heartbeat error for guild {guild_id}: {str(e)}")
                raise

        heartbeat_task = asyncio.create_task(heartbeat())

        # アプリケーションの背景タスクに追加（適切なシャットダウンのため）
        app_state = websocket.app.state
        if hasattr(app_state, 'background_tasks'):
            app_state.background_tasks.add(heartbeat_task)
            heartbeat_task.add_done_callback(app_state.background_tasks.discard)

        # メインループ（クライアントからのメッセージ処理）
        #   {"type":"ping"} → {"type":"pong"}（クライアント側の生存確認）
        #   {"type":"sync"} → 現在の状態を再送（タブ復帰・再接続後の取りこぼし補正）
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data) if data else {}
                except ValueError:
                    continue
                msg_type = msg.get("type") if isinstance(msg, dict) else None
                if msg_type == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": int(time.time() * 1000)})
                elif msg_type == "sync":
                    await _send_state(websocket, guild_id, bump_version=False)
        except WebSocketDisconnect:
            print(f"WebSocket disconnected for guild {guild_id}")

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for guild {guild_id}")
    except asyncio.CancelledError:
        print(f"WebSocket task cancelled for guild {guild_id}")
        raise  # CancelledErrorは再発生させる
    except Exception as e:
        print(f"WebSocket error for guild {guild_id}: {str(e)}")
    finally:
        # ハートビートタスクをキャンセル
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

        # クリーンアップ処理
        try:
            if websocket in active_connections.get(guild_id, []):
                active_connections[guild_id].remove(websocket)
            if guild_id in active_connections and not active_connections[guild_id]:
                del active_connections[guild_id]
            print(f"WebSocket connection cleaned up for guild {guild_id}")
        except Exception as cleanup_error:
            print(f"Error during WebSocket cleanup for guild {guild_id}: {str(cleanup_error)}")


@router.post("/remove-from-queue/{guild_id}")
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


@router.get("/servers", response_model=List[Server])
async def get_servers():
    return [Server(id=str(guild.id), name=guild.name) for guild in client.guilds]


@router.get("/voice-channels/{guild_id}", response_model=List[VoiceChannel])
async def get_voice_channels(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild:
        return [VoiceChannel(id=str(channel.id), name=channel.name) for channel in guild.voice_channels]
    raise HTTPException(status_code=404, detail="Guild not found")


@router.post("/join-voice-channel/{guild_id}/{channel_id}")
async def join_voice_channel(guild_id: str, channel_id: str):
    try:
        guild_id_int = int(guild_id)
        channel_id_int = int(channel_id)
        guild = client.get_guild(guild_id_int)
        channel = guild.get_channel(channel_id_int) if guild else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid guild_id or channel_id")

    if guild and channel and _is_voice_channel(channel):
        try:
            await _connect_or_move_voice_client(guild, channel)
        except asyncio.TimeoutError:
            print(f"[join] voice connect timeout: guild={guild_id}, channel={channel_id}")
            # タイムアウト後に不安定な接続を明示的に切断
            try:
                if guild.voice_client:
                    await guild.voice_client.disconnect()
            except Exception as disconnect_error:
                print(f"[join] voice client cleanup failed: {disconnect_error}")
            raise HTTPException(
                status_code=503,
                detail="Voice channel connection timed out. Please try again in a moment."
            )
        except HTTPException:
            raise
        except Exception as error:
            error_msg = str(error)
            print(f"[join] voice connect failed: guild={guild_id}, channel={channel_id}, error={error_msg}")
            raise HTTPException(
                status_code=503,
                detail="Failed to connect to voice channel. Please retry."
            )

        # 既存プレイヤーがあればそのまま使い、なければ新規作成
        if guild_id not in music_players:
            player = MusicPlayer(client, guild, guild_id, notify_clients)
            music_players[guild_id] = player
            await player.restore_saved_state()  # デプロイ/障害前のキュー・再生位置を引き継ぐ
        else:
            # voice_client参照を更新
            music_players[guild_id].voice_client = guild.voice_client
        await notify_clients(guild_id)
        return {"message": "Joined voice channel"}
    if guild and channel and not _is_voice_channel(channel):
        raise HTTPException(status_code=400, detail="Only voice and stage voice channels are supported")
    if not guild:
        raise HTTPException(status_code=404, detail="Guild not found")
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    raise HTTPException(status_code=404, detail="Guild or Channel not found")


@router.get("/bot-voice-status/{guild_id}")
async def get_bot_voice_status(guild_id: str):
    guild = client.get_guild(int(guild_id))
    if guild and guild.voice_client:
        return {"channel_id": str(guild.voice_client.channel.id)}
    return {"channel_id": None}


@router.get("/user-voice-status/{guild_id}/{user_id}")
async def get_user_voice_status(guild_id: str, user_id: str):
    """
    指定されたギルドでユーザーが接続しているボイスチャンネルのIDを返す。
    ユーザーがボイスチャンネルに接続していない場合はnullを返す。
    """
    guild = client.get_guild(int(guild_id))
    if not guild:
        return {"channel_id": None}

    member = guild.get_member(int(user_id))
    if not member:
        # メンバーがキャッシュにない場合はfetch
        try:
            member = await guild.fetch_member(int(user_id))
        except Exception:
            return {"channel_id": None}

    if member and member.voice and member.voice.channel:
        return {"channel_id": str(member.voice.channel.id)}
    return {"channel_id": None}


@router.get("/auto-connect-info/{user_id}")
async def get_auto_connect_info(user_id: str):
    """
    ユーザーがボットと同じボイスチャンネルにいるサーバーとチャンネルの情報を返す。
    自動接続機能で使用する。

    Returns:
        guild_id: ボットとユーザーが同じVCにいるギルドID（なければnull）
        channel_id: そのチャンネルID（なければnull）
    """
    # ボットが接続しているすべてのギルドをチェック
    for guild in client.guilds:
        # ボットがボイスチャンネルに接続しているか確認
        if not guild.voice_client or not guild.voice_client.channel:
            continue

        bot_channel_id = guild.voice_client.channel.id

        # ユーザーがこのギルドにいるか確認
        member = guild.get_member(int(user_id))
        if not member:
            try:
                member = await guild.fetch_member(int(user_id))
            except Exception:
                continue

        # ユーザーがボットと同じチャンネルにいるか確認
        if member and member.voice and member.voice.channel:
            if member.voice.channel.id == bot_channel_id:
                return {
                    "guild_id": str(guild.id),
                    "channel_id": str(bot_channel_id)
                }

    return {"guild_id": None, "channel_id": None}


@router.get("/current-track/{guild_id}", response_model=Optional[Track])
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


@router.get("/queue/{guild_id}", response_model=List[QueueItem])
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
                        added_by=item.added_by,
                        pending=bool(getattr(item, "pending", False)) or None,
                    ),
                    position=i,
                    isCurrent=(i == 0)
                )
            )
        return queue_items
    return []


@router.get("/is-playing/{guild_id}")
async def is_playing(guild_id: str):
    player = music_players.get(guild_id)
    return player.is_playing() if player else False


@router.post("/play/{guild_id}")
async def play_track(guild_id: str, request: PlayTrackRequest, background_tasks: BackgroundTasks):
    track = request.track
    track.added_by = request.user
    async def add_track_task():
        try:
            player = music_players.get(guild_id)
            if player:
                await player.add_to_queue(track.url, added_by=track.added_by)
                await notify_clients(guild_id)
            else:
                print(f"プレイヤーが見つかりません (guild: {guild_id})")
        except Exception as e:
            print(f"トラック追加エラー (guild: {guild_id}): {str(e)}")
    background_tasks.add_task(add_track_task)
    return {"message": "Track is being added to queue and will start playing soon"}


@router.post("/pause/{guild_id}")
async def pause(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.pause()
        await notify_clients(guild_id)
        return {"message": "Playback paused"}
    raise HTTPException(status_code=404, detail="No active music player found")


@router.post("/resume/{guild_id}")
async def resume(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.resume()
        await notify_clients(guild_id)
        return {"message": "Playback resumed"}
    raise HTTPException(status_code=404, detail="No active music player found")


@router.post("/skip/{guild_id}")
async def skip(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        await player.skip()
        await notify_clients(guild_id)
        return {"message": "Skipped to next track"}
    raise HTTPException(status_code=404, detail="No active music player found")


@router.post("/add-url/{guild_id}")
async def add_url(guild_id: str, request: AddUrlRequest, background_tasks: BackgroundTasks):
    track = Track(url=request.url, title="Loading...", artist="Unknown", thumbnail="", added_by=request.user)
    async def add_url_task():
        try:
            player = music_players.get(guild_id)
            if player:
                await player.add_to_queue(track.url, added_by=track.added_by)
                await notify_clients(guild_id)
            else:
                print(f"プレイヤーが見つかりません (guild: {guild_id})")
        except Exception as e:
            print(f"URL追加エラー (guild: {guild_id}): {str(e)}")
    background_tasks.add_task(add_url_task)
    return {"message": "URL is being processed and will be added to queue soon"}


@router.post("/reorder-queue/{guild_id}")
async def reorder_queue(guild_id: str, reorder_request: ReorderRequest):
    player = music_players.get(guild_id)
    if player:
        await player.reorder_queue(reorder_request.start_index, reorder_request.end_index)
        await notify_clients(guild_id)
        return {"message": "Queue reordered"}
    raise HTTPException(status_code=404, detail="No active music player found")
