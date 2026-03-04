# api/chat.py
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
import os
from openai import AsyncOpenAI

router = APIRouter()

# モジュールレベルでクライアントを作成（リクエスト毎の再作成を防止）
_openai_client: AsyncOpenAI | None = None

def _get_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _openai_client

@router.post("/chat")
async def chat(request: Request):
    data = await request.json()
    messages = data.get('messages', [])
    system_prompt = {
        'role': 'system',
        'content': 'あなたの名前は女性のアシスタントで、ユーザーにはユーモアに溢れた話し方をして、フレンドリーに話しかけます。より絵文字も使い、親近感のある便利なアシスタントです。'
    }
    openai_messages = [system_prompt] + [
        {'role': message['role'], 'content': message['content']}
        for message in messages
    ]

    async def openai_stream():
        client = _get_client()
        try:
            response = await client.chat.completions.create(
                model='gpt-4o-mini',
                messages=openai_messages,
                stream=True
            )
            async for chunk in response:
                content = chunk.choices[0].delta.content or ''
                yield content.encode('utf-8')
        except Exception as e:
            print(f"OpenAI APIエラー: {e}")
            raise HTTPException(status_code=500, detail="OpenAI APIでエラーが発生しました。")

    return StreamingResponse(openai_stream(), media_type='text/plain')
