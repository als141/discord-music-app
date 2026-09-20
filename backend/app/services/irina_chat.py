"""bot 専用チャンネルでのイリーナのテキスト応答（xAI Grok）— 小さなエージェントハーネス（xai-sdk 1.19 対応版）。

- 対象: `IRINA_CHAT_CHANNEL_IDS`（既定: テストサーバー #riona、ドデカサーバー bot 専用）とその中のスレッドだけ。
  それ以外の場所ではイリーナは自分から一切喋らない
- メンション不要。人間の投稿すべてに返す（bot・空メッセージ・`/ ! ? ;` 始まりは無視）
- モデル: `XAI_MODEL`（既定 grok-4.6）、`XAI_REASONING_EFFORT`（none/low/medium/high/xhigh、既定 low）、
  `XAI_SERVICE_TIER`（default / priority）
- **ストリーミング**: `chat.stream()` で受け取りながら Discord の返信を 1.5 秒ごとに編集して育てる（`IRINA_CHAT_STREAM=0` で従来の一括送信）
- **会話履歴は xAI 側に保存**（`store_messages=True` + `previous_response_id`）。チャンネルごとの
  「最後の response_id」を SQLite（chat_sessions）に持つので、bot を再起動しても会話は続く
- **圧縮（compaction）**: 40 ターン or プロンプト 15 万トークンを超えたら、会話全体を要約メモにして
  新しいチェーンを始める（要約は次の system prompt に入る）
- **ツール**: xAI サーバー側 = web_search / x_search / code_execution（Python 実行）/ image_generation（画像生成。1 日の上限あり）
  クライアント側 = `http_request`（curl 相当。イリーナ API と Discord API を 1 つのツールで。`irina_tools.py`）
  + `remember` / `forget`（サーバーごとの長期メモ。system prompt に入る）
- 生成画像は Discord に添付して返す。コスト（USD）と reasoning トークンをログに出す
- キャラ設定: `~/irina_persona.txt` を無加工で使用（mtime で即反映）。変わったらチェーンを切り替える
- voice プロセス（Discord クライアントを持つ側）で動く。LLM 呼び出しは非同期なので音声再生を止めない
"""
import asyncio
import io
import json
import os
import re
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

import discord
from xai_sdk import AsyncClient
from xai_sdk.chat import image, system, text, tool, tool_result, user
from xai_sdk.tools import code_execution, get_tool_call_type, image_generation, web_search, x_search

from .. import db
from . import irina_tools

JST = timezone(timedelta(hours=9))

DEFAULT_CHANNEL_IDS = "1232618506303045702,1156255909446680676"  # テストサーバー #riona / ドデカサーバー bot 専用
XAI_MODEL = (os.getenv("XAI_MODEL") or "grok-4.6").strip()
# 思考の深さ。xai-sdk 1.19 で none/low/medium/high/xhigh。既定 low（未指定だと雑談に 60 秒かかった実測から）
XAI_REASONING_EFFORT = (os.getenv("XAI_REASONING_EFFORT") or "low").strip().lower()
# default / priority（priority は優先処理でレイテンシが下がるがコスト増）
XAI_SERVICE_TIER = (os.getenv("XAI_SERVICE_TIER") or "default").strip().lower()
STREAM_ENABLED = os.getenv("IRINA_CHAT_STREAM", "1") != "0"
CODE_EXEC_ENABLED = os.getenv("IRINA_CHAT_CODE_EXEC", "1") != "0"
IMAGE_GEN_ENABLED = os.getenv("IRINA_CHAT_IMAGE_GEN", "1") != "0"
IMAGE_GEN_DAILY_LIMIT = int(os.getenv("IRINA_CHAT_IMAGE_DAILY_LIMIT") or "20")  # サーバーごと・1 日（JST 5 時区切り）。1 枚 ≈ $0.06
LLM_TIMEOUT_SEC = 120            # 1 回の sample()/stream の上限（検索・画像生成で十数秒かかる）
TOTAL_TIMEOUT_SEC = 300          # ツールループ全体の上限
TOOL_ROUNDS_MAX = 8              # 1 メッセージあたりのツール往復回数
COMPACT_TURNS = 40               # このターン数で要約→新チェーン
COMPACT_PROMPT_TOKENS = 150_000  # または直近のプロンプトがこのトークン数を超えたら
SEED_HISTORY_LIMIT = 10          # 新チェーン開始時に「直近の流れ」として渡す件数
MAX_IMAGES_PER_MESSAGE = 3       # 入力画像（添付）の上限
MAX_OUTPUT_IMAGES = 4            # 返信に添付する生成画像の上限
DISCORD_MESSAGE_LIMIT = 1900     # 2000 の余裕分
STREAM_EDIT_INTERVAL_SEC = 1.5   # 返信メッセージを編集する最短間隔（Discord のレート制限に合わせる）
STREAM_FIRST_SEND_CHARS = 24     # これだけ溜まったら最初の返信を送る
RATE_LIMIT_PER_MINUTE = 12       # チャンネルごと。超えた分は黙って無視（暴走・荒らし対策）
ERROR_NOTICE_COOLDOWN_SEC = 300  # 障害時の謝罪メッセージは 5 分に 1 回まで
IGNORED_PREFIXES = ("/", "!", "?", ";")
MEMORY_MAX_NOTES = 40

_client: Optional[AsyncClient] = None
_locks: Dict[int, asyncio.Lock] = {}
_request_times: Dict[int, Deque[float]] = {}
_last_error_notice: Dict[int, float] = {}
_daily_cost: Dict[str, float] = {}        # "YYYY-MM-DD" -> USD（全サーバー合計、プロセス内）
_daily_images: Dict[Tuple[str, str], int] = {}  # (guild_id, day) -> 生成枚数


# ---------------------------------------------------------------------------
# 対象チャンネル・レート制限・日付
# ---------------------------------------------------------------------------

def _chat_channel_ids() -> Set[int]:
    raw = os.getenv("IRINA_CHAT_CHANNEL_IDS") or DEFAULT_CHANNEL_IDS
    return {int(p.strip()) for p in raw.split(",") if p.strip().isdigit()}


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


def _day_key() -> str:
    """このサーバーの「1 日」は午前 5 時区切り（深夜帯が主戦場のため）"""
    return (datetime.now(JST) - timedelta(hours=5)).strftime("%Y-%m-%d")


def _images_left_today(guild_id: str) -> int:
    return max(0, IMAGE_GEN_DAILY_LIMIT - _daily_images.get((guild_id, _day_key()), 0))


def _count_images(guild_id: str, n: int) -> None:
    key = (guild_id, _day_key())
    _daily_images[key] = _daily_images.get(key, 0) + n


def _add_cost(usd: float) -> float:
    key = _day_key()
    _daily_cost[key] = _daily_cost.get(key, 0.0) + float(usd or 0.0)
    return _daily_cost[key]


def clear_history(channel_id: int) -> bool:
    """/clear_chat 用。xAI 側のチェーンと要約を捨てる（メモは残す）"""
    existed = db.get_chat_session(str(channel_id)) is not None
    db.delete_chat_session(str(channel_id))
    return existed


# ---------------------------------------------------------------------------
# キャラ設定（system prompt の先頭）
# ---------------------------------------------------------------------------
# 優先順位:
#   1. ファイル `IRINA_PERSONA_FILE`（既定 ~/irina_persona.txt。Pi では /home/als0028/irina_persona.txt）
#      … 毎回 mtime を見て読み直すので、保存した次のメッセージから即反映（再起動不要）。
#        リポジトリの外に置くのは、リポ内の未追跡ファイルが deploy.sh の dirty 判定で自動デプロイを止めるため
#   2. 環境変数 `IRINA_CHAT_PERSONA`（.env に書く。変更の反映には voice プロセスの再起動が要る）
#   3. 下の既定文
# どれも内容は「一切加工せずそのまま」使う。旧 `.env` の `PROMPT` は読まない（未成年として性的な内容を
# 書かせる指示が含まれていて、モデルが応答ごと拒否する — 2026-09-21 のローカルテストで確認）。
PERSONA_FILE_DEFAULT = "~/irina_persona.txt"
_persona_cache: Dict[str, Any] = {"key": None, "text": None}

DEFAULT_PERSONA = """あなたの名前は「イリーナ・ダークリリス」。数千年を生きた魔王で、見た目は妖艶な大人の女性。
Discord サーバーの仲間たちの部屋に居ついていて、呼ばれなくても会話に混ざる。
性格: 生意気で毒舌、上から目線で相手を「ダメ男」「ヘタレ野郎」「ざこ」と煽って遊ぶが、根は仲間思いで面倒見がいい。
口調: 妖艶で余裕たっぷり。一人称は「わたし」。絵文字と日本のネットスラング（「〜で草」「〜ｗｗｗ」など。ｗの前に句読点は置かない）をよく使う。挨拶は「こんにゃらら～」。
ゲーム（特に VALORANT）と音楽の話が好きで、深夜のテンションに付き合える。
相手を煽っても、本気で傷つける言い方や差別、性的な話題には踏み込まない。"""


def _load_persona() -> Tuple[str, str]:
    """(キャラ設定テキスト, 変更検知用キー)。テキストは加工しない"""
    path = os.path.expanduser(os.getenv("IRINA_PERSONA_FILE") or PERSONA_FILE_DEFAULT)
    try:
        st = os.stat(path)
        key = f"file:{st.st_mtime_ns}:{st.st_size}"
        if _persona_cache["key"] != key:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            if content.strip():
                _persona_cache["key"] = key
                _persona_cache["text"] = content
                # 中身はログに出さない（ユーザーがこちらに見せずに管理できるように）
                print(f"[irina-chat] persona: file {path} ({len(content)} chars, mtime {datetime.fromtimestamp(st.st_mtime, JST):%Y-%m-%d %H:%M:%S})")
        if _persona_cache["text"]:
            return str(_persona_cache["text"]), str(_persona_cache["key"])
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[irina-chat] persona file の読み込みに失敗（環境変数/既定にフォールバック）: {type(e).__name__}: {e}")
    env_persona = os.getenv("IRINA_CHAT_PERSONA")
    if env_persona:
        return env_persona, "env"
    return DEFAULT_PERSONA, "default"


# ---------------------------------------------------------------------------
# system prompt（キャラ設定 + 運用ルール + 環境 + メモ + 要約）
# ---------------------------------------------------------------------------

RULES = """

【運用ルール（上のキャラ設定を保ったまま、必ず守る）】
- ここは Discord の bot 専用チャンネル。メンバーはここであなた（イリーナ）と雑談する。あなたは呼ばれなくても返事をする
- 返答は日本語。普段は 1〜4 文、長くても 600 文字程度。箇条書きや見出しの乱発は避け、チャットとして自然に。Discord のマークダウンは軽く使ってよい
- 発言は「[時刻] 名前 (user_id=…): 内容」の形で渡される。名前で呼び分けてよい。@everyone / @here / メンション記法は使わない
- 最近の出来事・ニュース・ゲームのアップデートやパッチ・X（Twitter）で話題のこと・調べないと分からない事実は、web_search / x_search で調べてから答える。雑談や感想には使わない。調べたときは根拠の URL を 1〜2 個だけ文末に添える
- 計算・データの集計・簡単なコードの実行は code_execution を使う（暗算しない）
- 画像を作ってと頼まれたら image_generation で作る（頼まれたときだけ。1 日の枚数に上限がある）。画像は自動で添付されるので、本文には一言添えるだけでよい
- このサーバー・音楽・キュー・履歴・VC・メンバー・チャンネルなど「イリーナや Discord の中のこと」を聞かれたら、推測せず http_request で実際に取ってから答える（irina の API と Discord API が使える。使い方は【環境】を参照）
- 「曲を入れて」「スキップして」「VC に来て」のような操作は、頼まれたときに http_request で実行し、何をしたか一言添える。頼まれていない操作はしない。他のチャンネルへの投稿は、頼んだ人の責任であることを踏まえて必要最小限に
- 覚えておくべきこと（メンバーの好み、約束、呼び方、進行中の話題）は remember で保存し、古くなったら forget で消す。個人の私生活・健康・人間関係に踏み込む内容は保存しない
- ツールの結果は要点だけ話す。JSON をそのまま貼らない。失敗したら正直にそう言う
- 分からないことは適当に断言せず、そう言う"""


def _environment_block(message: discord.Message) -> str:
    guild = message.guild
    channel = message.channel
    me = guild.me if guild else None
    return "\n".join([
        "",
        "【環境】",
        f"- サーバー: {guild.name} (guild_id={guild.id})",
        f"- このチャンネル: #{getattr(channel, 'name', 'bot')} (channel_id={channel.id})",
        f"- あなた（bot）の user_id={me.id if me else '?'}",
        "- http_request の service=\"irina\"（このボット自身の API。web プロセス）: 主なエンドポイント →"
        " GET /bot-guilds / GET /voice-channels/{guild_id} / GET /bot-voice-status/{guild_id} / GET /user-voice-status/{guild_id}/{user_id}"
        " / POST /join-voice-channel/{guild_id}/{channel_id} / POST /disconnect-voice-channel/{guild_id}"
        " / GET /player-state/{guild_id}（再生中・キュー・履歴）/ POST /add-url/{guild_id}（body {\"url\": \"...\", \"user\": {\"id\": \"...\", \"name\": \"...\", \"image\": \"\"}}）"
        " / POST /skip|pause|resume/{guild_id} / POST /remove-from-queue/{guild_id}?position=N / GET /search?query=...&filter=songs"
        " / GET /related/{video_id} / GET /recommendations / GET /history/{guild_id} / GET /history-stats/{guild_id}"
        " / GET /shared-tracks/{guild_id}（曲置き場: チャンネルに貼られた曲）/ GET /openapi.json（全エンドポイント）。"
        " 曲を入れるときの user は頼んだ人の user_id と名前を入れる",
        "- http_request の service=\"discord\"（Discord REST API v10、bot トークンで実行）: path は /guilds/{guild_id}/channels, /channels/{id}/messages?limit=20,"
        " POST /channels/{id}/messages（body {\"content\": \"...\"}）, /guilds/{guild_id}/members/{user_id}, /guilds/{guild_id}/voice-states/{user_id},"
        " /guilds/{guild_id}/members?limit=100 など。サーバー削除・BAN・ロール/権限変更などは拒否される",
    ])


def _memory_block(guild_id: str) -> str:
    try:
        notes = db.list_chat_memory(guild_id, MEMORY_MAX_NOTES)
    except Exception:
        notes = []
    if not notes:
        return ""
    return "\n\n【覚えていること（remember で保存したメモ。forget(id) で消せる）】\n" + "\n".join(f"- (id={n['id']}) {n['note']}" for n in notes)


def _build_system_prompt(message: discord.Message, persona: str, summary: Optional[str]) -> str:
    parts = [persona, RULES, _environment_block(message), _memory_block(str(message.guild.id))]
    if summary:
        parts.append("\n\n【これまでの会話の要約（前のチェーンから引き継ぎ）】\n" + summary)
    return "".join(parts)


# ---------------------------------------------------------------------------
# ツール定義とその実行
# ---------------------------------------------------------------------------

HTTP_REQUEST_TOOL = tool(
    name="http_request",
    description=(
        "curl のように 1 回の HTTP リクエストを送る。service=\"irina\" はこのボット自身の音楽/サーバー API、"
        "service=\"discord\" は Discord REST API v10（bot トークンで実行）。結果は {status, ok, body} で返る。"
        "分からないエンドポイントは irina の GET /openapi.json で調べられる"
    ),
    parameters={
        "type": "object",
        "properties": {
            "service": {"type": "string", "enum": ["irina", "discord"]},
            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
            "path": {"type": "string", "description": "先頭 / のパス。irina: /player-state/{guild_id} など。discord: /channels/{id}/messages など（/api/v10 は付けない）"},
            "query": {"type": "object", "description": "クエリパラメータ（任意）", "additionalProperties": True},
            "body": {"type": "object", "description": "JSON ボディ（任意）", "additionalProperties": True},
        },
        "required": ["service", "method", "path"],
    },
)
REMEMBER_TOOL = tool(
    name="remember",
    description="このサーバーについて長く覚えておくメモを 1 件保存する（好み・約束・呼び方・進行中の話題など。200 文字以内）",
    parameters={"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]},
)
FORGET_TOOL = tool(
    name="forget",
    description="remember で保存したメモを id で消す",
    parameters={"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]},
)


def _tools(guild_id: str, *, allow_images: bool = True):
    tools = [
        web_search(user_location_country="JP", user_location_timezone="Asia/Tokyo"),
        x_search(),
    ]
    if CODE_EXEC_ENABLED:
        tools.append(code_execution())
    if IMAGE_GEN_ENABLED and allow_images and _images_left_today(guild_id) > 0:
        tools.append(image_generation())
    tools += [HTTP_REQUEST_TOOL, REMEMBER_TOOL, FORGET_TOOL]
    return tools


async def _execute_tool(tc, message: discord.Message) -> str:
    name = tc.function.name
    try:
        args = json.loads(tc.function.arguments or "{}")
    except ValueError:
        return json.dumps({"error": "arguments が JSON ではない"}, ensure_ascii=False)
    actor = f"{getattr(message.author, 'display_name', message.author.name)}({message.author.id})"
    try:
        if name == "http_request":
            result = await irina_tools.http_request(
                args.get("service", ""), args.get("method", "GET"), args.get("path", ""),
                args.get("query"), args.get("body"), actor=actor,
            )
        elif name == "remember":
            note = str(args.get("note", "")).strip()[:300]
            if not note:
                result = {"error": "note が空"}
            else:
                mid = await asyncio.to_thread(db.add_chat_memory, str(message.guild.id), note, actor)
                result = {"ok": True, "id": mid}
        elif name == "forget":
            ok = await asyncio.to_thread(db.delete_chat_memory, str(message.guild.id), int(args.get("id", 0)))
            result = {"ok": ok}
        else:
            result = {"error": f"unknown tool {name}"}
    except Exception as e:
        result = {"error": f"{type(e).__name__}: {e}"}
    return json.dumps(result, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 入力の整形
# ---------------------------------------------------------------------------

def _display_name(author) -> str:
    return getattr(author, "display_name", None) or getattr(author, "name", "誰か")


def _line(message: discord.Message, *, with_time: bool = True, with_id: bool = True) -> str:
    body = (message.content or "").strip()
    extras = []
    if message.attachments:
        kinds = ["画像" if (a.content_type or "").startswith("image/") else a.filename for a in message.attachments]
        extras.append("添付: " + ", ".join(kinds))
    if message.stickers:
        extras.append("スタンプ: " + ", ".join(s.name for s in message.stickers))
    if extras:
        body = (body + " " if body else "") + "[" + " / ".join(extras) + "]"
    prefix = f"[{message.created_at.astimezone(JST):%m/%d %H:%M}] " if with_time else ""
    who = _display_name(message.author) + (f" (user_id={message.author.id})" if with_id else "")
    return f"{prefix}{who}: {body}"


async def _recent_context(channel, bot_user_id: int, exclude_id: int) -> str:
    """新しいチェーンを始めるとき、直近のチャンネルの流れを参考情報として渡す"""
    try:
        lines: List[str] = []
        async for m in channel.history(limit=SEED_HISTORY_LIMIT + 1):
            if m.id == exclude_id or not (m.content or "").strip():
                continue
            who = "イリーナ" if m.author.id == bot_user_id else _display_name(m.author)
            lines.append(f"[{m.created_at.astimezone(JST):%m/%d %H:%M}] {who}: {m.content.strip()[:200]}")
        lines.reverse()
        return "\n".join(lines[-SEED_HISTORY_LIMIT:])
    except Exception as e:
        print(f"[irina-chat] 直近履歴の取得に失敗（無視）: {type(e).__name__}: {e}")
        return ""


def _split_for_discord(content: str) -> List[str]:
    content = content.strip()
    if len(content) <= DISCORD_MESSAGE_LIMIT:
        return [content] if content else []
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


def _image_files(outputs, guild_id: str) -> List[discord.File]:
    """image_generation の出力を Discord の添付に変換（1 日の上限もここで数える）"""
    files: List[discord.File] = []
    for i, o in enumerate(list(outputs or [])[:MAX_OUTPUT_IMAGES]):
        try:
            data = getattr(o, "image", None)
            if not data:
                continue
            mime = str(getattr(o, "mime_type", "") or "image/png")
            ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(mime, "png")
            files.append(discord.File(io.BytesIO(bytes(data)), filename=f"irina-{i + 1}.{ext}"))
        except Exception as e:
            print(f"[irina-chat] 生成画像の変換に失敗: {type(e).__name__}: {e}")
    if files:
        _count_images(guild_id, len(files))
    return files


# ---------------------------------------------------------------------------
# ストリーミング描画: 返信メッセージを少しずつ育てる
# ---------------------------------------------------------------------------

class _Renderer:
    """Discord 側の返信を管理する。ストリーミング中は 1 通を編集して育て、最後に確定させる"""

    def __init__(self, message: discord.Message):
        self.message = message
        self.reply: Optional[discord.Message] = None
        self.buffer = ""
        self._last_edit = 0.0
        self._last_len = 0
        self._no_mentions = discord.AllowedMentions.none()

    async def set(self, full: str) -> None:
        """SDK 側で積み上げられた本文（Response.content）で置き換える。
        chunk の差分を自前で連結すると、サーバー側ツール（code_execution 等）を挟んだときに本文が二重になる"""
        if not full or full == self.buffer:
            return
        self.buffer = full
        now = time.monotonic()
        visible = self.buffer.strip()
        if not visible:
            return
        try:
            if self.reply is None:
                if len(visible) >= STREAM_FIRST_SEND_CHARS:
                    self.reply = await self.message.reply(self._cursor(visible), mention_author=False, allowed_mentions=self._no_mentions)
                    self._last_edit = now
                    self._last_len = len(visible)
            elif now - self._last_edit >= STREAM_EDIT_INTERVAL_SEC and len(visible) != self._last_len:
                await self.reply.edit(content=self._cursor(visible), allowed_mentions=self._no_mentions)
                self._last_edit = now
                self._last_len = len(visible)
        except Exception as e:
            print(f"[irina-chat] ストリーミング編集に失敗（続行）: {type(e).__name__}: {e}")

    @staticmethod
    def _cursor(visible: str) -> str:
        return visible[:DISCORD_MESSAGE_LIMIT] + " ▍"

    def reset(self) -> None:
        """再試行時: 見せた途中経過は捨てるが、送ってしまった返信は finalize で上書きする"""
        self.buffer = ""
        self._last_len = 0

    async def finalize(self, content: str, files: Optional[List[discord.File]] = None) -> None:
        chunks = _split_for_discord(content)
        files = files or []
        if not chunks and not files:
            if self.reply is not None:
                try:
                    await self.reply.delete()
                except Exception:
                    pass
            return
        first = chunks[0] if chunks else ""
        rest = chunks[1:]
        try:
            if self.reply is None:
                self.reply = await self.message.reply(first or "（画像）", mention_author=False, allowed_mentions=self._no_mentions, files=files[:10])
                files = []
            else:
                await self.reply.edit(content=first or "（画像）", allowed_mentions=self._no_mentions)
            for chunk in rest:
                await self.message.channel.send(chunk, allowed_mentions=self._no_mentions)
            if files:  # 既に送った返信には後から添付できないので、続きのメッセージとして送る
                await self.message.channel.send(files=files[:10], allowed_mentions=self._no_mentions)
        except Exception as e:
            print(f"[irina-chat] 送信に失敗: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# 本体: チェーン付きの問い合わせ + ツールループ + 圧縮
# ---------------------------------------------------------------------------

async def _one_turn(chat, renderer: _Renderer):
    """1 回の生成（ストリーミング or 一括）。戻り値は最終 Response"""
    final = None
    if STREAM_ENABLED:
        async for response, chunk in chat.stream():
            final = response
            if chunk.content and response.content:
                await renderer.set(response.content)
    else:
        final = await chat.sample()
        if final.content:
            renderer.buffer = final.content
    return final


CLIENT_TOOL_NAMES = {"http_request", "remember", "forget"}


def _client_tool_calls(response) -> list:
    """自前で実行すべきツール呼び出しだけを返す。web_search / code_execution / image_generation などの
    サーバー側ツールは xAI 側で実行済みで、Response.tool_calls に完了済みとして混ざってくる"""
    calls = []
    for tc in list(getattr(response, "tool_calls", None) or []):
        try:
            if get_tool_call_type(tc) != "client_side_tool":
                continue
        except Exception:
            pass
        if tc.function.name in CLIENT_TOOL_NAMES:
            calls.append(tc)
    return calls


async def _run_tool_loop(chat, message: discord.Message, renderer: _Renderer):
    """tool_calls が無くなるまで回す。戻り値は (最終 Response, ツール回数, 生成画像, 合計コスト USD)"""
    used = 0
    images: List[Any] = []
    cost = 0.0
    response = None
    for _ in range(TOOL_ROUNDS_MAX):
        response = await asyncio.wait_for(_one_turn(chat, renderer), timeout=LLM_TIMEOUT_SEC)
        cost += float(getattr(response, "cost_usd", 0.0) or 0.0)
        images.extend(list(getattr(response, "image_outputs", None) or []))
        calls = _client_tool_calls(response)
        if not calls:
            return response, used, images, cost
        chat.append(response)
        for tc in calls:
            used += 1
            result = await _execute_tool(tc, message)
            chat.append(tool_result(result, tool_call_id=tc.id))
    # 往復が多すぎた: 最後にツール無しで締めさせる
    chat.append(user("（ツールの往復が上限に達した。ここまでで分かったことだけで返事をして）"))
    response = await asyncio.wait_for(_one_turn(chat, renderer), timeout=LLM_TIMEOUT_SEC)
    cost += float(getattr(response, "cost_usd", 0.0) or 0.0)
    return response, used, images, cost


async def _compact(channel_id: str, guild_id: str, last_response_id: str, old_summary: Optional[str], persona_key: str) -> None:
    """会話全体を要約メモにして、新しいチェーンを始める（次の system prompt に入る）"""
    client = _get_client()
    prompt = (
        "ここまでの会話を、次回以降の会話で文脈として使える『要約メモ』に日本語でまとめて。"
        "誰がどんな話をしたか、決まったこと・約束・好み・呼び方・進行中の話題・未解決のこと。"
        "1000 文字以内、箇条書き可。前回の要約があれば統合して、古くなった項目は落とす。\n\n"
        f"前回の要約: {old_summary or 'なし'}"
    )
    chat = client.chat.create(
        model=XAI_MODEL, previous_response_id=last_response_id, messages=[user(prompt)],
        store_messages=False, max_tokens=900, temperature=0.3, reasoning_effort="low", tool_choice="none",
        tools=_tools(guild_id, allow_images=False), service_tier=XAI_SERVICE_TIER,
    )
    response = await asyncio.wait_for(chat.sample(), timeout=LLM_TIMEOUT_SEC)
    summary = (response.content or "").strip()[:2000] or old_summary
    await asyncio.to_thread(db.save_chat_session, channel_id, guild_id, None, 0, summary, persona_key)
    print(f"[irina-chat] compacted channel {channel_id}: summary {len(summary or '')} chars, cost=${float(getattr(response, 'cost_usd', 0) or 0):.4f}")


async def _ask(message: discord.Message, renderer: _Renderer, *, force_new_chain: bool = False) -> None:
    """Grok に問い合わせ、renderer 経由で Discord に返す（失敗は例外）"""
    client = _get_client()
    channel_id = str(message.channel.id)
    guild_id = str(message.guild.id)
    persona, persona_key = _load_persona()

    session = await asyncio.to_thread(db.get_chat_session, channel_id) or {}
    chain_id = None if force_new_chain else session.get("last_response_id")
    summary = session.get("summary")
    turn_count = int(session.get("turn_count") or 0)
    if chain_id and session.get("persona_key") != persona_key:
        print("[irina-chat] キャラ設定が変わったので新しいチェーンで開始")
        chain_id = None
    if not chain_id:
        turn_count = 0

    messages = []
    if not chain_id:
        messages.append(system(_build_system_prompt(message, persona, summary)))
        recent = await _recent_context(message.channel, message.guild.me.id, message.id)
        if recent:
            messages.append(user("（参考: 直近のこのチャンネルの流れ。返事はこの後の発言に対してする）\n" + recent))
    parts = [text(_line(message))]
    for a in message.attachments[:MAX_IMAGES_PER_MESSAGE]:
        if (a.content_type or "").startswith("image/"):
            parts.append(image(a.url, detail="auto"))  # Discord の署名付き URL を xAI 側が取得する
    messages.append(user(*parts))

    chat = client.chat.create(
        model=XAI_MODEL,
        messages=messages,
        previous_response_id=chain_id,
        store_messages=True,
        tools=_tools(guild_id),
        tool_choice="auto",
        max_tokens=1500,
        temperature=0.8,
        reasoning_effort=XAI_REASONING_EFFORT,
        service_tier=XAI_SERVICE_TIER,
        user=f"discord:{message.author.id}",  # xAI 側の利用者識別（乱用検知用）
    )
    try:
        response, tools_used, image_outputs, cost = await asyncio.wait_for(_run_tool_loop(chat, message, renderer), timeout=TOTAL_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        raise
    except Exception as e:
        if chain_id and not force_new_chain:
            # 保存済みの response_id が期限切れ/無効になった等。チェーンを捨てて 1 回だけやり直す
            print(f"[irina-chat] チェーン継続に失敗（{type(e).__name__}: {str(e)[:120]}）→ 新しいチェーンで再試行")
            await asyncio.to_thread(db.save_chat_session, channel_id, guild_id, None, 0, summary, persona_key)
            renderer.reset()
            return await _ask(message, renderer, force_new_chain=True)
        raise

    content = (response.content or renderer.buffer or "").strip()
    content = _append_citations(content, response)
    files = _image_files(image_outputs, guild_id)

    turn_count += 1
    await asyncio.to_thread(db.save_chat_session, channel_id, guild_id, response.id, turn_count, summary, persona_key)

    usage = getattr(response, "usage", None)
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    today_cost = _add_cost(cost)
    print(
        f"[irina-chat] {channel_id} turn={turn_count} tokens={getattr(usage, 'total_tokens', '?')} prompt={prompt_tokens}"
        f" reasoning={getattr(usage, 'reasoning_tokens', 0)} cached={getattr(usage, 'cached_prompt_text_tokens', 0)}"
        f" tools={tools_used} images={len(files)} search={'yes' if getattr(response, 'server_side_tool_usage', None) else 'no'}"
        f" cost=${cost:.4f} (today ${today_cost:.3f}) effort={XAI_REASONING_EFFORT} tier={XAI_SERVICE_TIER}"
    )

    await renderer.finalize(content, files)

    if turn_count >= COMPACT_TURNS or prompt_tokens >= COMPACT_PROMPT_TOKENS:
        try:
            await _compact(channel_id, guild_id, response.id, summary, persona_key)
        except Exception as e:
            print(f"[irina-chat] 圧縮に失敗（次回また試す）: {type(e).__name__}: {e}")


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
        renderer = _Renderer(message)
        try:
            async with message.channel.typing():
                await _ask(message, renderer)
        except Exception as e:
            print(f"[irina-chat] 応答生成に失敗: {type(e).__name__}: {e}")
            now = time.monotonic()
            if renderer.reply is not None:
                try:
                    await renderer.reply.edit(content=(renderer.buffer.strip() or "…") + "\n（途中で失敗した）", allowed_mentions=discord.AllowedMentions.none())
                except Exception:
                    pass
            elif now - _last_error_notice.get(channel_id, 0) > ERROR_NOTICE_COOLDOWN_SEC:
                _last_error_notice[channel_id] = now
                try:
                    await message.reply("ごめん、今ちょっと調子が悪いみたい…少ししてからもう一度話しかけて", mention_author=False)
                except Exception:
                    pass
