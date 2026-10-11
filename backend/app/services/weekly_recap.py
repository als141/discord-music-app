"""今週のドデカ（週 1 回、日曜 21:00 JST に #一般 へ。/今週 で本人にだけ、いつでも）。

数字は DB から決まった計算で出し（VC の時間・夜更かし・いちばん集まった夜・遊ばれたゲーム・新しく遊んだゲーム・曲・
イントロ王・置き場）、ひとことだけイリーナ（会話と同じキャラ設定、Grok）が書く。キャラ設定の中身は加工しない。
「自分のプレイ中を出す」をオフにした人のゲームは数えない。VC の時間が合計 1 時間に満たない週は投稿しない（うるさくしない）。
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import discord

from .. import db
from . import game_db as gdb
from . import game_shelf

import re

JST = timezone(timedelta(hours=9))
WEEKDAYS = "月火水木金土日"
_STAPLE = re.compile(r"apex|valorant|street ?fighter|ストリートファイター|league of legends|pubg|overwatch|minecraft|fortnite|counter-strike",
                     re.IGNORECASE)


def week_range(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """月曜 5:00 JST 〜 次の月曜 5:00（深夜のぶんを前の日に数える）"""
    now = (now or datetime.now(JST)).astimezone(JST)
    base = (now - timedelta(hours=5))
    monday = (base - timedelta(days=base.weekday())).replace(hour=5, minute=0, second=0, microsecond=0)
    return monday, monday + timedelta(days=7)


def _t(s: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s) if s else None
    except ValueError:
        return None


def stats(guild_id: str, start: datetime, end: datetime) -> Dict[str, Any]:
    names = {u: (m.get("name") or "だれか") for u, m in gdb.members(guild_id).items()}
    hidden = game_shelf.hidden_users()
    s_iso, e_iso = start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()
    now = datetime.now(timezone.utc)
    with db._connect() as c:
        vc = c.execute("SELECT user_id, joined_at, left_at FROM vc_sessions WHERE guild_id = ? AND joined_at < ? AND (left_at IS NULL OR left_at > ?)",
                       (guild_id, e_iso, s_iso)).fetchall()
        games = c.execute("SELECT user_id, game_name, appid, started_at, ended_at FROM game_sessions WHERE guild_id = ? AND started_at < ? "
                          "AND (ended_at IS NULL OR ended_at > ?)", (guild_id, e_iso, s_iso)).fetchall()
        firsts = dict(c.execute("SELECT game_name, MIN(started_at) FROM game_sessions WHERE guild_id = ? GROUP BY game_name", (guild_id,)).fetchall())
        plays = c.execute("SELECT title, artist, added_by_id, added_by_name FROM play_history WHERE guild_id = ? AND played_at >= ? AND played_at < ?",
                          (guild_id, s_iso, e_iso)).fetchall()
        quiz = c.execute("SELECT user_id, SUM(points) FROM quiz_scores WHERE guild_id = ? AND played_at >= ? AND played_at < ? GROUP BY user_id",
                         (guild_id, s_iso, e_iso)).fetchall()
        posts = c.execute("SELECT posted_by_id, COUNT(DISTINCT appid) FROM game_posts WHERE guild_id = ? AND posted_at >= ? AND posted_at < ? "
                          "AND appid IS NOT NULL GROUP BY posted_by_id", (guild_id, s_iso, e_iso)).fetchall()

    # VC: 一人ずつの時間（週の範囲に切る）・夜更かし（いちばん遅く抜けた時刻。0〜5 時は前の夜の続き）・同時にいちばん多かった夜
    per: Dict[str, float] = {}
    late: Dict[str, Tuple[int, str]] = {}
    events: List[Tuple[datetime, int]] = []
    for uid, j, l in vc:
        js, le = max(_t(j), start), min(_t(l) or now, end)
        if le <= js:
            continue
        per[uid] = per.get(uid, 0) + (le - js).total_seconds()
        events += [(js, 1), (le, -1)]
        lj = le.astimezone(JST)
        score = (lj.hour + 24 if lj.hour < 6 else lj.hour) * 60 + lj.minute
        if lj.hour < 6 and (uid not in late or score > late[uid][0]):
            late[uid] = (score, f"{lj.hour}:{lj.minute:02d}")
    peak, cur, peak_at = 0, 0, None
    for t, d in sorted(events, key=lambda x: (x[0], x[1])):
        cur += d
        if cur > peak:
            peak, peak_at = cur, t
    # ゲーム
    gmin: Dict[str, float] = {}
    gusers: Dict[str, set] = {}
    for uid, g, appid, st, en in games:
        if uid in hidden:
            continue
        a, b = max(_t(st), start), min(_t(en) or now, end)
        if b <= a:
            continue
        gmin[g] = gmin.get(g, 0) + (b - a).total_seconds() / 60
        gusers.setdefault(g, set()).add(uid)
    top_games = sorted(gmin.items(), key=lambda x: -x[1])[:3]
    # 「新しく遊んだ」は、記録が週の 1 週間以上前からあるときだけ（記録を始めた週は全部「新しい」になってしまう）。定番は数えない
    earliest = min((_t(v) for v in firsts.values() if v), default=None)
    enough_history = earliest is not None and earliest <= start - timedelta(days=7)
    new_games = [g for g in gmin if enough_history and firsts.get(g) and _t(firsts[g]) >= start and gmin[g] >= 20
                 and len(gusers[g]) >= 2 and not _STAPLE.search(g)]
    # 曲・クイズ・置き場
    req: Dict[str, int] = {}
    for _, _, uid, name in plays:
        if uid:
            req[uid] = req.get(uid, 0) + 1
            names.setdefault(uid, name or "だれか")
    top_req = max(req.items(), key=lambda x: x[1]) if req else None
    quiz_king = max(quiz, key=lambda x: x[1]) if quiz else None
    poster = max(posts, key=lambda x: x[1]) if posts else None
    longest = max(per.items(), key=lambda x: x[1]) if per else None
    owl = max(late.items(), key=lambda x: x[1][0]) if late else None
    return {
        "range": (start, end),
        "vc_hours": round(sum(per.values()) / 3600, 1),
        "vc_people": len(per),
        "longest": (names.get(longest[0], "だれか"), round(longest[1] / 3600, 1)) if longest else None,
        "owl": (names.get(owl[0], "だれか"), owl[1][1]) if owl else None,
        "peak": (peak, WEEKDAYS[(peak_at.astimezone(JST) - timedelta(hours=5)).weekday()]) if peak_at else None,
        "games": [(g, round(m / 60, 1), len(gusers[g])) for g, m in top_games],
        "new_games": new_games[:3],
        "songs": len(plays),
        "top_requester": (names.get(top_req[0], "だれか"), top_req[1]) if top_req else None,
        "quiz_king": (names.get(quiz_king[0], "だれか"), int(quiz_king[1])) if quiz_king else None,
        "shelf": (sum(x[1] for x in posts), names.get(poster[0], "だれか") if poster else None),
    }


def facts_text(s: Dict[str, Any]) -> str:
    a, b = s["range"]
    lines = [f"期間: {a:%-m/%-d}〜{(b - timedelta(days=1)):%-m/%-d}", f"VC 合計 {s['vc_hours']} 時間・{s['vc_people']} 人"]
    if s["longest"]:
        lines.append(f"いちばん長く VC にいた: {s['longest'][0]}（{s['longest'][1]} 時間）")
    if s["owl"]:
        lines.append(f"夜更かし: {s['owl'][0]}（{s['owl'][1]} まで）")
    if s["peak"]:
        lines.append(f"いちばん集まった: {s['peak'][1]}曜 {s['peak'][0]} 人")
    if s["games"]:
        lines.append("遊ばれた: " + " / ".join(f"{g} {h} 時間（{n}人）" for g, h, n in s["games"]))
    if s["new_games"]:
        lines.append("新しく遊んだ: " + "、".join(s["new_games"]))
    if s["songs"]:
        lines.append(f"流れた曲 {s['songs']} 曲" + (f"・いちばん流した: {s['top_requester'][0]}（{s['top_requester'][1]} 曲）" if s["top_requester"] else ""))
    if s["quiz_king"]:
        lines.append(f"イントロ王: {s['quiz_king'][0]}（{s['quiz_king'][1]} 点）")
    if s["shelf"][0]:
        lines.append(f"置き場に貼られたゲーム {s['shelf'][0]} 本" + (f"（いちばん貼った: {s['shelf'][1]}）" if s["shelf"][1] else ""))
    return "\n".join(lines)


async def comment(s: Dict[str, Any]) -> Optional[str]:
    """イリーナのひとこと（会話と同じキャラ設定）。失敗したら None（数字だけ出す）"""
    try:
        from . import irina_chat
        from xai_sdk.chat import system, user
        persona, _ = irina_chat._load_persona()
        chat = irina_chat._get_client().chat.create(
            model=irina_chat.XAI_MODEL,
            messages=[system(persona), user(
                "Discord サーバー「ドデカ」の #一般 に出す『今週のドデカ』に添える、あなたのひとことを書いて。3〜4 文、200 文字以内。"
                "下の記録の数字と名前はそのまま使い、作らない。誰かを本気で傷つける言い方はしない。見出しや箇条書きは付けない。\n\n" + facts_text(s))],
            reasoning_effort="low", store_messages=False)
        r = await asyncio.wait_for(chat.sample(), timeout=90)
        from . import llm_budget
        llm_budget.log("xai", irina_chat.XAI_MODEL, "weekly_recap", float(getattr(r, "cost_usd", 0) or 0))
        return (r.content or "").strip()[:600] or None
    except Exception as e:
        print(f"[recap] comment failed (grok): {type(e).__name__}: {str(e)[:120]}")
    # xAI が使えないとき（クレジット切れなど）は Claude が書く。キャラ設定のファイルは渡さず、コードにある既定のキャラ文だけ
    try:
        from . import game_sources as gsrc, irina_chat, llm_budget
        if not gsrc.claude_enabled() or not llm_budget.allowed("anthropic"):
            return None
        r = await gsrc._client().messages.create(
            model="claude-sonnet-5-5", max_tokens=4000, system=irina_chat.DEFAULT_PERSONA, output_config={"effort": "low"},
            messages=[{"role": "user", "content": "Discord サーバー「ドデカ」の #一般 に出す『今週のドデカ』に添える、あなたのひとことを書いて。"
                                                  "3〜4 文、200 文字以内。下の記録の数字と名前はそのまま使い、作らない。見出しや箇条書きは付けない。\n\n" + facts_text(s)}])
        llm_budget.log("anthropic", "claude-sonnet-5-5", "weekly_recap", gsrc._cost(r.usage))
        text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text").strip()
        return text[:600] or None
    except Exception as e:
        print(f"[recap] comment failed (claude): {type(e).__name__}: {str(e)[:120]}")
        return None


def embed(s: Dict[str, Any], note: Optional[str]) -> discord.Embed:
    a, b = s["range"]
    e = discord.Embed(title=f"今週のドデカ（{a:%-m/%-d}〜{(b - timedelta(days=1)):%-m/%-d}）", description=note or None, color=0xE0245E,
                      url="https://discord-music-app.vercel.app/?tab=games")
    vc = [f"合計 **{s['vc_hours']}** 時間・{s['vc_people']} 人"]
    if s["longest"]:
        vc.append(f"いちばん長くいた: **{s['longest'][0]}**（{s['longest'][1]} 時間）")
    if s["owl"]:
        vc.append(f"夜更かし: **{s['owl'][0]}**（{s['owl'][1]} まで）")
    if s["peak"]:
        vc.append(f"いちばん集まった: {s['peak'][1]}曜 {s['peak'][0]} 人")
    e.add_field(name="VC", value="\n".join(vc), inline=False)
    if s["games"]:
        g = [f"{i}. **{n}** {h} 時間（{u}人）" for i, (n, h, u) in enumerate(s["games"], 1)]
        if s["new_games"]:
            g.append("新しく遊んだ: " + "、".join(s["new_games"]))
        e.add_field(name="ゲーム", value="\n".join(g), inline=False)
    extra = []
    if s["songs"]:
        extra.append(f"流れた曲 {s['songs']} 曲" + (f"（いちばん流した: {s['top_requester'][0]}）" if s["top_requester"] else ""))
    if s["quiz_king"]:
        extra.append(f"イントロ王: **{s['quiz_king'][0]}**（{s['quiz_king'][1]} 点）")
    if s["shelf"][0]:
        extra.append(f"置き場に {s['shelf'][0]} 本" + (f"（いちばん貼った: {s['shelf'][1]}）" if s["shelf"][1] else ""))
    if extra:
        e.add_field(name="ほかに", value="\n".join(extra), inline=False)
    e.set_footer(text="イリーナ · 毎週日曜 21 時 · /今週 でいつでも · プレイ中を出さない設定の人のゲームは数えていません")
    return e


async def maybe_post(client: discord.Client) -> None:
    """日曜 21 時以降に、その週の分を 1 回だけ"""
    now = datetime.now(JST)
    if now.weekday() != 6 or now.hour < 21:
        return
    from . import irina_discord
    start, end = week_range(now)
    key = f"{start:%Y-%m-%d}"
    for gid in game_shelf.game_guild_ids():
        if gdb.kv_get(f"recap_posted:{gid}") == key:
            continue
        gdb.kv_set(f"recap_posted:{gid}", key)
        s = await asyncio.to_thread(stats, gid, start, end)
        if s["vc_hours"] < 1:
            print(f"[recap] {gid}: VC {s['vc_hours']}h なので出さない")
            continue
        ch = client.get_channel(int(irina_discord.GENERAL_CHANNELS.get(gid) or 0))
        if ch is None:
            continue
        note = await comment(s)
        try:
            await ch.send(embed=embed(s, note), allowed_mentions=discord.AllowedMentions.none())
            print(f"[recap] posted {key} in #{getattr(ch, 'name', ch.id)}")
        except discord.HTTPException as e:
            print(f"[recap] post failed: {e}")
