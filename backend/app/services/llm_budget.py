"""LLM の月の上限（ゲーム置き場・界隈の自動処理だけ。イリーナの会話は対象外）。

オーナー指定（2026-10-11）: Claude は月 $100 まで。X の観測（Grok）は月 $20 を既定にする。
超えたら、その月は振り分け・選定・プロフィール・X 観測を止め、1 日 1 回だけログに出す。
IRINA_CLAUDE_MONTHLY_USD / IRINA_GROK_MONTHLY_USD で変えられる。費用は scene_llm_cost に 1 回ずつ残る。
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Dict

from .. import db

JST = timezone(timedelta(hours=9))
_warned: Dict[str, str] = {}

# $/100 万トークン（入力, 出力）。2026-10-11 時点の公式の値。web 検索は 1 回 $0.01
PRICES: Dict[str, tuple] = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),   # 入力 10 万トークン以下のとき（超えると $0.50/$2.50）
}
SEARCH_USD = 0.01
# キャッシュの読み出しは入力の何倍か（書き込みは 5 分の TTL で 1.25 倍）
CACHE_READ = {"claude-fable-5-1": 0.025, "claude-opus-5-5": 0.05}


def cost(model: str, usage) -> float:
    """Anthropic の usage から費用（キャッシュの書き込み/読み出しと web 検索の回数も足す）"""
    pin, pout = PRICES.get(model, (4.0, 20.0))
    if model == "claude-haiku-5-5" and (getattr(usage, "input_tokens", 0) or 0) > 100_000:
        pin, pout = 0.50, 2.50
    stu = getattr(usage, "server_tool_use", None)
    searches = (getattr(stu, "web_search_requests", 0) or 0) if stu else 0
    cw = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cr = getattr(usage, "cache_read_input_tokens", 0) or 0
    return ((getattr(usage, "input_tokens", 0) or 0) / 1e6 * pin + (getattr(usage, "output_tokens", 0) or 0) / 1e6 * pout
            + cw / 1e6 * pin * 1.25 + cr / 1e6 * pin * CACHE_READ.get(model, 0.1) + searches * SEARCH_USD)


def _cap(vendor: str) -> float:
    if vendor == "anthropic":
        return float(os.getenv("IRINA_CLAUDE_MONTHLY_USD") or 100)
    if vendor == "xai":
        return float(os.getenv("IRINA_GROK_MONTHLY_USD") or 20)
    return float("inf")


def _month_start() -> str:
    now = datetime.now(JST)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()


def log(vendor: str, model: str, purpose: str, usd: float) -> None:
    try:
        with db._connect() as c:
            c.execute("INSERT INTO scene_llm_cost (at, vendor, model, purpose, usd) VALUES (?, ?, ?, ?, ?)",
                      (datetime.now(timezone.utc).isoformat(), vendor, model, purpose, float(usd or 0)))
    except Exception as e:
        print(f"[llm-budget] log failed: {type(e).__name__}: {e}")


def month_to_date(vendor: str) -> float:
    with db._connect() as c:
        r = c.execute("SELECT COALESCE(SUM(usd), 0) FROM scene_llm_cost WHERE vendor = ? AND at >= ?", (vendor, _month_start())).fetchone()
    return float(r[0] or 0)


def allowed(vendor: str) -> bool:
    try:
        spent = month_to_date(vendor)
    except Exception:
        return True
    cap = _cap(vendor)
    if spent < cap:
        return True
    today = datetime.now(JST).strftime("%Y-%m-%d")
    if _warned.get(vendor) != today:
        _warned[vendor] = today
        print(f"[llm-budget] {vendor} は今月 ${spent:.2f} で上限 ${cap:.0f} に達したので、自動処理を止めています")
    return False
