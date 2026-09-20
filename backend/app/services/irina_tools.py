"""イリーナのチャットから使う汎用 HTTP ツール（curl 相当）。

Grok に「用途別のツール」を並べるのではなく、1 つの `http_request` で
  - service="irina"   … このボットの API（web プロセス、既定 http://127.0.0.1:8080。検索/再生/キュー/棚/履歴…今後増える分も含めて全部）
  - service="discord" … Discord REST API v10（bot トークンで実行）
を叩けるようにする。

安全弁（8 人の身内サーバー前提で最小限）:
  - Discord の破壊的操作（サーバー/チャンネル削除、BAN/キック、ロール・権限変更、Webhook、アプリ設定）は
    既定で拒否。`IRINA_TOOL_ALLOW_DANGEROUS=1` で解除
  - 書き込み系（GET 以外）はチャンネルごとではなく全体で 1 分 20 回まで
  - 結果本文は 6000 文字で切る（コンテキスト保護）
"""
import asyncio
import json
import os
import re
import time
from collections import deque
from typing import Any, Deque, Dict, Optional
from urllib.parse import urlencode

import aiohttp

DISCORD_API_BASE = "https://discord.com/api/v10"
REQUEST_TIMEOUT_SEC = 30
MAX_BODY_CHARS = 6000
WRITES_PER_MINUTE = 20

# (method 正規表現, path 正規表現) — 既定で拒否する Discord 操作
_DANGEROUS_DISCORD = [
    (r"^DELETE$", r"^/guilds/\d+$"),
    (r"^PATCH$", r"^/guilds/\d+$"),
    (r"^DELETE$", r"^/channels/\d+$"),
    (r"^(PUT|DELETE)$", r"^/guilds/\d+/bans/"),
    (r"^DELETE$", r"^/guilds/\d+/members/\d+$"),
    (r"^PATCH$", r"^/guilds/\d+/members/"),          # ニックネーム・ミュート・移動の強制
    (r"^(POST|PATCH|PUT|DELETE)$", r"^/guilds/\d+/roles"),
    (r"^(PUT|DELETE)$", r"^/channels/\d+/permissions/"),
    (r"^(POST|PATCH|DELETE)$", r"^/channels/\d+/webhooks"),
    (r"^(GET|POST|PATCH|DELETE)$", r"^/webhooks"),
    (r"^POST$", r"^/guilds/\d+/prune"),
    (r"^POST$", r"^/channels/\d+/messages/bulk-delete"),
    (r"^(GET|POST|PATCH|PUT|DELETE)$", r"^/applications"),
    (r"^(GET|POST|PATCH|PUT|DELETE)$", r"^/oauth2"),
    (r"^PATCH$", r"^/users/@me$"),
    (r"^(POST|DELETE)$", r"^/guilds/\d+/channels$"),   # チャンネル作成/並び替え
    (r"^POST$", r"^/guilds$"),
    (r"^(PATCH|DELETE)$", r"^/guilds/\d+/(emojis|stickers|soundboard-sounds)"),
]
_IRINA_DENY_PATHS = [r"^/upload-audio", r"^/uploaded-audio-(edit|delete)"]  # multipart / 破壊的

_write_times: Deque[float] = deque()
_session: Optional[aiohttp.ClientSession] = None


def _http() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SEC, sock_connect=5))
    return _session


def _irina_base() -> str:
    return (os.getenv("IRINA_API_BASE") or "http://127.0.0.1:8080").rstrip("/")


def _is_dangerous_discord(method: str, path: str) -> bool:
    if os.getenv("IRINA_TOOL_ALLOW_DANGEROUS") == "1":
        return False
    return any(re.match(mp, method) and re.match(pp, path) for mp, pp in _DANGEROUS_DISCORD)


def _write_rate_limited() -> bool:
    now = time.monotonic()
    while _write_times and now - _write_times[0] > 60:
        _write_times.popleft()
    if len(_write_times) >= WRITES_PER_MINUTE:
        return True
    _write_times.append(now)
    return False


def _truncate(value: Any) -> Any:
    s = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    if len(s) <= MAX_BODY_CHARS:
        return value
    return s[:MAX_BODY_CHARS] + f"…（{len(s) - MAX_BODY_CHARS} 文字省略）"


async def http_request(service: str, method: str, path: str, query: Optional[Dict[str, Any]] = None,
                       body: Optional[Any] = None, actor: str = "") -> Dict[str, Any]:
    """1 回の HTTP リクエスト。戻り値は {"status", "ok", "body"} か {"error"}"""
    service = (service or "").strip().lower()
    method = (method or "GET").strip().upper()
    path = (path or "").strip()
    if service not in ("irina", "discord"):
        return {"error": "service は 'irina' か 'discord'"}
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        return {"error": "method は GET/POST/PUT/PATCH/DELETE"}
    if not path.startswith("/") or "://" in path or ".." in path:
        return {"error": "path は '/' で始まる相対パス（例: /player-state/123）"}
    # 誤って /api/v10 を付けてきた場合は剥がす
    path = re.sub(r"^/api/v\d+", "", path)

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if service == "discord":
        if _is_dangerous_discord(method, path):
            return {"error": f"{method} {path} はサーバーを壊しうる操作なので、このツールでは実行しない（オーナーに直接頼んでください）"}
        token = os.getenv("DISCORD_TOKEN")
        if not token:
            return {"error": "DISCORD_TOKEN が無い"}
        headers["Authorization"] = f"Bot {token}"
        headers["User-Agent"] = "DiscordBot (https://github.com/als141/discord-music-app, 1.0) IrinaChatTool"
        url = DISCORD_API_BASE + path
    else:
        if any(re.match(p, path) for p in _IRINA_DENY_PATHS):
            return {"error": f"{path} はこのツールからは使えない（ファイルアップロード/編集系）"}
        url = _irina_base() + path

    if method != "GET" and _write_rate_limited():
        return {"error": "書き込み系リクエストが多すぎる（1 分 20 回まで）。少し待ってから"}

    if query:
        try:
            url += ("&" if "?" in url else "?") + urlencode({k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v) for k, v in query.items()})
        except Exception as e:
            return {"error": f"query が不正: {e}"}

    data = None
    if body is not None and method != "GET":
        data = json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body

    for attempt in range(2):
        try:
            async with _http().request(method, url, data=data, headers=headers) as resp:
                raw = await resp.read()
                text = raw.decode("utf-8", errors="replace") if raw else ""
                parsed: Any
                try:
                    parsed = json.loads(text) if text else None
                except ValueError:
                    parsed = text
                if resp.status == 429 and attempt == 0:
                    retry_after = 1.0
                    if isinstance(parsed, dict) and isinstance(parsed.get("retry_after"), (int, float)):
                        retry_after = float(parsed["retry_after"])
                    if retry_after <= 5:
                        await asyncio.sleep(retry_after + 0.2)
                        continue
                print(f"[tool] {service} {method} {path} → {resp.status}" + (f" (by {actor})" if actor else ""))
                return {"status": resp.status, "ok": 200 <= resp.status < 300, "body": _truncate(parsed)}
        except asyncio.TimeoutError:
            return {"error": f"{service} {method} {path} がタイムアウト（{REQUEST_TIMEOUT_SEC}s）"}
        except aiohttp.ClientError as e:
            return {"error": f"{service} に接続できない: {type(e).__name__}: {e}"}
    return {"error": "レート制限で再試行しても失敗"}


async def close() -> None:
    if _session is not None and not _session.closed:
        try:
            await _session.close()
        except Exception:
            pass
