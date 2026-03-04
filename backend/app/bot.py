# bot.py
import logging
logging.basicConfig(level=logging.INFO)
# Voice接続のデバッグログを有効化
logging.getLogger('discord.voice_state').setLevel(logging.DEBUG)
logging.getLogger('discord.voice_client').setLevel(logging.DEBUG)
logging.getLogger('discord.gateway').setLevel(logging.WARNING)

import discord
from discord import app_commands
import asyncio
from .services.music_player import MusicPlayer
from openai import OpenAI  # Grok用（レガシー）
import os
from dotenv import load_dotenv
# Nano Banana Pro (Gemini 3 Pro Image Preview) 用
from google import genai
from google.genai import types
# xAI SDK (Grok 4.1 Agent Tools API)
from xai_sdk import Client as XAIClient
from xai_sdk.chat import user as xai_user, assistant as xai_assistant, system as xai_system
from xai_sdk.tools import web_search, x_search
from PIL import Image
from io import BytesIO
import base64
from typing import Optional, Dict, List, Any, Union
import json
from datetime import datetime
import aiohttp
import uuid
import traceback
import re

# 画像保存ディレクトリ
IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "saved_images")
# 画像保存ディレクトリが存在しない場合は作成
os.makedirs(IMAGE_DIR, exist_ok=True)

# ローカルヘルパー関数
async def get_current_track_local(guild_id: str):
    player = music_players.get(guild_id)
    if player and player.current:
        return {
            "title": player.current.title,
            "artist": player.current.artist,
            "thumbnail": player.current.thumbnail,
            "url": player.current.url,
            "added_by": player.current.added_by.__dict__ if player.current.added_by else None
        }
    return None

async def get_queue_local(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        queue_items = []
        for i, item in enumerate(list(player.queue)):
            queue_items.append({
                "track": {
                    "title": item.title,
                    "artist": item.artist,
                    "thumbnail": item.thumbnail,
                    "url": item.url,
                    "added_by": item.added_by.__dict__ if item.added_by else None
                },
                "position": i,
                "isCurrent": (i == 0)
            })
        return queue_items
    return []

async def get_history_local(guild_id: str):
    player = music_players.get(guild_id)
    if player:
        history_items = []
        for i, item in enumerate(list(player.history)):
            history_items.append({
                "track": {
                    "title": item.title,
                    "artist": item.artist,
                    "thumbnail": item.thumbnail,
                    "url": item.url,
                    "added_by": item.added_by.__dict__ if item.added_by else None
                },
                "position": i,
                "isCurrent": False
            })
        return history_items
    return []

async def is_playing_local(guild_id: str):
    player = music_players.get(guild_id)
    return player.is_playing() if player else False

# 簡易通知関数（循環参照を避けるため）
async def notify_clients_local(guild_id: str):
    """music_player.pyが独自に通知機能を持っているため、ここでは何もしない"""
    # WebSocket通知は MusicPlayer の notify_clients コールバックで処理される
    pass

load_dotenv()
# x.ai (Grok) 用のクライアント設定
XAI_API_KEY = os.getenv("XAI_API_KEY")
client_openai_chat = OpenAI( # 変数名を変更して区別
    api_key=XAI_API_KEY,
    base_url="https://api.x.ai/v1",
)
PROMPT = os.getenv("PROMPT")

# Nano Banana Pro (Gemini 3 Pro Image Preview) 用のクライアント設定
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("警告: GEMINI_API_KEY が設定されていません。画像生成機能は利用できません。")
    gemini_client = None
else:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    print("Nano Banana Pro (gemini-3-pro-image-preview) クライアントを初期化しました。")

# Nano Banana Pro モデル設定
NANO_BANANA_PRO_MODEL = "gemini-3-pro-image-preview"
DEFAULT_IMAGE_SIZE = "2K"  # 1K, 2K, 4K から選択可能
DEFAULT_ASPECT_RATIO = "auto"  # auto で自動判定

ALLOWED_CHANNELS = [
    1080511818658762755,
    1156255909446680676,
]

SYSTEM_PROMPTS: Dict[str, str] = {
    "default": PROMPT,
}

# スレッド会話履歴を保存する辞書
thread_histories: Dict[int, List[Dict[str, Any]]] = {} # 型ヒントを明確化

chat_histories: Dict[int, List[dict]] = {}

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.voice_states = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

music_players = {}
active_connections = {}

# ボイスチャンネル自動参加のクールダウン管理
# guild_id -> (最終試行時刻, 連続失敗回数)
import time as _time
_voice_auto_join_cooldowns: Dict[str, tuple] = {}
_VOICE_AUTO_JOIN_COOLDOWN_SEC = 30  # クールダウン秒数
_VOICE_AUTO_JOIN_MAX_FAILURES = 3   # 最大連続失敗回数（超えたら自動参加停止）
# ボット切断イベントの重複防止
_voice_disconnect_processing: set = set()

# 画像をローカルに保存するヘルパー関数 (変更なし)
async def save_image(image_data, prefix="img"):
    """
    画像データをローカルに保存する

    Parameters:
    image_data (bytes): 保存する画像データ
    prefix (str): ファイル名のプレフィックス

    Returns:
    str: 保存されたファイルのパス
    """
    if not image_data:
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    random_id = uuid.uuid4().hex[:6]  # 衝突を避けるためのランダムID

    filename = f"{prefix}_{timestamp}_{random_id}.png"
    filepath = os.path.join(IMAGE_DIR, filename)

    try:
        with open(filepath, "wb") as f:
            f.write(image_data)
        print(f"画像を保存しました: {filepath}")
        return filepath
    except Exception as e:
        print(f"画像保存エラー: {e}")
        traceback.print_exc()
        return None


# URLから画像データを取得する関数 (変更なし)
async def download_image_from_url(url):
    """
    URLから画像データをダウンロードする

    Parameters:
    url (str): 画像のURL

    Returns:
    bytes: 画像データ or None
    """
    if not url: # URLがNoneや空文字列の場合に対処
        return None
    try:
        async with aiohttp.ClientSession() as session:
            # User-Agentを設定してみる (ブロック対策)
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'}
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as response: # タイムアウト設定
                if response.status == 200:
                    print(f"画像ダウンロード成功: ステータス {response.status}, URL: {url}")
                    return await response.read()
                else:
                    error_text = await response.text()
                    print(f"画像ダウンロードエラー: HTTP {response.status}, URL: {url}, Response: {error_text[:200]}")
                    return None
    except asyncio.TimeoutError:
        print(f"画像ダウンロードタイムアウト: URL: {url}")
        return None
    except aiohttp.ClientError as e:
        print(f"画像ダウンロードクライアントエラー: {e}, URL: {url}")
        return None
    except Exception as e:
        print(f"画像ダウンロード一般エラー: {e}, URL: {url}")
        traceback.print_exc()
        return None

# --- Nano Banana Pro 画像生成関数 ---
async def generate_nano_banana_image(
    prompt: str,
    reference_images: Optional[List[bytes]] = None,
    image_size: str = DEFAULT_IMAGE_SIZE,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO
) -> Dict[str, Any]:
    """
    Nano Banana Pro (gemini-3-pro-image-preview) を使用して画像を生成・編集する

    Parameters:
    prompt (str): 生成または編集の指示テキスト
    reference_images (List[bytes], optional): 参照画像のバイトデータリスト（最大14枚）
    image_size (str): 画像サイズ ("1K", "2K", "4K")
    aspect_ratio (str): アスペクト比 ("1:1", "16:9", "9:16", "4:3", "3:4")

    Returns:
    dict: 生成結果を含む辞書 {"success": bool, "image_data_list": List[bytes] | None, "text": str | None, "error": str | None}
    """
    if not gemini_client:
        return {"success": False, "image_data_list": None, "text": None, "error": "Gemini Clientが初期化されていません。GEMINI_API_KEYを確認してください。"}

    try:
        # コンテンツを構築
        contents = []

        # 参照画像がある場合は追加
        if reference_images:
            for i, img_data in enumerate(reference_images):
                # PIL Imageに変換
                img = Image.open(BytesIO(img_data))
                contents.append(img)
                print(f"参照画像 {i+1} を追加: {img.size}")

        # プロンプトを追加
        contents.append(prompt)

        print(f"Nano Banana Pro を呼び出します。プロンプト: {prompt[:80]}...")
        print(f"設定: image_size={image_size}, aspect_ratio={aspect_ratio}")

        # image_config を構築（aspect_ratio が auto の場合は指定しない）
        if aspect_ratio and aspect_ratio.lower() != "auto":
            image_config = types.ImageConfig(
                aspect_ratio=aspect_ratio,
                image_size=image_size
            )
        else:
            image_config = types.ImageConfig(
                image_size=image_size
            )

        # Gemini API呼び出し
        response = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model=NANO_BANANA_PRO_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=image_config
            )
        )

        # レスポンスから画像とテキストを抽出
        generated_image_data_list = []
        response_text = None

        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                    # 画像データを取得
                    image_data = part.inline_data.data
                    generated_image_data_list.append(image_data)
                    # 画像を保存
                    await save_image(image_data, "generated_nano_banana")
                    print(f"画像を抽出しました (MIME: {part.inline_data.mime_type})")
                elif part.text:
                    response_text = part.text
                    print(f"テキストを抽出しました: {response_text[:100]}...")

        if generated_image_data_list:
            print(f"Nano Banana Pro から {len(generated_image_data_list)} 枚の画像を生成しました。")
            return {
                "success": True,
                "image_data_list": generated_image_data_list,
                "text": response_text,
                "error": None
            }
        else:
            error_msg = "APIからの応答に画像が含まれていません。"
            if response_text:
                error_msg += f" テキスト応答: {response_text}"
            print(f"警告: {error_msg}")
            return {"success": False, "image_data_list": None, "text": response_text, "error": error_msg}

    except Exception as e:
        print(f"Nano Banana Pro API エラー: {e}")
        traceback.print_exc()
        return {
            "success": False,
            "image_data_list": None,
            "text": None,
            "error": str(e)
        }


# --- Nano Banana Pro 会話形式画像生成（スレッド用） ---
async def generate_nano_banana_with_history(
    prompt: str,
    history: List[Dict[str, Any]],
    current_image: Optional[bytes] = None,
    image_size: str = DEFAULT_IMAGE_SIZE,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO
) -> Dict[str, Any]:
    """
    会話履歴を考慮したNano Banana Pro画像生成（スレッド内の継続的な編集用）

    Parameters:
    prompt (str): 現在の指示テキスト
    history (List[Dict]): 会話履歴 [{"role": "user/model", "content": str, "image_data": bytes | None}, ...]
    current_image (bytes, optional): 現在のユーザーが添付した画像
    image_size (str): 画像サイズ
    aspect_ratio (str): アスペクト比

    Returns:
    dict: 生成結果
    """
    if not gemini_client:
        return {"success": False, "image_data_list": None, "text": None, "error": "Gemini Clientが初期化されていません。"}

    try:
        # Gemini用のコンテンツリストを構築
        contents = []

        # 履歴からコンテンツを構築
        for entry in history:
            parts = []

            # 画像があれば追加
            if entry.get("image_data"):
                img = Image.open(BytesIO(entry["image_data"]))
                parts.append(img)

            # テキストを追加
            if entry.get("content"):
                parts.append(entry["content"])

            if parts:
                contents.append(types.Content(
                    role=entry["role"],
                    parts=[types.Part.from_text(p) if isinstance(p, str) else types.Part.from_image(p) for p in parts]
                ))

        # 現在のユーザーメッセージを追加
        current_parts = []
        if current_image:
            img = Image.open(BytesIO(current_image))
            current_parts.append(img)
        current_parts.append(prompt)

        # 簡略化: contentsにはプロンプトと画像を直接渡す
        final_contents = []

        # 最後の生成画像があれば参照として使用
        last_generated_image = None
        for entry in reversed(history):
            if entry.get("role") == "model" and entry.get("image_data"):
                last_generated_image = entry["image_data"]
                break

        # 参照画像を追加
        if current_image:
            img = Image.open(BytesIO(current_image))
            final_contents.append(img)
        elif last_generated_image:
            img = Image.open(BytesIO(last_generated_image))
            final_contents.append(img)

        # プロンプトを追加
        final_contents.append(prompt)

        print(f"Nano Banana Pro (会話モード) を呼び出します。プロンプト: {prompt[:80]}...")

        # image_config を構築（aspect_ratio が auto の場合は指定しない）
        if aspect_ratio and aspect_ratio.lower() != "auto":
            image_config = types.ImageConfig(
                aspect_ratio=aspect_ratio,
                image_size=image_size
            )
        else:
            image_config = types.ImageConfig(
                image_size=image_size
            )

        response = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model=NANO_BANANA_PRO_MODEL,
            contents=final_contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=image_config
            )
        )

        # レスポンスから画像とテキストを抽出
        generated_image_data_list = []
        response_text = None

        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                    image_data = part.inline_data.data
                    generated_image_data_list.append(image_data)
                    await save_image(image_data, "generated_nano_banana_thread")
                elif part.text:
                    response_text = part.text

        if generated_image_data_list:
            return {
                "success": True,
                "image_data_list": generated_image_data_list,
                "text": response_text,
                "error": None
            }
        else:
            return {
                "success": False,
                "image_data_list": None,
                "text": response_text,
                "error": "画像が生成されませんでした。" + (f" 応答: {response_text}" if response_text else "")
            }

    except Exception as e:
        print(f"Nano Banana Pro (会話モード) エラー: {e}")
        traceback.print_exc()
        return {
            "success": False,
            "image_data_list": None,
            "text": None,
            "error": str(e)
        }

# --- スレッド内メッセージ処理 (Nano Banana Pro対応) ---
async def handle_thread_message(message):
    """
    スレッド内のメッセージを処理するハンドラー関数 (Nano Banana Pro対応・会話履歴考慮版)
    """
    thread_id = message.channel.id

    if thread_id not in thread_histories:
        thread_histories[thread_id] = []

    # プロンプトが空の場合はスキップ
    if not message.content.strip():
        await message.reply("画像を生成するにはテキストプロンプトを入力してください。")
        return

    try:
        async with message.channel.typing():
            # 現在のメッセージに添付された画像を取得
            current_image_data = None
            if message.attachments:
                for attachment in message.attachments:
                    if attachment.content_type and attachment.content_type.startswith('image/'):
                        current_image_data = await attachment.read()
                        print(f"添付画像を取得: {attachment.filename}")
                        break

            # 履歴から最後の生成画像を参照として使用
            reference_image = current_image_data
            if not reference_image:
                for entry in reversed(thread_histories[thread_id]):
                    if entry.get("role") == "model" and entry.get("image_data"):
                        reference_image = entry["image_data"]
                        print("履歴から参照画像を取得しました。")
                        break

            # Nano Banana Pro で画像生成
            reference_images = [reference_image] if reference_image else None
            result = await generate_nano_banana_image(
                prompt=message.content,
                reference_images=reference_images,
                image_size=DEFAULT_IMAGE_SIZE,
                aspect_ratio=DEFAULT_ASPECT_RATIO
            )

            if not result["success"]:
                error_msg = result.get("error", "不明なエラー")
                if result.get("text"):
                    error_msg += f"\n\nAI応答: {result['text']}"
                await message.reply(f"画像生成に失敗しました: {error_msg}")
                return

            # 会話履歴にユーザーメッセージを追加
            thread_histories[thread_id].append({
                "role": "user",
                "content": message.content,
                "image_data": current_image_data
            })

            # 埋め込みを作成
            embed = discord.Embed(
                title="🍌 Nano Banana Pro 画像生成",
                description=f"**プロンプト:** {message.content}",
                color=0x4285F4  # Google Blue
            )

            if result.get("text"):
                embed.add_field(name="AI応答", value=result["text"][:1024], inline=False)

            reply_message = None
            generated_image_data = None

            # 画像データがある場合
            if result["image_data_list"]:
                files_to_send = []
                for i, img_data in enumerate(result["image_data_list"]):
                    files_to_send.append(discord.File(BytesIO(img_data), filename=f"nano_banana_{i+1}.png"))
                    if i == 0:
                        generated_image_data = img_data  # 最初の画像を履歴用に保存

                if files_to_send:
                    reply_message = await message.reply(embed=embed, files=files_to_send)
                    print(f"画像を送信しました: {len(files_to_send)}枚")
                else:
                    embed.description += "\n\n(画像の送信に失敗しました)"
                    reply_message = await message.reply(embed=embed)
            else:
                embed.description += "\n\n(画像は生成されませんでした)"
                reply_message = await message.reply(embed=embed)

            # 応答を会話履歴に追加
            thread_histories[thread_id].append({
                "role": "model",
                "content": result.get("text", "画像を生成しました。"),
                "image_data": generated_image_data
            })

            # 履歴が長くなりすぎないように制限（画像データはメモリを消費するため）
            if len(thread_histories[thread_id]) > 10:
                thread_histories[thread_id] = thread_histories[thread_id][-10:]

            print(f"スレッド {thread_id} の会話履歴: {len(thread_histories[thread_id])} メッセージ")

    except Exception as e:
        print(f"スレッド内メッセージ処理エラー: {e}")
        traceback.print_exc()
        try:
            await message.reply("申し訳ありません。画像生成中にエラーが発生しました。")
        except:
            pass


@client.event
async def on_ready():
    await client.change_presence(status=discord.Status.online, activity=discord.CustomActivity(name='工藤夏生デバッグ中'))

    # 各ギルドにグローバルコマンドをコピーして即座に同期
    for guild in client.guilds:
        try:
            # グローバルコマンドをこのギルドにコピー
            tree.copy_global_to(guild=guild)
            # ギルドに同期（即時反映）
            await tree.sync(guild=guild)
            print(f"スラッシュコマンドを同期しました: {guild.name}")
        except Exception as e:
            print(f"ギルド {guild.name} への同期に失敗: {e}")

    # グローバル同期も実行（新しいサーバー用）
    await tree.sync()

    print(f"Logged in as {client.user}")

@client.event
async def on_message(message: discord.Message):
    # ボットのメッセージは無視
    if message.author.bot:
        return

    # システムチャネルの場合は既存のチャット処理を行う (x.ai/Grokを使用)
    if message.channel.id in ALLOWED_CHANNELS:
        channel_id = message.channel.id
        if channel_id not in chat_histories:
            chat_histories[channel_id] = []

        guild_id = str(message.guild.id)
        system_prompt = SYSTEM_PROMPTS.get(guild_id, SYSTEM_PROMPTS["default"])

        try:
            async with message.channel.typing():
                # ユーザーメッセージを構築（画像対応）
                user_content = []

                # テキストがある場合は追加
                if message.content:
                    user_content.append({"type": "text", "text": message.content})

                # 画像添付がある場合はbase64エンコードして追加
                for attachment in message.attachments:
                    if attachment.content_type and attachment.content_type.startswith('image/'):
                        try:
                            image_data = await attachment.read()
                            image_base64 = base64.b64encode(image_data).decode('utf-8')
                            # MIMEタイプを取得（jpeg, pngのみサポート）
                            mime_type = attachment.content_type
                            if mime_type not in ['image/jpeg', 'image/png']:
                                mime_type = 'image/jpeg'  # 非対応形式はjpegとして扱う
                            user_content.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_base64}"
                                }
                            })
                            print(f"画像を追加: {attachment.filename} ({mime_type})")
                        except Exception as img_error:
                            print(f"画像の読み込みエラー: {img_error}")

                # コンテンツがない場合はスキップ
                if not user_content:
                    return

                # 単一テキストの場合は文字列、それ以外はリスト形式
                if len(user_content) == 1 and user_content[0]["type"] == "text":
                    user_message_content = user_content[0]["text"]
                else:
                    user_message_content = user_content

                messages = [
                    {"role": "system", "content": system_prompt},
                    *chat_histories[channel_id],
                    {"role": "user", "content": user_message_content}
                ]

                # x.ai (Grok) クライアントを使用
                # grok-4-1-fast-reasoning + Web検索・X検索を有効化 (search_parameters)
                response = await asyncio.to_thread(
                     client_openai_chat.chat.completions.create,
                     model="grok-4-1-fast-reasoning",
                     messages=messages,
                     extra_body={
                         "search_parameters": {
                             "mode": "auto",
                             "sources": [
                                 {"type": "web"},
                                 {"type": "x"},
                                 {"type": "news"}
                             ],
                             "return_citations": True
                         }
                     }
                )

                reply = response.choices[0].message.content

                # 履歴にはテキストのみ保存（画像は含めない）
                history_content = message.content if message.content else "[画像]"
                chat_histories[channel_id].append({"role": "user", "content": history_content})
                chat_histories[channel_id].append({"role": "assistant", "content": reply})

                if len(chat_histories[channel_id]) > 20:
                    chat_histories[channel_id] = chat_histories[channel_id][-10:]

                await message.reply(reply)

        except Exception as e:
            print(f"Error in chat (Grok): {e}")
            await message.channel.send("申し訳ありません。チャット応答でエラーが発生しました。")
        return

    # スレッド内のメッセージかどうかをチェック -> OpenAI画像生成へ
    if isinstance(message.channel, discord.Thread):
        # スレッドの親チャンネルが画像生成を許可されたチャンネルか、
        # または特定の画像生成用チャンネルのスレッドかをチェックするロジックを追加可能
        # ここでは単純にスレッドなら画像生成ハンドラを呼ぶ
        await handle_thread_message(message)

@client.event
async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    guild = member.guild
    guild_id = str(guild.id)

    # ボット自身の状態変化を処理（チャンネル移動・切断への対応）
    if member.id == client.user.id:
        # ボットが切断された場合（Discord側からの強制切断など）
        if before.channel is not None and after.channel is None:
            # 重複イベント防止: 同一ギルドの切断処理が既に進行中なら無視
            if guild_id in _voice_disconnect_processing:
                return
            _voice_disconnect_processing.add(guild_id)
            try:
                print(f"Bot was disconnected from voice channel in {guild.name} (before: {before.channel}, after: {after.channel}, vc: {guild.voice_client})")
                player = music_players.get(guild_id)
                if player:
                    await player.shutdown()
                    music_players.pop(guild_id, None)
                await notify_clients_local(guild_id)
            finally:
                # 少し待ってからフラグ解除（連続イベントを吸収）
                await asyncio.sleep(2)
                _voice_disconnect_processing.discard(guild_id)
            return

        # ボットが別のチャンネルに移動された場合
        if before.channel is not None and after.channel is not None and before.channel.id != after.channel.id:
            print(f"Bot was moved from {before.channel.name} to {after.channel.name} in {guild.name}")
            player = music_players.get(guild_id)
            if player:
                player.voice_client = guild.voice_client
                if player.voice_client and player.voice_client.is_playing():
                    try:
                        player.voice_client.pause()
                        await asyncio.sleep(0.5)
                        player.voice_client.resume()
                        print(f"Playback recovered after channel move in {guild.name}")
                    except Exception as e:
                        print(f"Error recovering playback after channel move: {e}")
            await notify_clients_local(guild_id)
            return

        return  # ボット自身のその他の状態変化（ミュート等）は無視

    # ユーザーがボイスチャンネルに参加した場合で、
    # ボットがまだどのボイスチャンネルにも接続していなければ、自動的に参加する
    # 既にプレイヤーが存在する場合はスキップ（重複作成防止）
    if after.channel is not None and guild.voice_client is None and guild_id not in music_players:
        now = _time.time()
        cooldown_info = _voice_auto_join_cooldowns.get(guild_id, (0, 0))
        last_attempt, failure_count = cooldown_info

        # 連続失敗回数が上限を超えている場合はスキップ（手動joinのみ許可）
        if failure_count >= _VOICE_AUTO_JOIN_MAX_FAILURES:
            # 5分経過でリセット
            if now - last_attempt > 300:
                _voice_auto_join_cooldowns[guild_id] = (0, 0)
            else:
                return

        # クールダウン中はスキップ
        if now - last_attempt < _VOICE_AUTO_JOIN_COOLDOWN_SEC:
            return

        try:
            _voice_auto_join_cooldowns[guild_id] = (now, failure_count)
            vc = await after.channel.connect(timeout=10.0)
            # 接続が安定するまで少し待つ
            await asyncio.sleep(1)
            if not vc.is_connected():
                raise Exception("Voice connection was lost immediately after connect")
            music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients_local)
            await notify_clients_local(guild_id)
            # 成功したらカウンターリセット
            _voice_auto_join_cooldowns[guild_id] = (now, 0)
            print(f"Auto-joined voice channel {after.channel.name} in guild {guild.name} because user {member.display_name} joined.")
        except Exception as e:
            import traceback
            print(f"Error auto-joining voice channel in {guild.name}: {type(e).__name__}: {e}")
            traceback.print_exc()
            _voice_auto_join_cooldowns[guild_id] = (now, failure_count + 1)
            # 失敗した場合、残留voice_clientをクリーンアップ
            if guild.voice_client:
                try:
                    await guild.voice_client.disconnect(force=True)
                except Exception:
                    pass

    # 既存の退室処理：ボイスチャンネル内のユーザーが全員退出した場合、ボットも切断する
    if before.channel is not None and guild.voice_client is not None and before.channel.id == guild.voice_client.channel.id:
        remaining_members = sum(1 for m in before.channel.members if not m.bot)
        if remaining_members == 0:
            await asyncio.sleep(5)
            # 再度チャンネルとメンバー数を確認（チャンネルが消えている可能性もある）
            if guild.voice_client and guild.voice_client.channel:
                current_members = sum(1 for m in guild.voice_client.channel.members if not m.bot)
                if current_members == 0:
                    await guild.voice_client.disconnect()
                    music_players.pop(guild_id, None)
                    # 自動参加カウンターもリセット
                    _voice_auto_join_cooldowns.pop(guild_id, None)
                    print(f"Left voice channel in {guild.name}: {before.channel.name} (no users remaining)")


# ===== スラッシュコマンド実装 =====

@tree.command(name="clear_chat", description="チャット履歴をクリアします")
async def clear_chat(interaction: discord.Interaction):
    channel_id = interaction.channel_id
    if channel_id in chat_histories:
        chat_histories[channel_id] = []
        await interaction.response.send_message("チャット履歴をクリアしました。")
    else:
        await interaction.response.send_message("クリアする履歴がありません。")


@tree.command(name="join", description="指定したボイスチャンネルに参加します。")
@app_commands.describe(channel="参加するボイスチャンネル")
async def join_channel(interaction: discord.Interaction, channel: discord.VoiceChannel):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("このコマンドはギルド内でのみ使用可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)

    if guild.voice_client is None:
        await channel.connect()
    else:
        await guild.voice_client.move_to(channel)

    music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients_local)
    await notify_clients_local(guild_id)
    await interaction.response.send_message(f"ボイスチャンネル {channel.name} に参加しました。")

# --- 画像生成コマンド (Nano Banana Pro対応) ---
@tree.command(name="generate_image", description="🍌 Nano Banana Proでテキストから画像を生成します")
@app_commands.describe(
    prompt="生成したい画像の説明テキスト",
    image="オプション: 参照画像（編集のベースとなる画像）",
    size="画像サイズ (デフォルト: 2K)",
    aspect_ratio="アスペクト比 (デフォルト: 1:1)"
)
@app_commands.choices(size=[
    app_commands.Choice(name="1K (1024px)", value="1K"),
    app_commands.Choice(name="2K (2048px) - 推奨", value="2K"),
    app_commands.Choice(name="4K (4096px)", value="4K"),
])
@app_commands.choices(aspect_ratio=[
    app_commands.Choice(name="自動 (推奨)", value="auto"),
    app_commands.Choice(name="1:1 (正方形)", value="1:1"),
    app_commands.Choice(name="16:9 (横長)", value="16:9"),
    app_commands.Choice(name="9:16 (縦長)", value="9:16"),
    app_commands.Choice(name="4:3", value="4:3"),
    app_commands.Choice(name="3:4", value="3:4"),
])
async def generate_image_command(
    interaction: discord.Interaction,
    prompt: str,
    image: Optional[discord.Attachment] = None,
    size: str = "2K",
    aspect_ratio: str = "auto"
):
    """
    Nano Banana Pro (Gemini 3 Pro Image Preview) を使用して画像を生成するスラッシュコマンド
    """
    await interaction.response.defer(thinking=True)

    try:
        if not interaction.guild:
            await interaction.followup.send("このコマンドはサーバー内でのみ使用できます。")
            return

        # 参照画像を取得
        reference_images = None
        reference_image_data = None
        if image:
            if not image.content_type or not image.content_type.startswith('image/'):
                await interaction.followup.send("画像ファイルではないようです。画像ファイルを添付してください。")
                return
            reference_image_data = await image.read()
            reference_images = [reference_image_data]
            print(f"参照画像を取得: {image.filename}")

        # Nano Banana Pro で画像生成
        result = await generate_nano_banana_image(
            prompt=prompt,
            reference_images=reference_images,
            image_size=size,
            aspect_ratio=aspect_ratio
        )

        if not result["success"]:
            error_msg = result.get("error", "不明なエラー")
            if result.get("text"):
                error_msg += f"\n\nAI応答: {result['text']}"
            await interaction.followup.send(f"画像生成に失敗しました: {error_msg}")
            return

        # 埋め込みを作成
        embed = discord.Embed(
            title="🍌 Nano Banana Pro 画像生成",
            description=f"**プロンプト:** {prompt}",
            color=0x4285F4  # Google Blue
        )
        embed.add_field(name="サイズ", value=size, inline=True)
        embed.add_field(name="アスペクト比", value=aspect_ratio, inline=True)

        if result.get("text"):
            embed.add_field(name="AI応答", value=result["text"][:1024], inline=False)

        if image:
            embed.set_thumbnail(url=image.url)
            embed.add_field(name="参照画像", value=f"[{image.filename}]({image.url})", inline=True)

        response_message = None
        generated_image_data = None

        # 画像があれば送信
        if result["image_data_list"]:
            files_to_send = []
            for i, img_data in enumerate(result["image_data_list"]):
                files_to_send.append(discord.File(BytesIO(img_data), filename=f"nano_banana_{i+1}.png"))
                if i == 0:
                    generated_image_data = img_data

            if files_to_send:
                response_message = await interaction.followup.send(embed=embed, files=files_to_send)
                print(f"画像を送信しました: {len(files_to_send)}枚")
            else:
                embed.description += "\n\n(画像の送信に失敗しました)"
                response_message = await interaction.followup.send(embed=embed)
        else:
            embed.description += "\n\n(画像は生成されませんでした)"
            response_message = await interaction.followup.send(embed=embed)

        # スレッド作成処理
        try:
            if response_message:
                channel = response_message.channel
            else:
                channel = interaction.channel

            if not isinstance(channel, (discord.TextChannel, discord.ForumChannel)):
                print(f"スレッドを作成できないチャンネルタイプです: {type(channel)}")
                return

            thread_name = f"🍌 {prompt[:45]}..." if len(prompt) > 45 else f"🍌 {prompt}"

            if response_message:
                thread = await channel.create_thread(
                    name=thread_name,
                    message=response_message,
                    auto_archive_duration=60,
                    reason="Nano Banana Pro 画像生成スレッド"
                )
            else:
                thread = await channel.create_thread(
                    name=thread_name,
                    type=discord.ChannelType.public_thread,
                    auto_archive_duration=60,
                    reason="Nano Banana Pro 画像生成スレッド"
                )
                await thread.send(embed=embed)

            thread_message = "🍌 **Nano Banana Pro** で画像生成を続けるには、このスレッドにメッセージを送信してください。\n（画像を添付すると、その画像をベースに編集できます）"
            await thread.send(thread_message)

            # スレッドの会話履歴を初期化
            thread_histories[thread.id] = [
                {
                    "role": "user",
                    "content": prompt,
                    "image_data": reference_image_data
                },
                {
                    "role": "model",
                    "content": result.get("text", "画像を生成しました。"),
                    "image_data": generated_image_data
                }
            ]

            print(f"スレッド {thread.id} の会話履歴を初期化しました")

        except discord.Forbidden:
            print("エラー: スレッド作成権限がありません。")
            await interaction.edit_original_response(content="スレッドの作成権限がないため、スレッドを開始できませんでした。画像は生成されています。")
        except Exception as thread_error:
            print(f"スレッド作成エラー: {thread_error}")
            traceback.print_exc()

    except Exception as e:
        print(f"画像生成コマンドエラー: {e}")
        traceback.print_exc()
        try:
            await interaction.edit_original_response(content=f"画像生成コマンドの実行中にエラーが発生しました: {str(e)}")
        except:
            pass

# --- 他のスラッシュコマンド (変更なし、ただしapi.pyからのインポートに注意) ---

@tree.command(name="disconnect", description="現在参加中のボイスチャンネルから切断します。")
async def disconnect_channel(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("このコマンドはギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    if guild.voice_client:
        await guild.voice_client.disconnect()
        if guild_id in music_players:
            del music_players[guild_id]
        await notify_clients_local(guild_id)
        await interaction.response.send_message("ボイスチャネルから切断しました。")
    else:
        await interaction.response.send_message("ボイスチャネルに接続していません。", ephemeral=True)

@tree.command(name="play", description="指定した楽曲を再生キューに追加して再生します。")
@app_commands.describe(url="再生する楽曲のURL・もしくはキーワード")
async def play_track(interaction: discord.Interaction, url: str):
    # schemasからモデルをインポート
    from ..schemas import User, Track

    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)

    # 応答済みかどうかのフラグ
    responded = False
    initial_response_method = interaction.response # 初回応答に使うメソッド

    if not player:
        # ボイスチャンネルに接続していない場合、ユーザーがいるチャンネルに接続を試みる
        if interaction.user.voice and interaction.user.voice.channel:
             try:
                  # join_channelを直接呼び出すのではなく、接続処理を行う
                  if guild.voice_client is None:
                       await interaction.user.voice.channel.connect()
                  else:
                       await guild.voice_client.move_to(interaction.user.voice.channel)

                  # MusicPlayerインスタンスを作成
                  music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients_local)
                  await notify_clients_local(guild_id)

                  player = music_players.get(guild_id) # 再度playerを取得
                  await initial_response_method.send_message(f"{interaction.user.voice.channel.name} に接続しました。トラックを追加します...")
                  responded = True # 応答済みフラグを立てる
                  initial_response_method = interaction.edit_original_response # 次回以降は編集メソッドを使う

             except Exception as join_error:
                  print(f"自動接続エラー: {join_error}")
                  await initial_response_method.send_message("ボットをボイスチャンネルに参加させる際にエラーが発生しました。", ephemeral=True)
                  return
        else:
             await initial_response_method.send_message("ボットはまだボイスチャネルに参加していません。`/join`で参加させるか、あなたがボイスチャンネルに参加してください。", ephemeral=True)
             return

    # playerが取得できたか再確認
    if not player:
         await initial_response_method.send_message("プレイヤーの準備ができませんでした。", ephemeral=True)
         return


    # まだ応答していない場合、処理中メッセージを送る
    if not responded:
        await initial_response_method.send_message("🎵 トラックを追加中です...")
        initial_response_method = interaction.edit_original_response # 次回以降は編集メソッドを使う


    # ユーザー情報を取得
    user_info = User(
        id=str(interaction.user.id),
        name=interaction.user.display_name,
        image=str(interaction.user.display_avatar.url) if interaction.user.display_avatar else ""
    )

    # Trackモデルを作成
    track_to_add = Track(
        title="Loading...",
        artist="Unknown",
        thumbnail="",
        url=url,
        added_by=user_info
    )

    try:
        # music_playerインスタンスのメソッドを直接呼び出す
        await player.add_to_queue(url, added_by=user_info)
        # メッセージを編集
        await initial_response_method(content="✅ トラックをキューに追加しました。")
    except Exception as e:
        # エラーが発生した場合はエラーメッセージを表示
        print(f"Error adding track: {e}")
        await initial_response_method(content=f"❌ トラックの追加中にエラーが発生しました: {str(e)}")


@tree.command(name="pause", description="現在再生中のトラックを一時停止します。")
async def pause_track(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and player.is_playing():
        await player.pause()
        await notify_clients_local(guild_id)
        await interaction.response.send_message("再生を一時停止しました。")
    else:
        await interaction.response.send_message("再生中のトラックがないか、既に一時停止中です。", ephemeral=True)

@tree.command(name="resume", description="一時停止中のトラックを再開します。")
async def resume_track(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and player.voice_client and player.voice_client.is_paused():
        await player.resume()
        await notify_clients_local(guild_id)
        await interaction.response.send_message("再生を再開しました。")
    else:
        await interaction.response.send_message("一時停止中のトラックがありません。", ephemeral=True)

@tree.command(name="skip", description="現在のトラックをスキップします。")
async def skip_track(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and (player.is_playing() or (player.voice_client and player.voice_client.is_paused())): # 再生中または一時停止中ならスキップ可能
        await player.skip()
        # await notify_clients_local(guild_id) # skip内で呼ばれるはず
        await interaction.response.send_message("次のトラックへスキップしました。")
    else:
        await interaction.response.send_message("スキップするトラックがありません。", ephemeral=True)

@tree.command(name="previous", description="前のトラックに戻ります。")
async def previous_track(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player:
        success = await player.previous()
        if success:
            # await notify_clients_local(guild_id) # previous内で呼ばれるはず
            await interaction.response.send_message("前のトラックに戻りました。")
        else:
            await interaction.response.send_message("再生履歴がないため、前のトラックに戻れません。", ephemeral=True)
    else:
        await interaction.response.send_message("プレイヤーが存在しません。", ephemeral=True)


@tree.command(name="queue", description="現在の再生キューを表示します。")
async def show_queue(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    queue = await get_queue_local(guild_id) # ローカル関数でキューを取得
    if not queue:
        await interaction.response.send_message("キューは空です。", ephemeral=True)
        return

    embed = discord.Embed(title="現在の再生キュー", color=discord.Color.blue())
    description = ""
    for item in queue:
        # isCurrent フラグは QueueItem モデルに含まれている想定
        prefix = "▶️ " if item['isCurrent'] else f"{item['position'] + 1}. "
        # URLが長すぎる場合があるので、タイトルのみ表示するなど調整も検討
        track_info = f"[{item['track']['title']}]({item['track']['url']})" if item['track']['url'] else item['track']['title']
        description += f"{prefix}{track_info} by {item['track']['artist']}\n"
        if len(description) > 3900: # Embed Descriptionの上限近くになったら省略
             description += "\n... (以下省略)"
             break

    embed.description = description if description else "キューは空です。"
    await interaction.response.send_message(embed=embed)


@tree.command(name="nowplaying", description="現在再生中のトラックを表示します。")
async def now_playing(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    current = await get_current_track_local(guild_id) # ローカル関数で現在のトラックを取得
    if current:
         embed = discord.Embed(
              title="🎵 現在再生中",
              description=f"[{current['title']}]({current['url']})" if current['url'] else current['title'],
              color=discord.Color.green()
         )
         embed.add_field(name="アーティスト", value=current['artist'], inline=True)
         if current['added_by']:
              embed.add_field(name="追加したユーザー", value=current['added_by']['name'], inline=True)
         if current['thumbnail']:
              embed.set_thumbnail(url=current['thumbnail'])
         await interaction.response.send_message(embed=embed)
    else:
        await interaction.response.send_message("現在再生中のトラックはありません。", ephemeral=True)

@tree.command(name="volume", description="音量を変更します(0%～100%)")
@app_commands.describe(value="設定する音量 (0-100の整数)")
async def set_volume(interaction: discord.Interaction, value: app_commands.Range[int, 0, 100]):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return

    # パーセンテージを0.0～1.0のfloatに変換
    volume_float = float(value) / 100.0

    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player:
        await player.set_volume(volume_float)
        await interaction.response.send_message(f"音量を{value}%に設定しました。")
        # notify_clients_local は set_volume 内で呼ばれるか確認、必要なら呼ぶ
        await notify_clients_local(guild_id)
    else:
        await interaction.response.send_message("ボイスチャンネルに接続していないか、再生中のトラックがありません。", ephemeral=True)


@tree.command(name="history", description="再生履歴を表示します。")
async def show_history(interaction: discord.Interaction):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    history = await get_history_local(guild_id) # ローカル関数で履歴を取得
    if not history:
        await interaction.response.send_message("再生履歴はありません。", ephemeral=True)
        return

    embed = discord.Embed(title="再生履歴", color=discord.Color.orange())
    description = ""
    # 履歴は通常、新しいものがリストの最後に来るため逆順で表示
    for item in reversed(history):
         # position は QueueItem モデルに含まれる想定
         track_info = f"[{item['track']['title']}]({item['track']['url']})" if item['track']['url'] else item['track']['title']
         description += f"{item['position'] + 1}. {track_info} by {item['track']['artist']}\n"
         if len(description) > 3900:
              description += "\n... (以下省略)"
              break

    embed.description = description if description else "再生履歴はありません。"
    await interaction.response.send_message(embed=embed)

# --- メイン処理 ---
# api.pyから起動されることを前提とする
