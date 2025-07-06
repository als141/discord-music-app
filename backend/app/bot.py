# bot.py
import discord
from discord import app_commands
import asyncio
from .services.music_player import MusicPlayer
from openai import OpenAI # OpenAIライブラリをインポート
import os
from dotenv import load_dotenv
# google.genai は不要になったためコメントアウトまたは削除
# from google import genai
# from google.genai import types
from PIL import Image
from io import BytesIO
import base64
from typing import Optional, Dict, List, Any, Union
import json
# urllib.request は不要になったためコメントアウトまたは削除
# import urllib.request
from datetime import datetime
import aiohttp
import uuid
import traceback # トレースバック出力用に追加

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

# OpenAI Image Generation 用のクライアント設定
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") # OpenAIのAPIキーを環境変数から取得
if not OPENAI_API_KEY:
    print("警告: OPENAI_API_KEY が設定されていません。画像生成機能は利用できません。")
    openai_image_client = None
else:
    # 標準のOpenAI APIエンドポイントを使用
    openai_image_client = OpenAI(api_key=OPENAI_API_KEY)

# Gemini関連のクライアント設定は不要になったためコメントアウトまたは削除
# GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# gemini_client = genai.Client(api_key=GEMINI_API_KEY)

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

# --- OpenAI 画像生成関数 (複数枚生成対応) ---
async def generate_openai_image(prompt: str, image_url: Optional[str] = None, n: int = 1):
    """
    OpenAI API (gpt-image-1) を使用して画像を生成または編集する (size/quality自動, 複数枚対応)

    Parameters:
    prompt (str): 生成または編集の指示テキスト
    image_url (str, optional): 編集の元となる画像のURL
    n (int): 生成する画像の枚数 (デフォルト1)

    Returns:
    dict: 生成結果を含む辞書 {"success": bool, "image_data_list": List[bytes] | None, "error": str | None}
    """
    if not openai_image_client:
        return {"success": False, "image_data_list": None, "error": "OpenAI Image Clientが初期化されていません。"}
    if not (1 <= n <= 4): # 枚数制限 (APIの制限に合わせて調整が必要な場合あり)
        print(f"警告: 要求された画像枚数({n})が範囲外です。1枚生成します。")
        n = 1

    try:
        image_bytes = None
        if image_url:
            # 元画像がある場合はダウンロード
            print(f"元画像をダウンロードします: {image_url}")
            image_bytes = await download_image_from_url(image_url)
            if not image_bytes:
                # ダウンロード失敗時はエラーとする
                return {"success": False, "image_data_list": None, "error": "元画像のダウンロードに失敗しました。"}
            else:
                print("元画像のダウンロード成功")

        if image_bytes:
            # 元画像がある場合 -> images.edit を使用
            # 注意: edit エンドポイントが n > 1 をサポートしているか要確認。
            #       サポートしていない場合、n=1 として動作する可能性がある。
            print(f"OpenAI images.edit を呼び出します (n={n})。プロンプト: {prompt[:50]}...")
            image_file = BytesIO(image_bytes)
            image_file.name = f"input_{uuid.uuid4().hex[:6]}.png"

            response = await asyncio.to_thread(
                openai_image_client.images.edit,
                model="gpt-image-1",
                image=image_file,
                prompt=prompt,
                n=n # 生成枚数を指定
            )
        else:
            # 元画像がない場合 -> images.generate を使用
            print(f"OpenAI images.generate を呼び出します (n={n})。プロンプト: {prompt[:50]}...")
            response = await asyncio.to_thread(
                openai_image_client.images.generate,
                model="gpt-image-1",
                prompt=prompt,
                n=n # 生成枚数を指定
            )

        # レスポンスから画像データを取得
        generated_image_data_list = []
        if response.data:
            print(f"APIから {len(response.data)} 枚の画像データを受信しました。")
            for image_object in response.data:
                if image_object.b64_json:
                    b64_data = image_object.b64_json
                    generated_image_data = base64.b64decode(b64_data)
                    generated_image_data_list.append(generated_image_data)
                    # 生成された画像を保存 (デバッグや確認用)
                    await save_image(generated_image_data, f"generated_openai_n{n}")
                else:
                    print("警告: レスポンス内の画像オブジェクトにb64_jsonが含まれていません。")
        else:
             print("警告: APIからの応答に画像データが含まれていません。")


        if generated_image_data_list:
            return {
                "success": True,
                "image_data_list": generated_image_data_list,
                "error": None
            }
        else:
            # レスポンス構造が予期しないものだったか、データが空だった場合
            print(f"予期しないAPIレスポンスまたは空のデータ: {response}")
            return {"success": False, "image_data_list": None, "error": "APIからの応答に有効な画像データが含まれていません。"}

    except Exception as e:
        print(f"OpenAI API エラー: {e}")
        traceback.print_exc() # 詳細なトレースバックを出力
        error_message = str(e)
        if hasattr(e, 'response') and e.response:
             try:
                 error_details = e.response.json()
                 error_message = f"{error_message} - Details: {error_details}"
             except:
                 pass
        return {
            "success": False,
            "image_data_list": None,
            "error": error_message
        }

# --- スレッド内メッセージ処理 (複数枚生成対応) ---
async def handle_thread_message(message):
    """
    スレッド内のメッセージを処理するハンドラー関数 (OpenAI対応・履歴考慮・複数枚生成対応版)
    """
    thread_id = message.channel.id

    if thread_id not in thread_histories:
        thread_histories[thread_id] = []

    try:
        async with message.channel.typing():
            current_message_image_url = None
            if message.attachments:
                for attachment in message.attachments:
                    if attachment.content_type and attachment.content_type.startswith('image/'):
                        current_message_image_url = attachment.url
                        print(f"現在のメッセージから添付画像URLを取得: {current_message_image_url}")
                        break

            base_image_url = None
            if current_message_image_url:
                base_image_url = current_message_image_url
                print("ユーザー添付画像を元画像として使用します。")
            else:
                history = thread_histories.get(thread_id, [])
                for i in range(len(history) - 1, -1, -1):
                    prev_msg = history[i]
                    if prev_msg.get("image_url"):
                        base_image_url = prev_msg["image_url"]
                        print(f"履歴から元画像URLを発見: {base_image_url} (履歴インデックス: {i})")
                        break
                if base_image_url:
                     print("履歴の画像を元画像として使用します。")
                else:
                     print("元画像は見つかりませんでした。新規生成を行います。")

            # --- OpenAI 画像生成を実行 (n=1 で固定、コマンドでのみ複数枚指定可能とする) ---
            # スレッド内の会話では、煩雑さを避けるため常に1枚生成とする
            # もしスレッド内でも複数枚生成したい場合は、n を変更する
            result = await generate_openai_image(
                message.content,
                base_image_url,
                n=3 # スレッド内では常に1枚生成
            )
            # --- ---

            if not result["success"]:
                await message.reply(f"画像生成に失敗しました: {result['error']}")
                return

            # --- 会話履歴にユーザーメッセージを追加 ---
            thread_histories[thread_id].append({
                "role": "user",
                "content": message.content,
                "image_url": current_message_image_url
            })

            # --- 埋め込みを作成 ---
            embed = discord.Embed(
                title="画像生成結果 (OpenAI)",
                description=f"**プロンプト:** {message.content}",
                color=0x10A37F
            )

            if base_image_url:
                embed.set_thumbnail(url=base_image_url)
                embed.add_field(name="元画像", value=f"[表示]({base_image_url})", inline=True)

            reply_message = None
            generated_image_urls = [] # 生成された画像のURLリスト

            # 画像データがある場合
            if result["image_data_list"]:
                files_to_send = []
                for i, img_data in enumerate(result["image_data_list"]):
                    files_to_send.append(discord.File(BytesIO(img_data), filename=f"generated_openai_{i+1}.png"))

                # 応答を送信 (複数のファイルを添付)
                if files_to_send:
                    reply_message = await message.reply(embed=embed, files=files_to_send)

                    # 生成された画像の添付ファイルURLを取得
                    if reply_message and reply_message.attachments:
                        generated_image_urls = [att.url for att in reply_message.attachments]
                        print(f"生成画像のURLを保存: {generated_image_urls}")
                else:
                     # 画像データリストはあるがファイル作成に失敗した場合など
                     embed.description += "\n\n(画像の送信に失敗しました)"
                     reply_message = await message.reply(embed=embed)

            else:
                # 画像データがない場合はテキストのみ (通常はエラー時)
                embed.description += "\n\n(画像は生成されませんでした)"
                reply_message = await message.reply(embed=embed)

            # --- 応答を会話履歴に追加 (最初の画像のURLのみ保存) ---
            first_generated_url = generated_image_urls[0] if generated_image_urls else None
            thread_histories[thread_id].append({
                "role": "model",
                "content": f"{len(generated_image_urls)}枚の画像を生成しました。" if generated_image_urls else "画像を生成しました。",
                "image_url": first_generated_url # 最初の画像のURLのみ履歴に保存
            })

            print(f"スレッド {thread_id} の会話履歴: {len(thread_histories[thread_id])} メッセージ")

    except Exception as e:
        print(f"スレッド内メッセージ処理エラー: {e}")
        traceback.print_exc() # 詳細なトレースバックを出力
        await message.reply("申し訳ありません。スレッド処理中にエラーが発生しました。")


@client.event
async def on_ready():
    await client.change_presence(status=discord.Status.online, activity=discord.CustomActivity(name='やっとなおった！！！！！'))
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
                messages = [
                    {"role": "system", "content": system_prompt},
                    *chat_histories[channel_id],
                    {"role": "user", "content": message.content}
                ]

                # x.ai (Grok) クライアントを使用
                response = await asyncio.to_thread(
                     client_openai_chat.chat.completions.create,
                     model="grok-3-mini-latest",
                     messages=messages,
                )

                reply = response.choices[0].message.content

                chat_histories[channel_id].append({"role": "user", "content": message.content})
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
    # ボット自身の状態変化は無視
    if member.id == client.user.id:
        return

    guild = member.guild
    guild_id = str(guild.id)

    # ★新規追加★
    # ユーザーがボイスチャンネルに参加した場合で、
    # ボットがまだどのボイスチャンネルにも接続していなければ、自動的に参加する
    if after.channel is not None and guild.voice_client is None:
        try:
            await after.channel.connect()
            music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients_local)
            await notify_clients_local(guild_id)
            print(f"Auto-joined voice channel {after.channel.name} in guild {guild.name} because user {member.display_name} joined.")
        except Exception as e:
            print(f"Error auto-joining voice channel: {e}")

    # 既存の退室処理：ボイスチャンネル内のユーザーが全員退出した場合、ボットも切断する
    if before.channel is not None and guild.voice_client is not None and before.channel.id == guild.voice_client.channel.id:
        # ボット以外のメンバー数をカウント
        remaining_members = sum(1 for m in before.channel.members if not m.bot)
        if remaining_members == 0:
            await asyncio.sleep(5) # 5秒待って再確認
            # 再度メンバー数をカウント
            current_members = sum(1 for m in before.channel.members if not m.bot)
            if current_members == 0:
                await guild.voice_client.disconnect()
                if guild_id in music_players:
                    del music_players[guild_id]
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

# --- 画像生成コマンド (複数枚生成対応) ---
@tree.command(name="generate_image", description="テキストから画像を生成します。(OpenAI, 複数枚可)")
@app_commands.describe(
    prompt="生成したい画像の説明テキスト",
    image="オプション: 生成の元となる画像",
    num_images="生成する画像の枚数 (1-4)"
)
async def generate_image_command(
    interaction: discord.Interaction,
    prompt: str,
    image: Optional[discord.Attachment] = None,
    num_images: app_commands.Range[int, 1, 4] = 1 # 枚数オプション追加 (デフォルト1, 範囲1-4)
):
    """
    テキストプロンプトと任意の画像から新しい画像を生成し、スレッドを作成するスラッシュコマンド (OpenAI対応・複数枚生成版)
    """
    await interaction.response.defer(thinking=True) # 生成には時間がかかるため、応答を遅延します

    try:
        if not interaction.guild:
            await interaction.followup.send("このコマンドはサーバー内でのみ使用できます。")
            return

        image_url = None
        if image:
            if not image.content_type or not image.content_type.startswith('image/'):
                 await interaction.followup.send("画像ファイルではないようです。画像ファイルを添付してください。")
                 return
            image_url = image.url
            print(f"コマンドから画像URLを取得しました: {image_url}")

        # --- OpenAI 画像生成を実行 (枚数指定) ---
        result = await generate_openai_image(prompt, image_url, n=num_images)
        # --- ---

        if not result["success"]:
            await interaction.followup.send(f"画像生成に失敗しました: {result['error']}")
            return

        # --- 埋め込みを作成 ---
        embed = discord.Embed(
            title="画像生成結果 (OpenAI)",
            description=f"**プロンプト:** {prompt}\n**生成枚数:** {len(result.get('image_data_list', []))}", # 実際に生成された枚数を表示
            color=0x10A37F
        )

        if image:
            embed.set_thumbnail(url=image.url)
            embed.add_field(name="元画像", value=f"[{image.filename}]({image.url})", inline=True)

        response_message = None
        generated_image_urls = [] # 生成された画像のURLリスト

        # 生成された画像があるかどうかで処理を分岐
        if result["image_data_list"]:
            files_to_send = []
            for i, img_data in enumerate(result["image_data_list"]):
                 files_to_send.append(discord.File(BytesIO(img_data), filename=f"generated_openai_{i+1}.png"))

            # 画像付きメッセージを送信 (複数のファイルを添付)
            if files_to_send:
                response_message = await interaction.followup.send(embed=embed, files=files_to_send)

                # 生成された画像の添付ファイルURLを取得
                if response_message and response_message.attachments:
                    generated_image_urls = [att.url for att in response_message.attachments]
                    print(f"生成画像のURLを保存: {generated_image_urls}")
                else:
                    print("警告: followup.send の応答から添付ファイルを取得できませんでした。")
            else:
                # 画像データリストはあるがファイル作成に失敗した場合など
                embed.description += "\n\n(画像の送信に失敗しました)"
                response_message = await interaction.followup.send(embed=embed)

        else:
            # 画像が生成されなかった場合はテキストのみ (通常エラー時)
            embed.description += "\n\n(画像は生成されませんでした)"
            response_message = await interaction.followup.send(embed=embed)

        # --- スレッド作成処理 ---
        try:
            if response_message:
                channel = response_message.channel
            else:
                 channel = interaction.channel

            if not isinstance(channel, (discord.TextChannel, discord.ForumChannel)):
                 print(f"スレッドを作成できないチャンネルタイプです: {type(channel)}")
                 return

            thread_name = f"画像生成: {prompt[:50]}..." if len(prompt) > 50 else f"画像生成: {prompt}"

            if response_message:
                thread = await channel.create_thread(
                    name=thread_name,
                    message=response_message,
                    auto_archive_duration=60,
                    reason="画像生成スレッド (OpenAI)"
                )
            else:
                 thread = await channel.create_thread(
                    name=thread_name,
                    type=discord.ChannelType.public_thread,
                    auto_archive_duration=60,
                    reason="画像生成スレッド (OpenAI)"
                )
                 await thread.send(embed=embed)


            thread_message = f"画像生成を続けるには、このスレッドにメッセージを送信してください。\n（元画像を指定する場合は、メッセージに画像を添付してください）"
            await thread.send(thread_message)

            # --- スレッドの会話履歴を初期化 (最初の画像のURLのみ保存) ---
            first_generated_url = generated_image_urls[0] if generated_image_urls else None
            thread_histories[thread.id] = [
                {
                    "role": "user",
                    "content": prompt,
                    "image_url": image_url
                },
                {
                    "role": "model",
                    "content": f"{len(generated_image_urls)}枚の画像を生成しました。" if generated_image_urls else "画像を生成しました。",
                    "image_url": first_generated_url # 最初の画像のURLのみ履歴に保存
                }
            ]

            print(f"スレッド {thread.id} の会話履歴を初期化しました: {len(thread_histories[thread.id])} メッセージ")

        except discord.Forbidden:
             print("エラー: スレッド作成権限がありません。")
             await interaction.edit_original_response(content="スレッドの作成権限がないため、スレッドを開始できませんでした。画像は生成されています。")
        except Exception as thread_error:
            print(f"スレッド作成またはメッセージ送信エラー: {thread_error}")
            traceback.print_exc()
            try:
                 await interaction.edit_original_response(content="スレッドの作成中にエラーが発生しましたが、画像生成は完了しています。")
            except discord.NotFound:
                 await interaction.channel.send("スレッドの作成中にエラーが発生しましたが、画像生成は完了しています。")


    except Exception as e:
        print(f"画像生成コマンドエラー: {e}")
        traceback.print_exc()
        try:
            # followup.sendは一度しか使えないのでedit_original_responseを試す
            await interaction.edit_original_response(content=f"画像生成コマンドの実行中にエラーが発生しました: {str(e)}")
        except discord.NotFound:
             print("Interaction not found, cannot send error message.")
        except discord.InteractionResponded:
             # 既に編集などで応答済みの場合
             await interaction.channel.send(f"画像生成コマンドの実行中にエラーが発生しました: {str(e)}")
        except Exception as followup_error:
             print(f"Error sending error message: {followup_error}")

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
