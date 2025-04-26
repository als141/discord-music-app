# bot.py
import discord
from discord import app_commands
import asyncio
from music_player import MusicPlayer
from openai import OpenAI
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO
import base64
from typing import Optional, Dict, List, Any, Union
import json
import urllib.request
from datetime import datetime
import aiohttp
import uuid

# 画像保存ディレクトリ
IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "saved_images")
# 画像保存ディレクトリが存在しない場合は作成
os.makedirs(IMAGE_DIR, exist_ok=True)

load_dotenv()
XAI_API_KEY = os.getenv("XAI_API_KEY")
client_openai = OpenAI(
    api_key=XAI_API_KEY,
    base_url="https://api.x.ai/v1",
)
PROMPT = os.getenv("PROMPT")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY)

ALLOWED_CHANNELS = [
    1080511818658762755,
    1156255909446680676,    
]

SYSTEM_PROMPTS: Dict[str, str] = {
    "default": PROMPT,
}

# スレッド会話履歴を保存する辞書
thread_histories = {}

chat_histories: Dict[int, List[dict]] = {}

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.voice_states = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

music_players = {}
active_connections = {}

# 画像をローカルに保存するヘルパー関数
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
    
    with open(filepath, "wb") as f:
        f.write(image_data)
    
    print(f"画像を保存しました: {filepath}")
    return filepath

# URLから画像データを取得する関数
async def download_image_from_url(url):
    """
    URLから画像データをダウンロードする
    
    Parameters:
    url (str): 画像のURL
    
    Returns:
    bytes: 画像データ
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.read()
                else:
                    print(f"画像ダウンロードエラー: HTTP {response.status}")
                    return None
    except Exception as e:
        print(f"画像ダウンロードエラー: {e}")
        return None

# URLから画像をBase64エンコードして取得する関数
async def get_base64_image_from_url(url):
    """
    URLから画像を取得してBase64エンコードする
    
    Parameters:
    url (str): 画像のURL
    
    Returns:
    str: Base64エンコードされた画像データ
    """
    try:
        # ダウンロードした画像データをBase64エンコード
        image_data = await download_image_from_url(url)
        if image_data:
            return base64.b64encode(image_data).decode('utf-8')
        return None
    except Exception as e:
        print(f"画像のBase64エンコードエラー: {e}")
        return None

# 会話履歴を使ってイメージ生成を行うヘルパー関数
async def generate_image_with_conversation(prompt: str, image_url=None, conversation=None):
    """
    会話履歴を使ってGemini APIで画像を生成する
    
    Parameters:
    prompt (str): 生成する画像の説明テキスト
    image_url (str, optional): 編集元の画像のURL
    conversation (list, optional): 会話履歴
    
    Returns:
    dict: 生成結果を含む辞書
    """
    try:
        # REST APIを直接使用するためのデータ準備
        request_data = {
            "contents": [],
            "generationConfig": {
                "temperature": 1.0,
                "topP": 0.95,
                "topK": 40,
                "responseModalities": ["TEXT", "IMAGE"],
                "maxOutputTokens": 8192
            }
        }
        
        # 会話履歴があれば追加
        if conversation:
            for message in conversation:
                msg_content = {
                    "role": "user" if message["role"] == "user" else "model",
                    "parts": []
                }
                
                # テキストコンテンツ
                if message.get("content"):
                    msg_content["parts"].append({"text": message["content"]})
                
                # 画像データ
                if message.get("image_url"):
                    base64_image = await get_base64_image_from_url(message["image_url"])
                    if base64_image:
                        msg_content["parts"].append({
                            "inlineData": {
                                "mimeType": "image/jpeg",
                                "data": base64_image
                            }
                        })
                
                # 内容があれば追加
                if msg_content["parts"]:
                    request_data["contents"].append(msg_content)
                    print(f"会話履歴に追加: {message['role']} - {'画像あり' if message.get('image_url') else '画像なし'}")
        
        # 新しいリクエストを追加
        user_content = {
            "role": "user",
            "parts": []
        }
        
        # 画像がある場合は追加
        if image_url:
            base64_image = await get_base64_image_from_url(image_url)
            if base64_image:
                user_content["parts"].append({
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": base64_image
                    }
                })
        
        # プロンプトを追加
        user_content["parts"].append({"text": prompt})
        request_data["contents"].append(user_content)
        
        # デバッグ出力
        print(f"リクエスト内容: {len(request_data['contents'])}つの会話ターン")
        
        # 直接REST APIを呼び出す
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=request_data) as response:
                if response.status != 200:
                    error_text = await response.text()
                    print(f"Gemini API エラー: HTTP {response.status}")
                    print(f"レスポンス: {error_text}")
                    return {
                        "success": False,
                        "error": f"APIエラー: HTTP {response.status} - {error_text}"
                    }
                
                # レスポンスをJSONとして解析
                response_data = await response.json()
                
                # レスポンスからテキストと画像を抽出
                text_response = ""
                image_data = None
                
                if (
                    "candidates" in response_data and 
                    response_data["candidates"] and 
                    "content" in response_data["candidates"][0] and
                    "parts" in response_data["candidates"][0]["content"]
                ):
                    parts = response_data["candidates"][0]["content"]["parts"]
                    
                    for part in parts:
                        if "text" in part:
                            text_response = part["text"]
                        elif "inlineData" in part:
                            # Base64でエンコードされた画像データをデコード
                            image_data = base64.b64decode(part["inlineData"]["data"])
                            
                            # 生成された画像を保存
                            if image_data:
                                await save_image(image_data, "generated")
                
                return {
                    "success": True,
                    "text": text_response,
                    "image_data": image_data
                }
    except Exception as e:
        print(f"Gemini API エラー: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# スレッド内メッセージを処理するハンドラー
async def handle_thread_message(message):
    """
    スレッド内のメッセージを処理するハンドラー関数
    """
    thread_id = message.channel.id
    
    # スレッドが追跡されているか確認
    if thread_id not in thread_histories:
        # 履歴がない場合は新規作成
        thread_histories[thread_id] = []
    
    try:
        async with message.channel.typing():
            # スレッドに添付画像があるかチェック
            image_attachment = None
            if message.attachments:
                for attachment in message.attachments:
                    if attachment.content_type and attachment.content_type.startswith('image/'):
                        image_attachment = attachment
                        break
            
            # 画像URLを取得
            image_url = None
            if image_attachment:
                image_url = image_attachment.url
                print(f"添付画像のURLを取得しました: {image_url}")
            
            # 会話履歴を取得（最大5ターン分）
            conversation_history = thread_histories[thread_id][-10:] if thread_histories[thread_id] else None
            
            # 画像生成を実行
            result = await generate_image_with_conversation(
                message.content, 
                image_url,
                conversation_history
            )
            
            if not result["success"]:
                await message.reply(f"画像生成に失敗しました: {result['error']}")
                return
            
            # 会話履歴にユーザーメッセージを追加
            thread_histories[thread_id].append({
                "role": "user", 
                "content": message.content,
                "image_url": image_url
            })
            
            # 埋め込みを作成
            embed = discord.Embed(
                title="画像生成結果",
                description=f"**プロンプト:** {message.content}",
                color=0x00AAFF
            )
            
            # テキスト応答があれば追加
            if result["text"] and result["text"].strip():
                embed.add_field(name="Geminiからの応答", value=result["text"], inline=False)
            else:
                embed.add_field(name="Geminiからの応答", value="(テキスト応答はありません)", inline=False)
            
            # 元の画像があれば、サムネイルとして表示
            if image_attachment:
                embed.set_thumbnail(url=image_attachment.url)
                embed.add_field(name="元画像", value=f"[{image_attachment.filename}]({image_attachment.url})", inline=True)
            
            reply_message = None
            
            # 画像データがある場合
            if result["image_data"]:
                # Discord用の画像ファイルを作成
                image_file = discord.File(BytesIO(result["image_data"]), filename="generated_image.png")
                
                # 応答を送信
                reply_message = await message.reply(embed=embed, file=image_file)
                
                # 生成された画像の添付ファイルURLを取得
                generated_image_url = None
                if reply_message and reply_message.attachments:
                    generated_image_url = reply_message.attachments[0].url
                    print(f"生成画像のURLを保存: {generated_image_url}")
            else:
                # 画像データがない場合はテキストのみ
                reply_message = await message.reply(embed=embed)
                generated_image_url = None
            
            # 応答を会話履歴に追加（画像URLを含む）
            thread_histories[thread_id].append({
                "role": "model",
                "content": result["text"] if result["text"] else "画像を生成しました。",
                "image_url": generated_image_url
            })
            
            # 会話履歴の内容をデバッグ出力
            print(f"スレッド {thread_id} の会話履歴: {len(thread_histories[thread_id])} メッセージ")
            for idx, msg in enumerate(thread_histories[thread_id]):
                print(f"  [{idx}] {msg['role']} - {'画像あり' if msg.get('image_url') else '画像なし'} - {msg['content'][:30]}...")
    
    except Exception as e:
        print(f"スレッド内メッセージ処理エラー: {e}")
        await message.reply("申し訳ありません。エラーが発生しました。")

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
    
    # システムチャネルの場合は既存のチャット処理を行う
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
                
                response = client_openai.chat.completions.create(
                    model="grok-2-1212",
                    messages=messages,
                )
                
                reply = response.choices[0].message.content
                
                chat_histories[channel_id].append({"role": "user", "content": message.content})
                chat_histories[channel_id].append({"role": "assistant", "content": reply})
                
                if len(chat_histories[channel_id]) > 20:
                    chat_histories[channel_id] = chat_histories[channel_id][-10:]
                
                await message.reply(reply)
                
        except Exception as e:
            print(f"Error in chat: {e}")
            await message.channel.send("申し訳ありません。エラーが発生しました。")
        return
    
    # スレッド内のメッセージかどうかをチェック
    if isinstance(message.channel, discord.Thread):
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
            from api import notify_clients  # 既存の通知関数を利用
            music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients)
            await notify_clients(guild_id)
            print(f"Auto-joined voice channel {after.channel.name} in guild {guild.name} because user {member.display_name} joined.")
        except Exception as e:
            print(f"Error auto-joining voice channel: {e}")

    # 既存の退室処理：ボイスチャンネル内のユーザーが全員退出した場合、ボットも切断する
    if before.channel is not None and guild.voice_client is not None and before.channel.id == guild.voice_client.channel.id:
        remaining_members = sum(1 for m in before.channel.members if not m.bot)
        if remaining_members == 0:
            await asyncio.sleep(5)
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
    from api import notify_clients
    music_players[guild_id] = MusicPlayer(client, guild, guild_id, notify_clients)
    await notify_clients(guild_id)
    await interaction.response.send_message(f"ボイスチャンネル {channel.name} に参加しました。")

@tree.command(name="generate_image", description="テキストから画像を生成します。オプションで元となる画像を添付できます。")
@app_commands.describe(
    prompt="生成したい画像の説明テキスト",
    image="オプション: 生成の元となる画像"
)
async def generate_image_command(interaction: discord.Interaction, prompt: str, image: Optional[discord.Attachment] = None):
    """
    テキストプロンプトと任意の画像から新しい画像を生成し、スレッドを作成するスラッシュコマンド
    """
    await interaction.response.defer(thinking=True)  # 生成には時間がかかるため、応答を遅延します
    
    try:
        # ギルド情報の検証
        if not interaction.guild:
            await interaction.followup.send("このコマンドはサーバー内でのみ使用できます。")
            return
        
        image_url = None
        if image:
            # 添付された画像のURLを取得
            image_url = image.url
            print(f"コマンドから画像URLを取得しました: {image_url}")
        
        # 画像生成
        result = await generate_image_with_conversation(prompt, image_url)
        
        if not result["success"]:
            await interaction.followup.send(f"画像生成に失敗しました: {result['error']}")
            return
        
        # 埋め込みを作成
        embed = discord.Embed(
            title="画像生成結果",
            description=f"**プロンプト:** {prompt}",
            color=0x00AAFF  # 水色
        )
        
        # テキスト応答があれば追加（常に表示）
        if result["text"] and result["text"].strip():
            embed.add_field(name="Geminiからの応答", value=result["text"], inline=False)
        else:
            embed.add_field(name="Geminiからの応答", value="(テキスト応答はありません)", inline=False)
        
        # 元の画像があれば、サムネイルとして表示
        if image:
            embed.set_thumbnail(url=image.url)
            embed.add_field(name="元画像", value=f"[{image.filename}]({image.url})", inline=True)
        
        response_message = None
        generated_image_url = None
        
        # 生成された画像があるかどうかで処理を分岐
        if result["image_data"]:
            # 生成された画像をファイルとして準備
            image_file = discord.File(BytesIO(result["image_data"]), filename="generated_image.png")
            
            # 画像付きメッセージを送信
            response_message = await interaction.followup.send(embed=embed, file=image_file)
            
            # 生成された画像の添付ファイルURLを取得
            if hasattr(response_message, 'attachments') and response_message.attachments:
                generated_image_url = response_message.attachments[0].url
                print(f"生成画像のURLを保存: {generated_image_url}")
        else:
            # 画像が生成されなかった場合はテキストのみ
            response_message = await interaction.followup.send(embed=embed)
        
        try:
            # チャンネルからスレッドを作成
            channel = interaction.channel
            thread_name = f"画像生成: {prompt[:50]}..." if len(prompt) > 50 else f"画像生成: {prompt}"
            
            # チャンネルからスレッドを作成
            try:
                thread = await channel.create_thread(
                    name=thread_name,
                    message=response_message,
                    auto_archive_duration=60,  # 60分後に自動アーカイブ
                    reason="画像生成スレッド"
                )
            except Exception as thread_error:
                print(f"スレッド作成エラー: {thread_error}")
                await interaction.followup.send("スレッドの作成に失敗しましたが、画像生成は成功しました。")
                return
            
            # スレッド内に応答を送信
            thread_message = f"画像生成を続けるには、このスレッドにメッセージを送信してください。"
            if result["text"] and result["text"].strip():
                thread_message = f"{result['text']}\n\n画像生成を続けるには、このスレッドにメッセージを送信してください。"
            
            thread_message_obj = await thread.send(thread_message)
            
            # スレッドの会話履歴を初期化
            thread_histories[thread.id] = [
                {
                    "role": "user", 
                    "content": prompt, 
                    "image_url": image_url
                },
                {
                    "role": "model", 
                    "content": result["text"] if result["text"] and result["text"].strip() else "画像を生成しました。", 
                    "image_url": generated_image_url
                }
            ]
            
            # 会話履歴の内容をデバッグ出力
            print(f"スレッド {thread.id} の会話履歴を初期化しました: {len(thread_histories[thread.id])} メッセージ")
            for idx, msg in enumerate(thread_histories[thread.id]):
                print(f"  [{idx}] {msg['role']} - {'画像あり' if msg.get('image_url') else '画像なし'} - {msg['content'][:30]}...")
            
        except Exception as thread_error:
            print(f"スレッド作成エラー: {thread_error}")
            await interaction.followup.send("スレッドの作成に失敗しましたが、画像生成は成功しました。")
    
    except Exception as e:
        print(f"画像生成コマンドエラー: {e}")
        await interaction.followup.send(f"エラーが発生しました: {str(e)}")

@tree.command(name="disconnect", description="現在参加中のボイスチャンネルから切断します。")
async def disconnect_channel(interaction: discord.Interaction):
    from api import notify_clients
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("このコマンドはギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    if guild.voice_client:
        await guild.voice_client.disconnect()
        if guild_id in music_players:
            del music_players[guild_id]
        await notify_clients(guild_id)
        await interaction.response.send_message("ボイスチャネルから切断しました。")
    else:
        await interaction.response.send_message("ボイスチャネルに接続していません。", ephemeral=True)

@tree.command(name="play", description="指定した楽曲を再生キューに追加して再生します。")
@app_commands.describe(url="再生する楽曲のURL・もしくはキーワード")
async def play_track(interaction: discord.Interaction, url: str):
    from api import add_and_play_track, notify_clients, Track
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if not player:
        await interaction.response.send_message("ボットはまだボイスチャネルに参加していません。/joinで参加してください。", ephemeral=True)
        return
    
    # まず処理中であることを通知
    await interaction.response.send_message("🎵 トラックを追加中です...")
    
    # 処理を非同期で実行
    track = Track(title="Loading...", artist="Unknown", thumbnail="", url=url)
    try:
        await add_and_play_track(guild_id, track)
        await notify_clients(guild_id)
        # メッセージを編集
        await interaction.edit_original_response(content="✅ トラックをキューに追加しました。まもなく再生されます。")
    except Exception as e:
        # エラーが発生した場合はエラーメッセージを表示
        await interaction.edit_original_response(content=f"❌ エラーが発生しました: {str(e)}")

@tree.command(name="pause", description="現在再生中のトラックを一時停止します。")
async def pause_track(interaction: discord.Interaction):
    from api import notify_clients
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and player.is_playing():
        await player.pause()
        await notify_clients(guild_id)
        await interaction.response.send_message("再生を一時停止しました。")
    else:
        await interaction.response.send_message("再生中のトラックがありません。", ephemeral=True)

@tree.command(name="resume", description="一時停止中のトラックを再開します。")
async def resume_track(interaction: discord.Interaction):
    from api import notify_clients
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and player.voice_client and player.voice_client.is_paused():
        await player.resume()
        await notify_clients(guild_id)
        await interaction.response.send_message("再生を再開しました。")
    else:
        await interaction.response.send_message("一時停止中のトラックがありません。", ephemeral=True)

@tree.command(name="skip", description="現在のトラックをスキップします。")
async def skip_track(interaction: discord.Interaction):
    from api import notify_clients
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player and player.is_playing():
        await player.skip()
        await notify_clients(guild_id)
        await interaction.response.send_message("次のトラックへスキップしました。")
    else:
        await interaction.response.send_message("スキップするトラックがありません。", ephemeral=True)

@tree.command(name="previous", description="前のトラックに戻ります。")
async def previous_track(interaction: discord.Interaction):
    from api import notify_clients
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player:
        await player.previous()
        await notify_clients(guild_id)
        await interaction.response.send_message("前のトラックに戻りました。")
    else:
        await interaction.response.send_message("戻れるトラックがありま��ん。", ephemeral=True)

@tree.command(name="queue", description="現在の再生キューを表示します。")
async def show_queue(interaction: discord.Interaction):
    from api import get_queue
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    queue = await get_queue(guild_id)
    if not queue:
        await interaction.response.send_message("キューは空です。", ephemeral=True)
        return
    description = "\n".join([f"{idx+1}. {item.track.title} by {item.track.artist}" for idx, item in enumerate(queue)])
    await interaction.response.send_message(f"現在のキュー:\n{description}")

@tree.command(name="nowplaying", description="現在再生中のトラックを表示します。")
async def now_playing(interaction: discord.Interaction):
    from api import get_current_track
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    current = await get_current_track(guild_id)
    if current:
        await interaction.response.send_message(f"現在再生中: {current.title} by {current.artist}")
    else:
        await interaction.response.send_message("現在再生中のトラックはありません。", ephemeral=True)

@tree.command(name="volume", description="音量を変更します(0.0～1.0)")
@app_commands.describe(value="設定する音量(0.0～1.0)")
async def set_volume(interaction: discord.Interaction, value: float):
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    if not (0.0 <= value <= 1.0):
        await interaction.response.send_message("音量は0.0～1.0の範囲で指定してください。", ephemeral=True)
        return
    guild_id = str(guild.id)
    player = music_players.get(guild_id)
    if player:
        await player.set_volume(value)
        await interaction.response.send_message(f"音量を{value}に設定しました。")
    else:
        await interaction.response.send_message("再生中のトラックがありません。", ephemeral=True)

@tree.command(name="history", description="再生履歴を表示します。")
async def show_history(interaction: discord.Interaction):
    from api import get_history
    guild = interaction.guild
    if guild is None:
        await interaction.response.send_message("ギルド内でのみ実行可能です。", ephemeral=True)
        return
    guild_id = str(guild.id)
    history = await get_history(guild_id)
    if not history:
        await interaction.response.send_message("再生履歴はありません。", ephemeral=True)
        return
    description = "\n".join([f"{item.position+1}. {item.track.title} by {item.track.artist}" for item in history])
    await interaction.response.send_message(f"再生履歴:\n{description}")
