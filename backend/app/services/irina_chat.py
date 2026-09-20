"""bot 専用チャンネルでのイリーナのテキスト応答（xAI Grok）。

- 対象チャンネル（`IRINA_CHAT_CHANNEL_IDS`、既定は ALLOWED 2 本）と、その中に作られたスレッドだけで動く。
  それ以外の場所ではイリーナは自分から一切喋らない（「またボットが喋ってる」を作らないため）
- メンション不要。人間の投稿すべてに返す（bot・空メッセージ・スラッシュ/プレフィックス付きは無視）
- モデルは `XAI_MODEL`（既定 grok-4.6）。Web 検索 / X 検索はサーバーサイドツールとして常に渡し、
  使うかどうかはモデルに任せる（雑談では使わないよう system で指示）
- 会話履歴はチャンネルごとにメモリ保持（再起動後は直近のメッセージを読んで種を作る）
- 応答は Discord の 2000 文字制限に合わせて分割。@everyone/@here/個人メンションは無効化
- voice プロセス（Discord クライアントを持つ側）で動く。LLM 呼び出しは非同期なので音声再生を止めない
"""
import asyncio
import os
import re
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict, List, Optional, Set

import discord
from xai_sdk import AsyncClient
from xai_sdk.chat import assistant, image, system, text, user
from xai_sdk.tools import web_search, x_search

JST = timezone(timedelta(hours=9))

DEFAULT_CHANNEL_IDS = "1080511818658762755,1156255909446680676"  # テストサーバー / ドデカサーバーの bot 専用チャンネル
XAI_MODEL = (os.getenv("XAI_MODEL") or "grok-4.6").strip()
HISTORY_MAX_MESSAGES = 20        # 履歴に残すメッセージ数（user/assistant 合計）
SEED_HISTORY_LIMIT = 12          # 起動後最初の応答時に読み込む過去メッセージ数
MAX_IMAGES_PER_MESSAGE = 3
LLM_TIMEOUT_SEC = 90             # ツール（検索）を使うと十数秒かかることがある
DISCORD_MESSAGE_LIMIT = 1900     # 2000 の余裕分
RATE_LIMIT_PER_MINUTE = 12       # チャンネルごと。超えた分は黙って無視（暴走・荒らし対策）
ERROR_NOTICE_COOLDOWN_SEC = 300  # 障害時の謝罪メッセージは 5 分に 1 回まで
IGNORED_PREFIXES = ("/", "!", "?", ";")

_client: Optional[AsyncClient] = None
_histories: Dict[int, Deque] = {}
_locks: Dict[int, asyncio.Lock] = {}
_seeded: Set[int] = set()
_request_times: Dict[int, Deque[float]] = {}
_last_error_notice: Dict[int, float] = {}


def _chat_channel_ids() -> Set[int]:
    raw = os.getenv("IRINA_CHAT_CHANNEL_IDS") or DEFAULT_CHANNEL_IDS
    ids: Set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return ids


def is_chat_channel(channel) -> bool:
    """bot 専用チャンネル本体か、その中のスレッドなら True"""
    ids = _chat_channel_ids()
    if getattr(channel, "id", None) in ids:
        return True
    if isinstance(channel, discord.Thread) and channel.parent_id in ids:
        return True
    return False


def is_enabled() -> bool:
    return bool(os.getenv("XAI_API_KEY"))


def _get_client() -> AsyncClient:
    global _client
    if _client is None:
        _client = AsyncClient(api_key=os.getenv("XAI_API_KEY"), timeout=LLM_TIMEOUT_SEC)
    return _client


def _history(channel_id: int) -> Deque:
    if channel_id not in _histories:
        _histories[channel_id] = deque(maxlen=HISTORY_MAX_MESSAGES)
    return _histories[channel_id]


def clear_history(channel_id: int) -> bool:
    """/clear_chat 用。履歴があれば消して True"""
    _seeded.add(channel_id)  # 直後に過去ログから種を作り直さない
    hist = _histories.get(channel_id)
    if not hist:
        return False
    hist.clear()
    return True


def _lock(channel_id: int) -> asyncio.Lock:
    if channel_id not in _locks:
        _locks[channel_id] = asyncio.Lock()
    return _locks[channel_id]


def _rate_limited(channel_id: int) -> bool:
    now = time.monotonic()
    q = _request_times.setdefault(channel_id, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_MINUTE:
        return True
    q.append(now)
    return False


def _display_name(author) -> str:
    return getattr(author, "display_name", None) or getattr(author, "name", "誰か")


def _line(message: discord.Message) -> str:
    """履歴・入力用の 1 行表現。'名前: 内容' に添付の有無を添える"""
    body = (message.content or "").strip()
    extras = []
    if message.attachments:
        kinds = ["画像" if (a.content_type or "").startswith("image/") else a.filename for a in message.attachments]
        extras.append("添付: " + ", ".join(kinds))
    if message.stickers:
        extras.append("スタンプ: " + ", ".join(s.name for s in message.stickers))
    if extras:
        body = (body + " " if body else "") + "[" + " / ".join(extras) + "]"
    return f"{_display_name(message.author)}: {body}"


# キャラ設定（system prompt の先頭部分）の優先順位:
#   1. ファイル `IRINA_PERSONA_FILE`（既定 ~/irina_persona.txt。Pi では /home/als0028/irina_persona.txt）
#      … 毎回 mtime を見て読み直すので、保存した次のメッセージから即反映（再起動不要）。
#        リポジトリの外に置くのは、リポ内の未追跡ファイルが deploy.sh の dirty 判定で自動デプロイを止めるため
#   2. 環境変数 `IRINA_CHAT_PERSONA`（.env に書く。変更の反映には voice プロセスの再起動が要る）
#   3. 下の既定文
# どれも内容は「一切加工せずそのまま」使う。旧 `.env` の `PROMPT` は読まない（未成年として性的な内容を
# 書かせる指示が含まれていて、モデルが応答ごと拒否する — 2026-09-21 のローカルテストで確認）。
PERSONA_FILE_DEFAULT = "~/irina_persona.txt"
_persona_cache: Dict[str, object] = {"key": None, "text": None}


def _load_persona() -> str:
    path = os.path.expanduser(os.getenv("IRINA_PERSONA_FILE") or PERSONA_FILE_DEFAULT)
    try:
        st = os.stat(path)
        key = (path, st.st_mtime_ns, st.st_size)
        if _persona_cache["key"] != key:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            if text.strip():
                _persona_cache["key"] = key
                _persona_cache["text"] = text
                # 中身はログに出さない（ユーザーがこちらに見せずに管理できるように）
                print(f"[irina-chat] persona: file {path} ({len(text)} chars, mtime {datetime.fromtimestamp(st.st_mtime, JST):%Y-%m-%d %H:%M:%S})")
        if _persona_cache["text"]:
            return str(_persona_cache["text"])
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[irina-chat] persona file の読み込みに失敗（環境変数/既定にフォールバック）: {type(e).__name__}: {e}")
    return os.getenv("IRINA_CHAT_PERSONA") or DEFAULT_PERSONA


DEFAULT_PERSONA = """あなたの名前は「イリーナ・ダークリリス」。数千年を生きた魔王で、見た目は妖艶な大人の女性。
Discord サーバーの仲間たちの部屋に居ついていて、呼ばれなくても会話に混ざる。
性格: 生意気で毒舌、上から目線で相手を「ダメ男」「ヘタレ野郎」「ざこ」と煽って遊ぶが、根は仲間思いで面倒見がいい。
口調: 妖艶で余裕たっぷり。一人称は「わたし」。絵文字と日本のネットスラング（「〜で草」「〜ｗｗｗ」など。ｗの前に句読点は置かない）をよく使う。挨拶は「こんにゃらら～」。
ゲーム（特に VALORANT）と音楽の話が好きで、深夜のテンションに付き合える。
相手を煽っても、本気で傷つける言い方や差別、性的な話題には踏み込まない。"""


def _build_system_prompt(message: discord.Message) -> str:
    persona = _load_persona()  # ファイル / 環境変数の内容は加工しない
    guild_name = message.guild.name if message.guild else "Discord"
    channel_name = getattr(message.channel, "name", "bot")
    now = datetime.now(JST).strftime("%Y年%m月%d日(%a) %H:%M")
    rules = f"""

【運用ルール（上のキャラ設定を保ったまま、必ず守る）】
- ここは Discord サーバー「{guild_name}」の bot 専用チャンネル「#{channel_name}」。メンバーはここであなた（イリーナ）と雑談する。あなたは呼ばれなくても返事をする
- 返答は日本語。普段は 1〜4 文、長くても 600 文字程度。箇条書きや見出しの乱発は避け、チャットとして自然に。Discord のマークダウンは軽く使ってよい
- 発言は「名前: 内容」の形で渡される。名前で呼び分けてよい。@everyone / @here / メンション記法は使わない
- 最近の出来事・ニュース・ゲームのアップデートやパッチ・X（Twitter）で話題のこと・調べないと分からない事実を聞かれたら、web_search / x_search ツールで調べてから答える。雑談や感想には使わない。調べたときは根拠の URL を 1〜2 個だけ文末に添える
- 分からないことは適当に断言せず、そう言う
- 現在日時（日本時間）: {now}
- 音楽の再生・キュー操作はこのチャットではできない。聞かれたときだけ Web アプリ https://discord-music-app.vercel.app （または /play コマンド）を案内する"""
    return persona + rules


async def _seed_history(channel, bot_user_id: int) -> None:
    """再起動直後でも文脈が続くように、直近のメッセージを履歴に取り込む"""
    if channel.id in _seeded:
        return
    _seeded.add(channel.id)
    try:
        recent: List[discord.Message] = []
        async for m in channel.history(limit=SEED_HISTORY_LIMIT):
            recent.append(m)
        recent.reverse()
        hist = _history(channel.id)
        for m in recent[:-1]:  # 最後の 1 件は今回の入力なので除く
            content = (m.content or "").strip()
            if not content:
                continue
            if m.author.id == bot_user_id:
                hist.append(assistant(content))
            elif not m.author.bot:
                hist.append(user(_line(m)))
    except Exception as e:
        print(f"[irina-chat] 履歴の読み込みに失敗（無視して続行）: {type(e).__name__}: {e}")


def _split_for_discord(content: str) -> List[str]:
    content = content.strip()
    if len(content) <= DISCORD_MESSAGE_LIMIT:
        return [content]
    chunks: List[str] = []
    while len(content) > DISCORD_MESSAGE_LIMIT:
        cut = content.rfind("\n", 0, DISCORD_MESSAGE_LIMIT)
        if cut < DISCORD_MESSAGE_LIMIT // 2:
            cut = content.rfind("。", 0, DISCORD_MESSAGE_LIMIT)
        if cut < DISCORD_MESSAGE_LIMIT // 2:
            cut = DISCORD_MESSAGE_LIMIT
        chunks.append(content[:cut].strip())
        content = content[cut:].strip()
    if content:
        chunks.append(content)
    return chunks


def _append_citations(content: str, response) -> str:
    """検索を使ったのに本文に URL が無い場合だけ、出典を 1〜2 個添える"""
    try:
        used_tools = bool(getattr(response, "server_side_tool_usage", None))
        citations = [c for c in (getattr(response, "citations", None) or []) if isinstance(c, str) and c.startswith("http")]
    except Exception:
        return content
    if not used_tools or not citations or re.search(r"https?://", content):
        return content
    return content + "\n" + " ".join(f"<{c}>" for c in citations[:2])


async def _ask(message: discord.Message) -> Optional[str]:
    """Grok に問い合わせて返答テキストを返す（失敗は例外）"""
    client = _get_client()
    hist = _history(message.channel.id)

    parts = [text(_line(message))]
    for a in message.attachments[:MAX_IMAGES_PER_MESSAGE]:
        if (a.content_type or "").startswith("image/"):
            parts.append(image(a.url, detail="auto"))  # Discord の署名付き URL を xAI 側が取得する

    messages = [system(_build_system_prompt(message)), *list(hist), user(*parts)]
    chat = client.chat.create(
        model=XAI_MODEL,
        messages=messages,
        tools=[
            web_search(user_location_country="JP", user_location_timezone="Asia/Tokyo"),
            x_search(),
        ],
        tool_choice="auto",
        max_tokens=1200,
        temperature=0.8,
        # 雑談で 60 秒考え込まないように。low で雑談 7〜8 秒、検索込み 15〜20 秒（2026-09-21 実測）
        reasoning_effort="low",
    )
    response = await asyncio.wait_for(chat.sample(), timeout=LLM_TIMEOUT_SEC)
    content = (response.content or "").strip()
    if not content:
        return None
    content = _append_citations(content, response)

    # 履歴（画像はテキスト表現だけ残してトークンを節約）
    hist.append(user(_line(message)))
    hist.append(assistant(content))

    try:
        usage = getattr(response, "usage", None)
        tools_used = getattr(response, "server_side_tool_usage", None)
        print(f"[irina-chat] {message.channel.id} model={XAI_MODEL} tokens={getattr(usage, 'total_tokens', '?')} tools={'yes' if tools_used else 'no'}")
    except Exception:
        pass
    return content


async def handle_message(message: discord.Message) -> None:
    """on_message から呼ぶ。対象外・無視条件はここで判定して静かに戻る"""
    if not is_enabled():
        return
    if message.author.bot and os.getenv("IRINA_CHAT_ALLOW_BOTS") != "1":
        return
    if message.guild is None or not is_chat_channel(message.channel):
        return
    if message.author.id == message.guild.me.id:
        return
    content = (message.content or "").strip()
    if not content and not message.attachments:
        return
    if content.startswith(IGNORED_PREFIXES):
        return

    channel_id = message.channel.id
    if _rate_limited(channel_id):
        print(f"[irina-chat] rate limited (channel {channel_id})")
        return

    async with _lock(channel_id):
        await _seed_history(message.channel, message.guild.me.id)
        try:
            async with message.channel.typing():
                reply = await _ask(message)
        except Exception as e:
            print(f"[irina-chat] 応答生成に失敗: {type(e).__name__}: {e}")
            now = time.monotonic()
            if now - _last_error_notice.get(channel_id, 0) > ERROR_NOTICE_COOLDOWN_SEC:
                _last_error_notice[channel_id] = now
                try:
                    await message.reply("ごめん、今ちょっと調子が悪いみたい…少ししてからもう一度話しかけて", mention_author=False)
                except Exception:
                    pass
            return

        if not reply:
            return
        chunks = _split_for_discord(reply)
        no_mentions = discord.AllowedMentions.none()
        try:
            await message.reply(chunks[0], mention_author=False, allowed_mentions=no_mentions)
            for chunk in chunks[1:]:
                await message.channel.send(chunk, allowed_mentions=no_mentions)
        except Exception as e:
            print(f"[irina-chat] 送信に失敗: {type(e).__name__}: {e}")
