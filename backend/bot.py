import discord
from discord.ext import commands
import asyncio
from music_player import MusicPlayer

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.voice_states = True

bot = commands.Bot(command_prefix='!', intents=intents)
music_players = {}

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')

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
