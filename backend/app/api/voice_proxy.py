"""web プロセス（IRINA_ROLE=web）用: bot 依存ルートを voice プロセスへ中継する。

`build_proxy_router(voice_router)` は voice ルーターの全ルート（HTTP と WebSocket）と同じ
パス・メソッドを持つ中継ルートを組み立てる。パスが同じなので frontend も openapi.json を見る
smoke_test も変更不要。voice プロセスが再起動中（deploy）の間は 503 を返し、WebSocket は
切れる（frontend は自動再接続する）。
"""
import asyncio
import os
from typing import Optional

import aiohttp
from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute, APIWebSocketRoute

VOICE_UPSTREAM = (os.getenv("IRINA_VOICE_UPSTREAM") or "http://127.0.0.1:8081").rstrip("/")
VOICE_UPSTREAM_WS = VOICE_UPSTREAM.replace("https://", "wss://", 1).replace("http://", "ws://", 1)

# 中継しないヘッダ（hop-by-hop と、aiohttp / Starlette が自分で付け直すもの）
_SKIP_REQUEST_HEADERS = {
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
}
# upstream の CORS ヘッダは捨てる（web プロセス側の CORSMiddleware が付け直す）
_SKIP_RESPONSE_HEADERS = _SKIP_REQUEST_HEADERS | {
    "content-encoding", "date", "server",
    "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods",
    "access-control-allow-headers", "access-control-expose-headers", "access-control-max-age", "vary",
}

UNAVAILABLE_DETAIL = "音声サービスに接続できません（再起動中の可能性があります）。数秒後にもう一度お試しください。"

_http_session: Optional[aiohttp.ClientSession] = None
_ws_session: Optional[aiohttp.ClientSession] = None


def _http() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        # join-voice-channel は最大 15 秒 + 再接続待ちがあるので余裕を持たせる
        _http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=90, sock_connect=5))
    return _http_session


def _ws() -> aiohttp.ClientSession:
    global _ws_session
    if _ws_session is None or _ws_session.closed:
        # WebSocket は張りっぱなしなので total を付けない（付けると一定時間で切れる）
        _ws_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=5))
    return _ws_session


async def close_sessions() -> None:
    for s in (_http_session, _ws_session):
        if s is not None and not s.closed:
            try:
                await s.close()
            except Exception:
                pass


async def upstream_health() -> str:
    """voice プロセスの生存確認（web の / ヘルスチェックに載せる）"""
    try:
        async with _http().get(f"{VOICE_UPSTREAM}/", timeout=aiohttp.ClientTimeout(total=3)) as resp:
            return "ok" if resp.status == 200 else f"http {resp.status}"
    except Exception:
        return "down"


async def _proxy_http(request: Request) -> Response:
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _SKIP_REQUEST_HEADERS}
    client_host = request.client.host if request.client else ""
    if client_host:
        headers["x-forwarded-for"] = client_host
    url = f"{VOICE_UPSTREAM}{request.url.path}"
    if request.url.query:
        url += f"?{request.url.query}"
    try:
        async with _http().request(
            request.method, url, data=body if body else None, headers=headers, allow_redirects=False
        ) as resp:
            content = await resp.read()
            out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in _SKIP_RESPONSE_HEADERS}
            return Response(content=content, status_code=resp.status, headers=out_headers)
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
        print(f"[voice-proxy] {request.method} {request.url.path} → upstream unavailable: {type(e).__name__}: {e}")
        return JSONResponse({"detail": UNAVAILABLE_DETAIL}, status_code=503)


async def _proxy_ws(websocket: WebSocket) -> None:
    """ブラウザ ⇄ web ⇄ voice の WebSocket 中継。どちらかが切れたら両方閉じる"""
    await websocket.accept()
    url = f"{VOICE_UPSTREAM_WS}{websocket.url.path}"
    if websocket.url.query:
        url += f"?{websocket.url.query}"
    try:
        async with _ws().ws_connect(url, heartbeat=None, autoping=True) as upstream:

            async def pump_downstream():
                async for msg in upstream:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        await websocket.send_text(msg.data)
                    elif msg.type == aiohttp.WSMsgType.BINARY:
                        await websocket.send_bytes(msg.data)
                    else:  # CLOSE / CLOSED / ERROR
                        break

            async def pump_upstream():
                while True:
                    msg = await websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if msg.get("text") is not None:
                        await upstream.send_str(msg["text"])
                    elif msg.get("bytes") is not None:
                        await upstream.send_bytes(msg["bytes"])

            tasks = {asyncio.create_task(pump_downstream()), asyncio.create_task(pump_upstream())}
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            for t in done:
                exc = t.exception()
                if exc is not None and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                    print(f"[voice-proxy] ws relay ended with {type(exc).__name__}: {exc}")
    except WebSocketDisconnect:
        pass
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
        print(f"[voice-proxy] ws {websocket.url.path} → upstream unavailable: {type(e).__name__}: {e}")
    finally:
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


def build_proxy_router(voice_router: APIRouter) -> APIRouter:
    """voice ルーターと同じパス・メソッドの中継ルートを持つルーターを作る"""
    router = APIRouter(tags=["voice (proxy)"])
    for route in voice_router.routes:
        if isinstance(route, APIWebSocketRoute):
            router.add_api_websocket_route(route.path, _proxy_ws, name=route.name)
        elif isinstance(route, APIRoute):
            router.add_api_route(
                route.path, _proxy_http, methods=sorted(route.methods or []), name=route.name,
                summary=f"{route.name}（voice プロセスへ中継）",
            )
    return router
