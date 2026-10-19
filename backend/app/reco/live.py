"""その場の選曲（Claude、既定 Sonnet 5.5）。オーナー指定 2026-10-15「リアルタイムで発火させていい（月 $100 まで）」。

いつ: 起点（流れてる曲・キュー・さっき置いた曲）が変わって、誰かがアプリでおすすめを開いたとき（＝見ている人がいるときだけ）
何を: いまの起点・この夜に流れた曲・ドデカの好み・決定的に並べた候補 50 曲を渡して、
      ①いま流したくなる順の並び（最大 18 曲）と一言 ②候補に無い「起点の直後に流すと気持ちいい曲」最大 5 曲（YouTube Music で実在を確かめたものだけ）
出し方: おすすめはまず決定的な並びで即座に返し、裏でこれを回す（`curating: true`）。終わったら次の取り直しで並びが入れ替わる
費用の安全弁: 同じギルドで 30 秒に 1 回まで・1 日 150 回まで（IRINA_RECO_LIVE_DAILY）・その月の Claude が上限の $20 手前に来たら止める（ほかの処理の分を残す）
「だれが・いつ」はここでも書かせない（懐かしい・定番の理由はデータのまま）
"""
import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from pydantic import BaseModel, Field

from ..services import game_sources as gsrc, llm_budget
from . import engine, links, meta

MODEL = os.getenv("IRINA_RECO_LIVE_MODEL") or "claude-sonnet-5-5"
MIN_GAP_SEC = 30
DAILY_CAP = int(os.getenv("IRINA_RECO_LIVE_DAILY") or 150)
RESERVE_USD = 20.0          # 月の上限からこれだけ残して止める
TTL_SEC = 1800
FAIL_PAUSE_SEC = 600        # 失敗した起点は 10 分休ませる（開いているあいだ 30 秒ごとに失敗し続けない）
JST = timezone(timedelta(hours=9))

SYSTEM = """あなたは Discord サーバー「ドデカ」の選曲係。ドデカは 8 人ほどの固定の友人グループで、夜に VC に集まり、
ゲームをしながら音楽ボット「イリーナ」で曲を流す。いま、誰かがアプリの「いまのおすすめ」を開いている。
目標は、開いた人が「うわこれ今聴きたかった」と思って、その場で次の曲として流したくなること。
- 起点（いま流れてる曲・さっき置いた曲・キューの曲）の流れに、いちばんつながる曲を最初に置く
- そのあとは懐かしい曲・新曲・ニコニコ・界隈も混ぜ、全部が同じ系統・同じアーティストにならないようにする
- 候補から選ぶときは key だけを使う。音楽でないもの・長い作業用は選ばない
- 一言は 22 文字以内。なぜ「いま」これか（つながり・空気・夜の時間帯）。「だれが・いつ流した」は書かない
- 候補に無い曲を足すときは、実在する曲を曲名・アーティスト名どおり正確に（推測で作らない）
- 誇張や絵文字は使わない。体言止めでよい"""


class LivePick(BaseModel):
    key: str
    reason: str = Field(description="22 文字以内。なぜいまこれか。だれが・いつは書かない")


class LiveSong(BaseModel):
    title: str = Field(description="曲名（正確に）")
    artist: str = Field(description="アーティスト・ボカロ P・歌い手（正確に）")
    why: str = Field(description="22 文字以内")


class LiveCuration(BaseModel):
    picks: List[LivePick] = Field(description="候補から、いま流したくなる順に最大 18 曲")
    songs: List[LiveSong] = Field(description="候補に無い曲で、起点の直後に流すと気持ちいい実在の曲。最大 5 曲")


_results: Dict[str, Dict[str, Any]] = {}
_running: Set[str] = set()
_last_start: Dict[str, float] = {}
_day: Dict[str, int] = {}
_failed: Dict[str, float] = {}
_tasks: Set[asyncio.Task] = set()


def sig_of(guild_id: str, anchors: List[Dict[str, Any]]) -> Optional[str]:
    return guild_id + "|" + ",".join(a["key"] for a in anchors) if anchors else None


def cached(sig: Optional[str]) -> Optional[Dict[str, Any]]:
    r = _results.get(sig or "")
    return r if r and time.time() - r["at"] < TTL_SEC else None


def _allowed(guild_id: str) -> str:
    """'ok' / 'wait'（30 秒以内にもう回した）/ 'no'（上限）"""
    if not gsrc.claude_enabled() or not llm_budget.allowed("anthropic"):
        return "no"
    try:
        if llm_budget.month_to_date("anthropic") > llm_budget._cap("anthropic") - RESERVE_USD:
            return "no"
    except Exception:
        pass
    day = datetime.now(JST).strftime("%Y-%m-%d")
    if _day.get(f"{guild_id}|{day}", 0) >= DAILY_CAP:
        return "no"
    if time.time() - _last_start.get(guild_id, 0) < MIN_GAP_SEC:
        return "wait"
    return "ok"


def start(guild_id: str, sig: str, anchors: List[Dict[str, Any]], pool: List[Dict[str, Any]], p: engine.Profile,
          blocked: Set[str], vc: int, on_done) -> bool:
    """回し始めたか、少し待てば回せるなら True（＝画面はあとで取り直す）"""
    if sig in _running:
        return True
    if time.time() - _failed.get(sig, 0) < FAIL_PAUSE_SEC:
        return False
    a = _allowed(guild_id)
    if a == "no":
        return False
    if a == "wait":
        return True
    _running.add(sig)
    _last_start[guild_id] = time.time()
    day = datetime.now(JST).strftime("%Y-%m-%d")
    _day[f"{guild_id}|{day}"] = _day.get(f"{guild_id}|{day}", 0) + 1
    task = asyncio.create_task(_run(guild_id, sig, anchors, pool, p, blocked, vc, on_done))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


def _session_lines(p: engine.Profile) -> str:
    """この夜（3 時間）に流れた曲"""
    now = datetime.now(timezone.utc)
    rows = []
    for k, st in p.stats.items():
        for e in st["events"]:
            at = engine._dt(e["at"])
            if e["kind"] == "play" and at and now - at < timedelta(hours=3):
                rows.append((at, k))
    rows.sort(reverse=True)
    out = []
    for _, k in rows[:8]:
        t, a, _ = engine.display_of(p.tracks[k])
        out.append(f"{t} / {a}")
    return "、".join(out) or "まだ無し"


async def _run(guild_id: str, sig: str, anchors: List[Dict[str, Any]], pool: List[Dict[str, Any]], p: engine.Profile,
               blocked: Set[str], vc: int, on_done) -> None:
    from . import curate
    t0 = time.time()
    try:
        src = {"playing": "いま流れてる", "queue": "キューの次", "box": "さっき置いた", "played": "さっき流した"}
        now = datetime.now(JST)
        prompt = (f"いま: {now:%Y-%m-%d %H:%M}（{'月火水木金土日'[now.weekday()]}）。VC に {vc} 人。\n"
                  "起点:\n" + "\n".join(f"- {src.get(a['src'], a['src'])}: {a.get('title') or '（題名なし）'} / {a.get('artist') or ''}" for a in anchors)
                  + f"\nこの夜に流れた曲（新しい順）: {_session_lines(p)}\n\n"
                  "候補（key | 題名 | アーティスト | 年 | 枠 | いまの理由）:\n" + curate._pool_lines(pool[:50]))
        taste = "## ドデカの好み\n" + curate._taste_summary(p)
        r = await gsrc._client().messages.parse(
            # medium: 思考 0・8 秒・$0.016 で、low より足す曲の取り違えが少なかった。high は 20 秒かかり並びは同じ（2026-10-15 実測）
            model=MODEL, max_tokens=6000, output_config={"effort": "medium"},
            system=[{"type": "text", "text": SYSTEM}, {"type": "text", "text": taste, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": prompt}], output_format=LiveCuration)
        usd = llm_budget.cost(MODEL, r.usage)
        llm_budget.log("anthropic", MODEL, "reco_live", usd)
        c: Optional[LiveCuration] = r.parsed_output
        if not c:
            _failed[sig] = time.time()
            print(f"[reco] live {guild_id}: no parsed output (${usd:.4f})")
            return
        valid = {it["key"] for it in pool}
        picks = [{"key": x.key, "reason": x.reason.strip()[:26]} for x in c.picks if x.key in valid][:18]
        songs = await _verify(c.songs, valid | blocked | {a["key"] for a in anchors}, p)
        _results[sig] = {"at": time.time(), "picks": picks, "songs": songs}
        print(f"[reco] live {guild_id}: {round(time.time() - t0, 1)}s ${usd:.4f} picks={len(picks)} songs={len(songs)}/{len(c.songs)} "
              f"cache_r={getattr(r.usage, 'cache_read_input_tokens', 0)}")
        on_done(guild_id)
    except Exception as e:
        _failed[sig] = time.time()
        print(f"[reco] live failed: {type(e).__name__}: {str(e)[:160]}")
    finally:
        _running.discard(sig)


async def _verify(props: List[LiveSong], skip: Set[str], p: engine.Profile) -> List[Dict[str, Any]]:
    """提案を YouTube Music で探し、曲名とアーティストが合うものだけ（作り話を出さない）"""
    sem = asyncio.Semaphore(3)

    async def one(t: LiveSong) -> Optional[Dict[str, Any]]:
        async with sem:
            try:
                res = await asyncio.to_thread(meta.ytm_en().search, f"{t.artist} {t.title}", filter="songs", limit=5)
            except Exception:
                return None
        want_t, want_a = links.normalize_name(t.title), set(links.name_aliases(t.artist))
        for r in res or []:
            if not r.get("videoId"):
                continue
            title = meta.clean_title(r.get("title"))
            nt = links.normalize_name(title)
            if not (nt and (nt in want_t or want_t in nt)):
                continue
            arts = [{"name": a.get("name"), "id": a.get("id")} for a in r.get("artists") or [] if a.get("name")]
            na = set().union(*(set(links.name_aliases(a["name"])) for a in arts)) if arts else set()
            ok = bool(na & want_a or any(x in y or y in x for x in na for y in want_a))
            if not ok and arts and arts[0].get("id"):
                # en の「Yorushika」と Claude の「ヨルシカ」: 日本語表記でも比べる
                ja = await meta.artist_ja(arts[0]["id"], "")
                na_ja = set(links.name_aliases(ja))
                ok = bool(na_ja & want_a or any(x in y or y in x for x in na_ja for y in want_a))
            if ok:
                key = "yt:" + r["videoId"]
                ds = p.days_since(key)
                if key in skip or (ds is not None and ds < 2):
                    return None
                th = r.get("thumbnails") or []
                it = engine._item(key, title, ", ".join(a["name"] for a in arts[:1]), artist_id=arts[0]["id"] if arts else None,
                                  thumb=th[-1]["url"] if th else None, kind="context", reason=t.why.strip()[:26], sub=None, score=0.0)
                it["toks"] = set()
                return it
        print(f"[reco] live song not found: {t.title[:30]} / {t.artist[:20]}")
        return None

    out = []
    for it in await asyncio.gather(*(one(t) for t in props[:5])):
        if it and it["key"] not in {x["key"] for x in out}:
            out.append(it)
    return out


def apply(pool: List[Dict[str, Any]], res: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    """Claude の並びを先頭に、提案した曲を間に挟み、残りは元の並び。懐かしい・定番の理由（だれが・いつ）はデータのまま"""
    by = {it["key"]: it for it in pool}
    seq: List[Dict[str, Any]] = []
    songs = list(res.get("songs") or [])
    for i, pk in enumerate(res.get("picks") or []):
        if pk["key"] not in by:
            continue
        it = dict(by[pk["key"]])
        if pk.get("reason") and it["kind"] not in ("memory", "favorite"):
            it["reason"] = pk["reason"]
        seq.append(it)
        if i in (0, 3, 6, 9, 12) and songs:
            seq.append(dict(songs.pop(0)))
    seq += [dict(s) for s in songs]
    out, seen = [], set()
    for it in seq + pool:
        if it["key"] in seen:
            continue
        seen.add(it["key"])
        out.append(it)
    return out[:limit]
