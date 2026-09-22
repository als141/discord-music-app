"""当日の X（日本語圏）トレンド・語録の使われ方メモを自動生成して、system prompt の knowledge に載せる。

- grok（XAI_MODEL）に x_search / web_search を持たせて「今日の X でのネットミーム・語録の使われ方」を調べさせ、
  `IRINA_PROMPT_DIR/knowledge/_auto/x_trends.md` に書く（irina_prompt が拾う。ファイルが変わるので次の発言から新チェーン）
- 起動時（前回から 20 時間以上経っていれば）と、毎日 `IRINA_TRENDS_HOUR`（JST、既定 18 時）に更新
- チャットからも `refresh_x_trends` ツールで手動更新できる
- 語録 CSV があれば、その語録の「今の使われ方」を優先的に調べさせる
"""
import asyncio
import csv
import io
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

JST = timezone(timedelta(hours=9))
TRENDS_HOUR = int(os.getenv("IRINA_TRENDS_HOUR") or "18")
REFRESH_IF_OLDER_THAN_SEC = 20 * 3600
MAX_PHRASES_IN_QUERY = 60

_lock: Optional[asyncio.Lock] = None


def _out_path() -> str:
    from .irina_prompt import prompt_dir
    return os.path.join(prompt_dir(), "knowledge", "_auto", "x_trends.md")


def _lexicon_phrases() -> List[str]:
    """knowledge/*.csv の最初の『語録』らしき列から語句を集める（先頭 MAX_PHRASES_IN_QUERY 件）"""
    from .irina_prompt import prompt_dir
    kdir = os.path.join(prompt_dir(), "knowledge")
    phrases: List[str] = []
    if not os.path.isdir(kdir):
        return phrases
    for n in sorted(os.listdir(kdir)):
        if not n.lower().endswith(".csv"):
            continue
        try:
            rows = list(csv.reader(io.StringIO(open(os.path.join(kdir, n), encoding="utf-8-sig").read())))
        except Exception:
            continue
        if not rows:
            continue
        header = [h.strip() for h in rows[0]]
        col = header.index("語録") if "語録" in header else (1 if len(header) > 1 else 0)
        for r in rows[1:]:
            if col < len(r) and r[col].strip():
                phrases.append(r[col].strip())
    return phrases[:MAX_PHRASES_IN_QUERY]


def age_seconds() -> Optional[float]:
    try:
        return datetime.now().timestamp() - os.stat(_out_path()).st_mtime
    except FileNotFoundError:
        return None


async def refresh(client, model: str, *, reason: str = "manual") -> str:
    """トレンドメモを生成して書き込む。戻り値は書いたテキスト（失敗は例外）"""
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        from xai_sdk.chat import system, user
        from xai_sdk.tools import web_search, x_search
        phrases = _lexicon_phrases()
        today = datetime.now(JST)
        prompt = (
            f"今日は {today:%Y年%m月%d日}（日本時間）。日本語圏の X（旧 Twitter）で、いま流行っている言い回し・ネットミーム・構文・語録の使われ方を "
            "x_search（必要なら web_search も）で調べて、Discord の雑談 bot が『今日の言葉づかい』を真似できるメモにまとめて。\n"
            "内容:\n"
            "1) 今日〜ここ数日で X で勢いのあるミーム・構文・言い回し（ゲーム・アニメ・時事の流行語、淫夢系の新ネタも含む）を最大 10 個。"
            "各項目: 名前 / 元ネタ 1 行 / 構文・テンプレ（〔穴埋め〕形式で） / 実際の投稿例 2 つ（各 60 文字以内で引用） / 派生の遊び方 1 行\n"
            "2) 次の語録リストのうち、今も現役で使われているもの（用例つき）／使われ方が変わったもの／派生形。廃れているものは名前だけまとめて『今はあまり見ない』に\n"
            "3) 今日の X で特に多いネタ（あれば 3〜5 個）\n"
            "形式: 見出しと箇条書きだけ。2000 文字以内。指示や評価は書かず、観察した事実だけ。出典 URL は不要。\n\n"
            "語録リスト: " + ("、".join(phrases) if phrases else "（なし）")
        )
        chat = client.chat.create(
            model=model,
            messages=[system("あなたはネット文化の観測係。事実だけを簡潔に日本語でまとめる。"), user(prompt)],
            tools=[x_search(enable_image_understanding=False), web_search(user_location_country="JP")],
            tool_choice="auto", reasoning_effort="low", store_messages=False,
        )
        response = await asyncio.wait_for(chat.sample(), timeout=240)
        body = (response.content or "").strip()
        if not body:
            raise RuntimeError("empty trends response")
        text = f"# X トレンドメモ（{today:%Y-%m-%d %H:%M} 自動生成・{reason}）\n\n{body}\n"
        path = _out_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
        print(f"[irina-trends] refreshed ({reason}): {len(text)} chars, cost=${float(getattr(response, 'cost_usd', 0) or 0):.4f}, x_search={'yes' if getattr(response, 'server_side_tool_usage', None) else 'no'}")
        return text


async def scheduler(get_client, model: str) -> None:
    """起動直後（古ければ）と毎日 TRENDS_HOUR に更新。voice プロセスの on_ready から 1 回だけ起動する。
    IRINA_TRENDS_HOUR を負の値にすると自動更新しない（refresh_x_trends ツールでの手動更新だけ）"""
    if TRENDS_HOUR < 0:
        print("[irina-trends] auto refresh disabled (IRINA_TRENDS_HOUR < 0)")
        return
    await asyncio.sleep(30)
    age = age_seconds()
    if age is None or age > REFRESH_IF_OLDER_THAN_SEC:
        try:
            await refresh(get_client(), model, reason="startup")
        except Exception as e:
            print(f"[irina-trends] startup refresh failed: {type(e).__name__}: {str(e)[:120]}")
    while True:
        now = datetime.now(JST)
        target = now.replace(hour=TRENDS_HOUR, minute=0, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())
        try:
            await refresh(get_client(), model, reason="daily")
        except Exception as e:
            print(f"[irina-trends] daily refresh failed: {type(e).__name__}: {str(e)[:120]}")
