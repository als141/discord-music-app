from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
import aiohttp
import os
from datetime import datetime, timedelta

router = APIRouter(prefix="/valorant", tags=["valorant"])

# API Endpoints
HENRIK_API_BASE = "https://api.henrikdev.xyz/valorant"
VALORANT_API_BASE = "https://valorant-api.com/v1"

# キャッシュ設定
CACHE_DURATION = timedelta(minutes=5)
store_cache = {}
player_cache = {}
asset_cache = {}

# Data Models
class ValorantPlayerCard(BaseModel):
    small: str
    large: str
    wide: str
    id: str
    assets: Dict[str, str]

class ValorantRank(BaseModel):
    tier: int
    tier_name: str
    division: str
    rank_score: int
    elo: Optional[int]
    images: Dict[str, str]

class ValorantWeaponSkin(BaseModel):
    uuid: str
    name: str
    price: Optional[int]
    image: str
    rarity: str
    rarity_weight: int
    featured: bool

class ValorantStore(BaseModel):
    daily_offers: List[ValorantWeaponSkin]
    featured_bundle: Optional[Dict]
    remaining_duration: Dict[str, int]

class ValorantAgent(BaseModel):
    uuid: str
    name: str
    role: str
    images: Dict[str, str]
    stats: Optional[Dict]

class ValorantPlayer(BaseModel):
    puuid: str
    game_name: str
    tag_line: str
    region: str
    account_level: int
    card: ValorantPlayerCard
    rank: Optional[ValorantRank]
    last_updated: str
    is_authenticated: bool

async def fetch_valorant_assets(type: str, uuid: str = None):
    """Valorant-APIからアセット情報を取得"""
    try:
        cache_key = f"{type}_{uuid}" if uuid else type
        if cache_key in asset_cache:
            cached_data = asset_cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < CACHE_DURATION:
                return cached_data["data"]

        async with aiohttp.ClientSession() as session:
            url = f"{VALORANT_API_BASE}/{type}"
            if uuid:
                url += f"/{uuid}"
            
            async with session.get(url, params={"language": "ja-JP"}) as response:
                if response.status != 200:
                    raise HTTPException(status_code=response.status, detail=f"Failed to fetch {type} data")
                data = await response.json()
                
                asset_cache[cache_key] = {
                    "timestamp": datetime.now(),
                    "data": data["data"]
                }
                return data["data"]
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/store/{puuid}", response_model=ValorantStore)
async def get_store(puuid: str):
    """Henrik's APIを使用してストア情報を取得"""
    try:
        cache_key = f"store_{puuid}"
        if cache_key in store_cache:
            cached_data = store_cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < CACHE_DURATION:
                return cached_data["data"]

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{HENRIK_API_BASE}/v1/store/{puuid}") as response:
                if response.status != 200:
                    raise HTTPException(status_code=response.status, detail="Failed to fetch store data")
                store_data = await response.json()

                # 各スキンの詳細情報をValorant-APIから取得
                skins = []
                for skin in store_data["data"]["daily_offers"]:
                    skin_details = await fetch_valorant_assets("weapons/skins", skin["uuid"])
                    skins.append({
                        "uuid": skin["uuid"],
                        "name": skin_details["displayName"],
                        "price": skin["cost"],
                        "image": skin_details["displayIcon"],
                        "rarity": skin_details["contentTierUuid"],
                        "rarity_weight": skin_details.get("rarity_weight", 0),
                        "featured": False
                    })

                store_info = ValorantStore(
                    daily_offers=skins,
                    featured_bundle=store_data["data"].get("featured_bundle"),
                    remaining_duration={
                        "daily": store_data["data"]["daily_reset_seconds"],
                        "featured": store_data["data"].get("featured_reset_seconds", 0)
                    }
                )

                store_cache[cache_key] = {
                    "timestamp": datetime.now(),
                    "data": store_info
                }
                return store_info

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/player/{name}/{tag}", response_model=ValorantPlayer)
async def get_player_info(name: str, tag: str):
    """Henrik's APIを使用してプレイヤー情報を取得し、Valorant-APIでアセットを補完"""
    try:
        cache_key = f"player_{name}_{tag}"
        if cache_key in player_cache:
            cached_data = player_cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < CACHE_DURATION:
                return cached_data["data"]

        async with aiohttp.ClientSession() as session:
            # プレイヤー基本情報を取得
            async with session.get(f"{HENRIK_API_BASE}/v1/account/{name}/{tag}") as response:
                if response.status != 200:
                    raise HTTPException(status_code=response.status, detail="Failed to fetch player data")
                player_data = await response.json()

            # MMR情報を取得
            async with session.get(f"{HENRIK_API_BASE}/v1/mmr/{player_data['data']['region']}/{name}/{tag}") as response:
                if response.status != 200:
                    raise HTTPException(status_code=response.status, detail="Failed to fetch rank data")
                rank_data = await response.json()

            # プレイヤーカードの詳細情報を取得
            card_details = await fetch_valorant_assets("playercards", player_data["data"]["card"]["id"])
            rank_tier_details = await fetch_valorant_assets("competitivetiers")
            
            current_rank_assets = None
            for tier in rank_tier_details:
                if tier["tier"] == rank_data["data"]["currenttier"]:
                    current_rank_assets = tier["largeIcon"]
                    break

            player_info = ValorantPlayer(
                puuid=player_data["data"]["puuid"],
                game_name=name,
                tag_line=tag,
                region=player_data["data"]["region"],
                account_level=player_data["data"]["account_level"],
                card=ValorantPlayerCard(
                    small=card_details["smallArt"],
                    large=card_details["largeArt"],
                    wide=card_details["wideArt"],
                    id=card_details["uuid"],
                    assets=card_details["displayIcon"]
                ),
                rank=ValorantRank(
                    tier=rank_data["data"]["currenttier"],
                    tier_name=rank_data["data"]["currenttierpatched"],
                    division=rank_data["data"]["ranking_in_tier"],
                    rank_score=rank_data["data"]["elo"],
                    elo=rank_data["data"].get("elo"),
                    images={
                        "small": current_rank_assets,
                        "large": current_rank_assets
                    }
                ),
                last_updated=datetime.now().isoformat(),
                is_authenticated=True
            )

            player_cache[cache_key] = {
                "timestamp": datetime.now(),
                "data": player_info
            }
            return player_info

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/agents", response_model=List[ValorantAgent])
async def get_agents():
    """Valorant-APIからエージェント情報を取得"""
    try:
        agents_data = await fetch_valorant_assets("agents")
        return [
            ValorantAgent(
                uuid=agent["uuid"],
                name=agent["displayName"],
                role=agent["role"]["displayName"],
                images={
                    "small": agent["displayIcon"],
                    "full": agent["fullPortrait"],
                    "bust": agent["bustPortrait"],
                    "killfeed": agent["killfeedPortrait"]
                },
                stats=None  # 必要に応じて追加
            )
            for agent in agents_data
            if agent["isPlayableCharacter"]  # プレイ可能なエージェントのみ
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))