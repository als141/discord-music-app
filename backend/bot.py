import discord
from discord.ext import commands
import asyncio
from music_player import MusicPlayer
from fastapi.encoders import jsonable_encoder

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.voice_states = True

bot = commands.Bot(command_prefix='!', intents=intents)
music_players = {}
active_connections = {}

async def notify_clients(guild_id: str):
    connections = active_connections.get(guild_id, [])
    for connection in connections:
        try:
            # 以下のインポートは関数内で行う（循環インポート防止）
            from api import get_current_track, get_queue, is_playing, get_history
            current_track = await get_current_track(guild_id)
            queue = await get_queue(guild_id)
            is_playing_status = await is_playing(guild_id)
            history = await get_history(guild_id)
            await connection.send_json({
                "type": "update",
                "data": {
                    "current_track": jsonable_encoder(current_track),
                    "queue": jsonable_encoder(queue),
                    "is_playing": is_playing_status,
                    "history": jsonable_encoder(history)
                }
            })
        except Exception as e:
            print(f"Error notifying client: {str(e)}")
            active_connections[guild_id].remove(connection)
            if not active_connections[guild_id]:
                del active_connections[guild_id]

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')

@bot.event
async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    if member.id == bot.user.id:
        return
        
    guild = member.guild
    guild_id = str(guild.id)
    
    if before.channel is None and after.channel is not None:
        if guild.voice_client is None:
            await after.channel.connect()
            if guild_id not in music_players:
                music_players[guild_id] = MusicPlayer(bot, guild, guild_id, notify_clients)
            print(f"Joined voice channel in {guild.name}: {after.channel.name}")
    
    elif before.channel is not None:
        if guild.voice_client and before.channel.id == guild.voice_client.channel.id:
            remaining_members = sum(1 for m in before.channel.members if not m.bot)
            
            if remaining_members == 0:
                await asyncio.sleep(5)
                current_members = sum(1 for m in before.channel.members if not m.bot)
                
                if current_members == 0:
                    await guild.voice_client.disconnect()
                    if guild_id in music_players:
                        del music_players[guild_id]
                    print(f"Left voice channel in {guild.name}: {before.channel.name} (no users remaining)")

    elif before.channel != after.channel:
        if guild.voice_client and after.channel:
            await guild.voice_client.move_to(after.channel)
            print(f"Moved to voice channel in {guild.name}: {after.channel.name}")
            
        if guild.voice_client and before.channel.id == guild.voice_client.channel.id:
            remaining_members = sum(1 for m in before.channel.members if not m.bot)
            
            if remaining_members == 0:
                await asyncio.sleep(5)
                current_members = sum(1 for m in before.channel.members if not m.bot)
                
                if current_members == 0:
                    await guild.voice_client.disconnect()
                    if guild_id in music_players:
                        del music_players[guild_id]
                    print(f"Left voice channel in {guild.name}: {before.channel.name} (no users remaining after move)")

@bot.command()
async def join(ctx):
    if ctx.author.voice is None:
        await ctx.send("You are not connected to a voice channel.")
        return

    channel = ctx.author.voice.channel
    if ctx.voice_client is None:
        await channel.connect()
    else:
        await ctx.voice_client.move_to(channel)

    guild_id = str(ctx.guild.id)
    if guild_id not in music_players:
        music_players[guild_id] = MusicPlayer(bot, ctx.guild)

@bot.command()
async def play(ctx, *, query):
    guild_id = str(ctx.guild.id)
    if guild_id not in music_players:
        await ctx.send("Bot is not connected to a voice channel. Use !join first.")
        return

    player = music_players[guild_id]
    await player.add_to_queue(query)
    await player.play()

@bot.command()
async def pause(ctx):
    guild_id = str(ctx.guild.id)
    if guild_id in music_players:
        await music_players[guild_id].pause()

@bot.command()
async def resume(ctx):
    guild_id = str(ctx.guild.id)
    if guild_id in music_players:
        await music_players[guild_id].resume()

@bot.command()
async def skip(ctx):
    guild_id = str(ctx.guild.id)
    if guild_id in music_players:
        await music_players[guild_id].skip()

@bot.command()
async def queue(ctx):
    guild_id = str(ctx.guild.id)
    if guild_id in music_players:
        await music_players[guild_id].show_queue()

@bot.command()
async def leave(ctx):
    guild_id = str(ctx.guild.id)
    if guild_id in music_players:
        await music_players[guild_id].leave()
        del music_players[guild_id]
