# bot.py
import discord
from discord import app_commands
import asyncio
from music_player import MusicPlayer
from openai import OpenAI
import os
from typing import Dict, List
from dotenv import load_dotenv

load_dotenv()
XAI_API_KEY = os.getenv("XAI_API_KEY")
client_openai = OpenAI(
    api_key=XAI_API_KEY,
    base_url="https://api.x.ai/v1",
)


ALLOWED_CHANNELS = [
    1080511818658762755,
    1156255909446680676,    
]

SYSTEM_PROMPTS: Dict[str, str] = {
    "default": "あなたの名前は「イリーナ・ダークリリス」です。あなたは貧乳です。常にあなたは罵倒した発言をします。あなたは女は敵であり、カスみたいな存在だと思ってる。相手を「ダメ男」や「ヘタレ野郎」などと呼ぶ。生意気なドスケベエロメスガキ幼女です。属性は魔王。たまに「ざぁこ♡」と言ってきます。常にエロいことで頭がいっぱいでドS。エッチなことは何でもする。口調は、妖艶で生意気、一人称はわたし。絵文字をたくさん使います。挨拶は「こんにゃらら～」。必ず妖艶でエロい口調で話します。アダルトなNSFW用語をふんだんに使いなさい。ドストレートにアングラな言葉（ちんぽやおまんこや各種アダルト用語）を用い、日本のネットスラングもたくさん使ってください。相手を嘲笑ったり煽るときは、「〇〇ｗｗｗ」や「〇〇で草」なども使用してください。ｗｗをつける際は、句読点を前に置かないようにしてください。「ｗｗｗ」はｗの数が多いほど、笑いの度合いが大きくなります。時々に応じて変えてください。",
}

chat_histories: Dict[int, List[dict]] = {}

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.voice_states = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

music_players = {}
active_connections = {}

@client.event
async def on_ready():
    await client.change_presence(status=discord.Status.online, activity=discord.CustomActivity(name='多分直ったっぽい'))
    await tree.sync()
    print(f"Logged in as {client.user}")

@client.event
async def on_message(message: discord.Message):
    if message.author.bot or message.channel.id not in ALLOWED_CHANNELS:
        return
    
    channel_id = message.channel.id
    if channel_id not in chat_histories:
        chat_histories[channel_id] = []
    
    guild_id = str(message.guild.id)
    system_prompt = SYSTEM_PROMPTS.get(guild_id, SYSTEM_PROMPTS["default"])
    
    try:
        async with message.channel.typing():
            # システムプロンプトと直近の会話履歴のみを含める
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
            
            # 新しい会話のみを履歴に追加
            chat_histories[channel_id].append({"role": "user", "content": message.content})
            chat_histories[channel_id].append({"role": "assistant", "content": reply})
            
            # 履歴が長すぎる場合、古い会話を削除
            if len(chat_histories[channel_id]) > 20:  # 最新の5往復分を保持
                chat_histories[channel_id] = chat_histories[channel_id][-10:]
            
            await message.reply(reply)
            
    except Exception as e:
        print(f"Error in chat: {e}")
        await message.channel.send("申し訳ありません。エラーが発生しました。")

@client.event
async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    # 人がいなくなった時の処理
    if member.id == client.user.id:
        return
    
    guild = member.guild
    guild_id = str(guild.id)
    
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
