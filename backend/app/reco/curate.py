"""Claude（既定 Opus 5.5）の選曲。1 日 1 回（と、曲置き箱に曲がたくさん増えたとき）だけ。

渡すもの: ドデカの好み（アーティストの重み・年代・メンバーごとの好み。メンバーは M1.. の仮名）と、気分ごとの候補（決定的なスコアの上位）
返すもの: 気分ごとの並び（候補の key だけ）と発見枠の一言、「あの頃の名曲」の提案（10 年以上前。実在するかは YouTube Music で照合）
「だれが・いつ」は渡さないし書かせない（engine がデータから作る）。費用は llm_budget に全部残す
"""
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..services import game_sources as gsrc, llm_budget
from . import links, meta, store
from .engine import Profile, display_of

MODEL = os.getenv("IRINA_RECO_MODEL") or "claude-opus-5-5"

SYSTEM = """あなたは Discord サーバー「ドデカ」の選曲係。ドデカは 8 人ほどの固定の友人グループで、夜に VC に集まり、
ゲームをしながら音楽ボット「イリーナ」で曲を流す。アプリの曲置き場タブに「ドデカのおすすめ」を出す。
目標は、開いた人が「うわこれ今聴きたかった」「うわ懐かしすぎ」と思って、その場で流したくなること。
- 候補の中から選ぶ（key は渡したものだけ）。メンバー全員の好みが少しずつ入るように散らす
- 同じ曲の別バージョン・同じアーティストの連続は避ける。音楽でないもの（ゲーム実況・ネタ動画・作業用の長い動画）は選ばない
- 一言は 22 文字以内。なぜこの人たちに刺さるか（曲の空気・つながり）。「だれが・いつ流した」は書かない（別に表示する）
- 誇張や絵文字は使わない。体言止めでよい"""


class Pick(BaseModel):
    key: str
    reason: str = Field(description="22 文字以内。だれが・いつは書かない")


class Throwback(BaseModel):
    title: str = Field(description="曲名（原題）")
    artist: str = Field(description="アーティスト・ボカロ P")
    year: int = Field(description="発表年（2016 年以前）")
    why: str = Field(description="22 文字以内")


class Curation(BaseModel):
    taste: str = Field(description="ドデカの音楽の好みを 60 文字以内で")
    now: List[Pick] = Field(description="いま聴きたい: 12 曲まで、出したい順")
    memories: List[Pick] = Field(description="懐かしい: 12 曲まで")
    new: List[Pick] = Field(description="新しい: 12 曲まで")
    nico: List[Pick] = Field(description="ニコニコ: 12 曲まで")
    throwbacks: List[Throwback] = Field(description="候補に無くてよい。2016 年以前の曲で、この人たちが「懐かしい」となりそうなもの 12 曲")


def _taste_summary(p: Profile) -> str:
    now = datetime.now(timezone.utc)
    names: Dict[str, str] = {}
    w_all: Counter = Counter()
    w_rec: Counter = Counter()
    people_by_artist: Dict[str, set] = {}
    years: Counter = Counter()
    types: Counter = Counter()
    per_user: Dict[str, Counter] = {}
    for k, st in p.stats.items():
        t = p.tracks[k]
        _, artist, _ = display_of(t)
        a = links.normalize_name(artist) or artist
        names[a] = artist
        w_all[a] += st["w"]
        w_rec[a] += st["wr"]
        people_by_artist.setdefault(a, set()).update(st["users"])
        if t.get("year"):
            years[f"{t['year'] // 5 * 5}年代前半" if t["year"] % 10 < 5 else f"{t['year'] // 10 * 10}年代後半"] += 1
        types[t.get("song_type") or "?"] += 1
        for u, c in st["users"].items():
            per_user.setdefault(u, Counter())[a] += c
    alias = {u: f"M{i + 1}" for i, (u, _) in enumerate(sorted(per_user.items(), key=lambda x: -sum(x[1].values())))}
    lines = [f"記録: 曲 {len(p.stats)}・人 {len(p.people)}・{p.first_at.astimezone().year if p.first_at else '?'}年から"]
    lines.append("全期間でよく流れる・貼られるアーティスト: " + "、".join(
        f"{names[a]}({round(w, 1)}/{len(people_by_artist[a])}人)" for a, w in w_all.most_common(40)))
    lines.append("最近 2 か月: " + "、".join(f"{names[a]}({round(w, 1)})" for a, w in w_rec.most_common(25) if w > 0.05))
    lines.append("年代: " + "、".join(f"{k} {v}" for k, v in sorted(years.items())))
    lines.append("種類: " + "、".join(f"{k} {v}" for k, v in types.most_common()))
    for u, c in sorted(per_user.items(), key=lambda x: -sum(x[1].values()))[:10]:
        lines.append(f"{alias[u]} がよく流す: " + "、".join(names[a] for a, _ in c.most_common(8)))
    fb = store.feedback_since(p.guild_id, 14)
    if fb:
        played = [f["key"] for f in fb if f["action"] == "play"]
        dismissed = [f["key"] for f in fb if f["action"] == "dismiss"]
        tr = store.tracks(played + dismissed)
        lines.append(f"直近 2 週間: おすすめから流した {len(played)} 曲、外された {len(dismissed)} 曲"
                     + (f"（外された例: {'、'.join((tr.get(k) or {}).get('title') or k for k in dismissed[:8])}）" if dismissed else ""))
    return "\n".join(lines)


def _pool_lines(items: List[Dict[str, Any]]) -> str:
    out = []
    for it in items:
        bits = [it["title"][:40]]
        if it.get("artist"):
            bits.append(it["artist"][:24])
        if it.get("year"):
            bits.append(str(it["year"]))
        bits.append(it["kind"])
        if it.get("label"):
            bits.append(it["label"])
        out.append(f"{it['key']} | " + " | ".join(bits) + f" | {it['reason'].replace('{who}', '誰か')}")
    return "\n".join(out)


async def run(guild_id: str, pools: Dict[str, List[Dict[str, Any]]], p: Profile) -> Optional[Dict[str, Any]]:
    if not gsrc.claude_enabled() or not llm_budget.allowed("anthropic"):
        return None
    prompt = ("## ドデカの好み\n" + _taste_summary(p) + "\n\n## 候補（key | 題名 | アーティスト | 年 | 枠 | … | いまの理由）\n"
              + "\n\n".join(f"### {mood}\n{_pool_lines(items[:40])}" for mood, items in pools.items() if items))
    r = await gsrc._client().messages.parse(model=MODEL, max_tokens=6000, system=SYSTEM, output_config={"effort": "medium"},
                                            messages=[{"role": "user", "content": prompt}], output_format=Curation)
    usd = llm_budget.cost(MODEL, r.usage)
    llm_budget.log("anthropic", MODEL, "reco_curation", usd)
    c: Optional[Curation] = r.parsed_output
    if not c:
        return None
    valid = {mood: {it["key"] for it in items} for mood, items in pools.items()}
    out: Dict[str, Any] = {"at": datetime.now(timezone.utc).isoformat(), "taste": c.taste[:80], "model": MODEL, "usd": round(usd, 4), "moods": {}}
    for mood in ("now", "memories", "new", "nico"):
        picks = [{"key": x.key, "reason": x.reason.strip()[:26]} for x in getattr(c, mood) if x.key in valid.get(mood, set())]
        out["moods"][mood] = picks[:12]
    out["throwbacks"] = await verify_throwbacks(c.throwbacks)
    print(f"[reco] curation {guild_id}: ${usd:.3f} picks={sum(len(v) for v in out['moods'].values())} throwbacks={len(out['throwbacks'])}")
    return out


async def verify_throwbacks(props: List[Throwback]) -> List[Dict[str, Any]]:
    """提案された曲を YouTube Music で探し、曲名とアーティストが合うものだけ残す（作り話を出さない）"""
    import asyncio
    out = []
    for t in props[:14]:
        if t.year > datetime.now(timezone.utc).year - 9:
            continue
        try:
            res = await asyncio.to_thread(meta.ytm_en().search, f"{t.artist} {t.title}", filter="songs", limit=5)
        except Exception:
            continue
        want_t, want_a = links.normalize_name(t.title), set(links.name_aliases(t.artist))
        for r in res or []:
            if not r.get("videoId"):
                continue
            title = meta.clean_title(r.get("title"))
            nt = links.normalize_name(title)
            arts = [{"name": a.get("name"), "id": a.get("id")} for a in r.get("artists") or [] if a.get("name")]
            na = set().union(*(set(links.name_aliases(a["name"])) for a in arts)) if arts else set()
            if nt and (nt in want_t or want_t in nt) and (na & want_a or any(x in y or y in x for x in na for y in want_a)):
                th = r.get("thumbnails") or []
                out.append({"key": "yt:" + r["videoId"], "title": title, "artist": ", ".join(a["name"] for a in arts[:2]),
                            "artist_id": arts[0]["id"] if arts else None, "thumb": th[-1]["url"] if th else None, "year": t.year,
                            "kind": "throwback", "reason": t.why.strip()[:26], "sub": f"{t.year}年", "score": 1.5, "who": None,
                            "seed": None, "label": None})
                break
        await asyncio.sleep(0.4)
    return out

