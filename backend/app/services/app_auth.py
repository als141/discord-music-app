"""Web アプリ（Vercel）から来るリクエストの本人確認。

Vercel 側の `/api/irina-token` が NextAuth のセッション（Discord ログイン）を確かめたうえで、
短命（15 分）の HS256 トークンを発行する。ブラウザはそれを `Authorization: Bearer …` で付けて
このバックエンドを直接呼ぶ。署名鍵 `IRINA_API_SIGNING_KEY` は Vercel と Pi の .env にだけ置く。

- ユーザー ID は必ずトークンの `sub` から取る（ボディやクエリの自己申告は信じない）
- 管理者は `IRINA_ADMIN_USER_IDS`（カンマ区切りの Discord ユーザー ID）
"""
import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException

ISSUER = "irina-web"
AUDIENCE = "irina-api"
CLOCK_SKEW_SEC = 60


def _signing_key() -> bytes:
    key = os.getenv("IRINA_API_SIGNING_KEY") or ""
    return key.encode()


def admin_ids() -> set:
    return {x.strip() for x in (os.getenv("IRINA_ADMIN_USER_IDS") or "").split(",") if x.strip()}


@dataclass
class AppUser:
    id: str
    name: str
    image: str

    @property
    def is_admin(self) -> bool:
        return self.id in admin_ids()


def _b64url_decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def verify_token(token: str) -> AppUser:
    """署名・期限・発行者を確かめてユーザーを返す。ダメなら ValueError"""
    key = _signing_key()
    if not key:
        raise ValueError("signing key not configured")
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("malformed token")
    header_b64, payload_b64, sig_b64 = parts
    header = json.loads(_b64url_decode(header_b64))
    if header.get("alg") != "HS256":
        raise ValueError("unsupported alg")
    expected = hmac.new(key, f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
    # 文字列で比べる（base64 の末尾の遊びビットだけ違う「別表記」も通さない）
    expected_b64 = base64.urlsafe_b64encode(expected).rstrip(b"=").decode()
    if not hmac.compare_digest(expected_b64, sig_b64):
        raise ValueError("bad signature")
    payload = json.loads(_b64url_decode(payload_b64))
    now = time.time()
    if payload.get("iss") != ISSUER or payload.get("aud") != AUDIENCE:
        raise ValueError("bad issuer/audience")
    if float(payload.get("exp", 0)) < now - CLOCK_SKEW_SEC:
        raise ValueError("expired")
    sub = str(payload.get("sub") or "")
    if not sub.isdigit():
        raise ValueError("bad subject")
    return AppUser(id=sub, name=str(payload.get("name") or "")[:100], image=str(payload.get("image") or "")[:500])


def current_user(authorization: Optional[str] = Header(default=None)) -> AppUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="ログインが必要です")
    try:
        return verify_token(authorization[7:].strip())
    except Exception:  # 形式不正・署名違い・期限切れ・非 ASCII など、理由を問わず 401
        raise HTTPException(status_code=401, detail="ログインの確認に失敗しました。ページを読み込み直してください")


def require_admin(user: AppUser = Depends(current_user)) -> AppUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="管理者のみ使えます")
    return user
