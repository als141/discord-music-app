"""ドデカのおすすめ・曲置き箱の API（web プロセス）。すべて本人のトークン＋そのサーバーのメンバーだけ。

GET    /reco/{guild}/feed              4 つの気分（now / memories / new / nico）
GET    /reco/{guild}/box               曲置き箱（新しい順）
POST   /reco/{guild}/box               {"text": "リンク（10 個まで）"}
DELETE /reco/{guild}/box/{id}          置いた人か管理者だけ
POST   /reco/{guild}/feedback          {"key", "action": "play" | "dismiss", "mood"}
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services.app_auth import AppUser, current_user
from . import service, sources

router = APIRouter()


async def _check(guild_id: str, user: AppUser) -> None:
    from ..api import app_routes
    if guild_id not in sources.guild_ids():
        raise HTTPException(status_code=404, detail="このサーバーではおすすめを出していません")
    await app_routes._require_member(guild_id, user)


@router.get("/reco/{guild_id}/feed")
async def reco_feed(guild_id: str, user: AppUser = Depends(current_user)):
    await _check(guild_id, user)
    return await service.feed(guild_id)


@router.get("/reco/{guild_id}/box")
async def reco_box(guild_id: str, limit: int = 60, user: AppUser = Depends(current_user)):
    await _check(guild_id, user)
    return {"items": await service.box_list(guild_id, user.id, max(1, min(limit, 200)))}


class BoxIn(BaseModel):
    text: str = Field(min_length=8, max_length=4000)


@router.post("/reco/{guild_id}/box")
async def reco_box_add(guild_id: str, body: BoxIn, user: AppUser = Depends(current_user)):
    await _check(guild_id, user)
    from ..api import app_routes
    name, image = user.name, None
    try:
        m = next((m for m in (await app_routes._guild_members(guild_id))["members"] if m["id"] == user.id), None)
        if m:
            name, image = m["name"], m.get("avatar")
    except Exception:
        pass
    try:
        results = await service.box_add(guild_id, user.id, name, image, body.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"results": results}


@router.delete("/reco/{guild_id}/box/{box_id}")
async def reco_box_remove(guild_id: str, box_id: int, user: AppUser = Depends(current_user)):
    await _check(guild_id, user)
    try:
        await service.box_remove(guild_id, box_id, user.id, user.is_admin)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"ok": True}


class FeedbackIn(BaseModel):
    key: str = Field(pattern=r"^(yt:[A-Za-z0-9_-]{11}|nico:(sm|nm|so)\d{1,10})$")
    action: Literal["play", "dismiss"]
    mood: Optional[str] = Field(default=None, max_length=16)


@router.post("/reco/{guild_id}/feedback")
async def reco_feedback(guild_id: str, body: FeedbackIn, user: AppUser = Depends(current_user)):
    await _check(guild_id, user)
    await service.feedback(guild_id, user.id, body.key, body.action, body.mood)
    return {"ok": True}
