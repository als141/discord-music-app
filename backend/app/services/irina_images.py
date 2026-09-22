"""イリーナのチャットから使う「明示的な」画像生成ツール（xAI Image API を直接呼ぶ）。

会話中の `image_generation`（xAI サーバー側ツール。参照・追加編集が得意だが JPEG 固定・モデル指定不可）とは別に、
  - モデルを指定できる（grok-imagine-image-2.0 が既定、quality/pro も選べる）
  - PNG で返せる
  - 背景を透過にできる（rembg があれば AI 背景除去、無ければ単色背景のクロマキー）
  - アスペクト比・解像度を指定できる
  - 添付画像を参照画像として渡せる（image-to-image）
用途を Grok が選べるよう、ツール説明に違いを書いてある。
"""
import asyncio
import base64
import io
import os
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

DEFAULT_IMAGE_MODEL = os.getenv("XAI_IMAGE_MODEL") or "grok-imagine-image-2.0"
IMAGE_MODELS = {"grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-quality"}
ASPECT_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "1:2", "2:1"}

_rembg_session = None


def _rembg_available() -> bool:
    try:
        import rembg  # noqa: F401
        return True
    except Exception:
        return False


def _remove_background(img: Image.Image) -> Tuple[Image.Image, str]:
    """背景を透過にする。戻り値 (RGBA 画像, 使った方法)"""
    global _rembg_session
    try:
        from rembg import new_session, remove
        if _rembg_session is None:
            _rembg_session = new_session(os.getenv("IRINA_REMBG_MODEL") or "u2netp")  # 軽量モデル（Pi 4 でも数秒）
        out = remove(img.convert("RGB"), session=_rembg_session)
        return out.convert("RGBA"), "rembg"
    except Exception:
        pass
    # フォールバック: 四隅の色を背景色とみなして近い色を透過（単色背景のアイコン/イラスト向け）
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    tol = 40
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if d < tol:
                px[x, y] = (r, g, b, 0)
            elif d < tol * 2:
                px[x, y] = (r, g, b, int(255 * (d - tol) / tol))
    return rgba, "chroma-key"


def _to_png(data: bytes, *, transparent: bool) -> Tuple[bytes, str]:
    img = Image.open(io.BytesIO(data))
    method = "none"
    if transparent:
        img, method = _remove_background(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), method


async def generate(client, *, prompt: str, model: Optional[str] = None, transparent: bool = False,
                   output_format: str = "png", aspect_ratio: Optional[str] = None, quality: Optional[str] = None,
                   reference_data_urls: Optional[List[str]] = None, user: Optional[str] = None) -> Dict[str, Any]:
    """1 枚生成して {"bytes", "filename", "mime", "model", "cost_usd", "transparent_method"} を返す。失敗は例外"""
    model = model if model in IMAGE_MODELS else DEFAULT_IMAGE_MODEL
    kwargs: Dict[str, Any] = {"model": model, "image_format": "base64"}
    if aspect_ratio in ASPECT_RATIOS:
        kwargs["aspect_ratio"] = aspect_ratio
    if quality in ("low", "medium"):
        kwargs["quality"] = quality
    if user:
        kwargs["user"] = user
    refs = [u for u in (reference_data_urls or []) if u]
    if len(refs) == 1:
        kwargs["image_url"] = refs[0]
    elif refs:
        kwargs["image_urls"] = refs[:4]
    if transparent:
        prompt = prompt + "（背景は完全な単色の白で、被写体だけをはっきり描く）"
    res = await client.image.sample(prompt, **kwargs)
    raw = res.image
    if asyncio.iscoroutine(raw):
        raw = await raw
    raw = bytes(raw)
    out_format = (output_format or "png").lower()
    if out_format == "png" or transparent:
        data, method = await asyncio.to_thread(_to_png, raw, transparent=transparent)
        mime, ext = "image/png", "png"
    else:
        data, method, mime, ext = raw, "none", "image/jpeg", "jpg"
    return {
        "bytes": data, "filename": f"irina-{ext}.{ext}", "mime": mime, "model": getattr(res, "model", model),
        "cost_usd": float(getattr(res, "cost_usd", 0.0) or 0.0), "transparent_method": method,
    }


def data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"
