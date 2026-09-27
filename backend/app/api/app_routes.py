"""Web アプリの端末登録・通知・管理画面用の API（web プロセスで動く。bot は不要）。

本人確認は services/app_auth.py（Vercel が発行する短命トークン）。管理者は IRINA_ADMIN_USER_IDS。
"""
import asyncio
import os
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..services import push, push_events
from ..services.app_auth import AppUser, current_user, require_admin

router = APIRouter()

# プッシュの宛先として受け付けるサービス（任意 URL へのリクエストをさせない）
PUSH_HOST_SUFFIXES = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "push.apple.com",
    "notify.windows.com",
)
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
PERMISSIONS = {"granted", "denied", "default", "unsupported"}


def _valid_endpoint(url: str) -> bool:
    try:
        u = urlparse(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and len(url) <= 1000 and any(host == s or host.endswith("." + s) for s in PUSH_HOST_SUFFIXES)


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: PushKeys


class DeviceReport(BaseModel):
    device_id: str
    platform: str = Field(default="other", max_length=20)
    browser: str = Field(default="other", max_length=30)
    form_factor: str = Field(default="desktop", max_length=10)
    standalone: bool = False
    installed: bool = False  # appinstalled イベントを受けた
    permission: str = "default"
    subscription: Optional[PushSubscriptionIn] = None  # 今この端末にある購読（無ければ null＝消す）
    app_version: str = Field(default="", max_length=20)
    app_build: str = Field(default="", max_length=64)
    user_agent: str = Field(default="", max_length=400)


class PrefsIn(BaseModel):
    shelf: Optional[bool] = None
    vc_music: Optional[bool] = None


class AdminPushIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(default="", max_length=300)
    url: str = Field(default="/", max_length=300)
    user_ids: List[str] = Field(default_factory=list)  # 空なら全員


class ResubscribeIn(BaseModel):
    old_endpoint: str = Field(max_length=1000)
    subscription: PushSubscriptionIn


class ClickIn(BaseModel):
    log_id: int


def _public_device(d: Dict[str, Any]) -> Dict[str, Any]:
    """クライアントに返してよい項目だけ（購読の鍵・endpoint は返さない）"""
    return {
        "device_id": d["device_id"],
        "platform": d.get("platform"),
        "browser": d.get("browser"),
        "form_factor": d.get("form_factor"),
        "standalone": bool(d.get("standalone")),
        "installed": bool(d.get("ever_standalone")),
        "installed_at": d.get("installed_at"),
        "permission": d.get("notif_permission"),
        "push": bool(d.get("push_endpoint")),
        "push_last_ok_at": d.get("push_last_ok_at"),
        "push_last_error": d.get("push_last_error"),
        "app_version": d.get("app_version"),
        "app_build": d.get("app_build"),
        "first_seen_at": d.get("first_seen_at"),
        "last_seen_at": d.get("last_seen_at"),
    }


# ---------------------------------------------------------------------------
# 公開（認証なし）
# ---------------------------------------------------------------------------

@router.get("/push/vapid-public-key")
async def vapid_public_key():
    return {"key": push.public_key(), "enabled": push.configured()}


@router.post("/push/click")
async def push_click(body: ClickIn):
    """通知が開かれた（Service Worker から）。開封数を数えるだけ"""
    await asyncio.to_thread(db.count_push_click, body.log_id)
    return {"ok": True}


@router.post("/push/resubscribe")
async def push_resubscribe(body: ResubscribeIn):
    """購読がブラウザ側で更新された（Service Worker の pushsubscriptionchange）。古い endpoint を知っている端末だけが付け替えられる"""
    if not _valid_endpoint(body.subscription.endpoint):
        raise HTTPException(status_code=400, detail="unsupported push service")
    ok = await asyncio.to_thread(db.replace_push_subscription, body.old_endpoint, body.subscription.model_dump())
    return {"ok": ok}


# ---------------------------------------------------------------------------
# 本人
# ---------------------------------------------------------------------------

@router.post("/me/device")
async def report_device(body: DeviceReport, user: AppUser = Depends(current_user)):
    if not DEVICE_ID_RE.match(body.device_id):
        raise HTTPException(status_code=400, detail="bad device_id")
    permission = body.permission if body.permission in PERMISSIONS else "default"
    sub = body.subscription.model_dump() if body.subscription else {}
    if sub and not _valid_endpoint(sub["endpoint"]):
        raise HTTPException(status_code=400, detail="unsupported push service")
    # 同じ端末 ID が別ユーザーのものなら（ブラウザを共有してログインし直した等）そのまま上書きしてよい
    device = await asyncio.to_thread(
        db.upsert_app_device,
        device_id=body.device_id, user_id=user.id, user_name=user.name, user_image=user.image,
        platform=body.platform, browser=body.browser, form_factor=body.form_factor,
        standalone=body.standalone, installed=body.installed, notif_permission=permission,
        subscription=sub, app_version=body.app_version, app_build=body.app_build, user_agent=body.user_agent,
    )
    prefs = await asyncio.to_thread(db.get_notif_prefs, user.id)
    return {"device": _public_device(device), "prefs": prefs, "push_enabled": push.configured(), "is_admin": user.is_admin}


@router.delete("/me/device/{device_id}/push")
async def forget_push(device_id: str, user: AppUser = Depends(current_user)):
    devices = await asyncio.to_thread(db.list_app_devices, [user.id])
    if not any(d["device_id"] == device_id for d in devices):
        raise HTTPException(status_code=404, detail="device not found")
    await asyncio.to_thread(db.clear_push_subscription, device_id=device_id, error=None)
    return {"ok": True}


@router.get("/me/notification-prefs")
async def get_prefs(user: AppUser = Depends(current_user)):
    return await asyncio.to_thread(db.get_notif_prefs, user.id)


@router.put("/me/notification-prefs")
async def put_prefs(body: PrefsIn, user: AppUser = Depends(current_user)):
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    return await asyncio.to_thread(db.save_notif_prefs, user.id, changes)


_test_calls: Dict[str, List[float]] = {}


@router.post("/me/push-test")
async def push_test(user: AppUser = Depends(current_user)):
    now = time.time()
    recent = [t for t in _test_calls.get(user.id, []) if now - t < 60]
    if len(recent) >= 5:
        raise HTTPException(status_code=429, detail="少し待ってからもう一度試してください")
    _test_calls[user.id] = recent + [now]
    if not push.configured():
        raise HTTPException(status_code=503, detail="通知の送信が設定されていません")
    devices = await asyncio.to_thread(db.list_push_devices, [user.id])
    if not devices:
        raise HTTPException(status_code=409, detail="通知を受け取れる端末がありません")
    res = await push.send_logged(kind="test", title="テスト通知", body="イリーナからの通知はこんなふうに届きます",
                                 url="/", devices=devices, created_by=user.id, ttl=600, urgency="high")
    return res


# ---------------------------------------------------------------------------
# 管理者
# ---------------------------------------------------------------------------

_members_cache: Dict[str, Any] = {}
MEMBERS_TTL_SEC = 300


def _avatar_url(member: Dict[str, Any], guild_id: str) -> str:
    u = member.get("user") or {}
    uid = u.get("id") or "0"
    if member.get("avatar"):
        return f"https://cdn.discordapp.com/guilds/{guild_id}/users/{uid}/avatars/{member['avatar']}.png?size=64"
    if u.get("avatar"):
        return f"https://cdn.discordapp.com/avatars/{uid}/{u['avatar']}.png?size=64"
    return f"https://cdn.discordapp.com/embed/avatars/{(int(uid) >> 22) % 6}.png"


async def _guild_members(guild_id: str) -> Dict[str, Any]:
    """Discord REST でメンバー一覧（bot トークン、5 分キャッシュ）。bot は除く"""
    hit = _members_cache.get(guild_id)
    if hit and time.time() - hit["at"] < MEMBERS_TTL_SEC:
        return hit["data"]
    token = os.getenv("DISCORD_TOKEN") or ""
    headers = {"Authorization": f"Bot {token}", "User-Agent": "DiscordBot (irina, 1.0)"}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        async with s.get(f"https://discord.com/api/v10/guilds/{guild_id}", headers=headers) as r:
            guild = await r.json() if r.status == 200 else {}
        async with s.get(f"https://discord.com/api/v10/guilds/{guild_id}/members?limit=1000", headers=headers) as r:
            if r.status != 200:
                raise HTTPException(status_code=502, detail=f"メンバー一覧を取得できませんでした（Discord {r.status}）")
            raw = await r.json()
    members = []
    for m in raw:
        u = m.get("user") or {}
        if u.get("bot"):
            continue
        members.append({
            "id": u.get("id"),
            "name": m.get("nick") or u.get("global_name") or u.get("username"),
            "username": u.get("username"),
            "avatar": _avatar_url(m, guild_id),
            "joined_at": m.get("joined_at"),
        })
    data = {"guild": {"id": guild_id, "name": guild.get("name") or ""}, "members": members}
    _members_cache[guild_id] = {"at": time.time(), "data": data}
    return data


def _member_summary(devices: List[Dict[str, Any]]) -> Dict[str, Any]:
    perms = {d.get("notif_permission") for d in devices}
    return {
        "used": bool(devices),
        "installed": any(d.get("ever_standalone") for d in devices),
        "push": any(d.get("push_endpoint") for d in devices),
        "permission": "granted" if "granted" in perms else "denied" if "denied" in perms
        else "default" if "default" in perms else ("unsupported" if devices else None),
        "last_seen_at": max((d["last_seen_at"] for d in devices), default=None),
    }


@router.get("/admin/overview")
async def admin_overview(guild_id: Optional[str] = None, _: AppUser = Depends(require_admin)):
    gid = guild_id or sorted(push_events.push_guild_ids())[0]
    info = await _guild_members(gid)
    devices = await asyncio.to_thread(db.list_app_devices)
    prefs = await asyncio.to_thread(db.get_all_notif_prefs)
    by_user: Dict[str, List[Dict[str, Any]]] = {}
    names: Dict[str, Dict[str, str]] = {}
    for d in devices:
        by_user.setdefault(d["user_id"], []).append(d)
        names.setdefault(d["user_id"], {"name": d.get("user_name") or "", "avatar": d.get("user_image") or ""})

    def row(uid: str, base: Dict[str, Any]) -> Dict[str, Any]:
        ds = by_user.get(uid, [])
        return {**base, **_member_summary(ds), "devices": [_public_device(d) for d in ds],
                "prefs": prefs.get(uid, dict(db.DEFAULT_NOTIF_PREFS))}

    member_ids = {m["id"] for m in info["members"]}
    members = [row(m["id"], m) for m in info["members"]]
    others = [row(uid, {"id": uid, "name": names[uid]["name"], "avatar": names[uid]["avatar"], "username": None,
                        "joined_at": None}) for uid in by_user if uid not in member_ids]
    summary = {
        "members": len(members),
        "used": sum(1 for m in members if m["used"]),
        "installed": sum(1 for m in members if m["installed"]),
        "push": sum(1 for m in members if m["push"]),
        "denied": sum(1 for m in members if m["permission"] == "denied"),
    }
    log = await asyncio.to_thread(db.list_push_log, 20)
    return {"guild": info["guild"], "summary": summary, "members": members, "others": others,
            "push_log": log, "push_enabled": push.configured()}


@router.post("/admin/push")
async def admin_push(body: AdminPushIn, admin: AppUser = Depends(require_admin)):
    if not push.configured():
        raise HTTPException(status_code=503, detail="通知の送信が設定されていません")
    devices = await asyncio.to_thread(db.list_push_devices, body.user_ids or None)
    if not devices:
        raise HTTPException(status_code=409, detail="通知を受け取れる端末がありません")
    return await push.send_logged(kind="announce", title=body.title, body=body.body, url=body.url or "/",
                                  devices=devices, created_by=admin.id, ttl=3 * 24 * 3600)


@router.get("/admin/push-log")
async def admin_push_log(limit: int = 30, _: AppUser = Depends(require_admin)):
    return await asyncio.to_thread(db.list_push_log, max(1, min(limit, 100)))
