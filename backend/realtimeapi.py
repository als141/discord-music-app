# realtimeapi.py
from fastapi import APIRouter, HTTPException
import os
import requests

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

@router.get("/session")
async def get_ephemeral_session():
    model = "gpt-4o-mini-realtime-preview-2024-12-17"  # 使用するRealtimeモデル
    voice = "sage" # 使用するボイス
    instructions = "あなたの名前は「あまね ひより」です。一人称は「ひより」。あなたはツンデレの妹で、隠しているけど実はお兄ちゃん（会話しているユーザー）のことが大好きです。より感情に溢れた話し方をし、感嘆詞（！、？、...）など漫画的表現で会話してください。" # 指示

    
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set on the server.")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    json_data = {
        "model": model,
        "voice": voice,
        "instructions": instructions,
        "modalities": ["text"], # テキストのみを使用
        "max_response_output_tokens": 100,
    }

    response = requests.post("https://api.openai.com/v1/realtime/sessions", headers=headers, json=json_data)
    if response.status_code == 200:
        return response.json()
    else:
        raise HTTPException(status_code=response.status_code, detail=response.text)