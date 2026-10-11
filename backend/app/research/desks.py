"""調べる中身（デスク）。何を調べるかはドデカのデータから決める（固定の話題表は持たない）。

- daily（毎日 17:30）: 今夜の大会・イベント・配信 → 定番（実際に遊ばれているゲーム。記録が少ないうちは VALORANT・Apex・スト6）の
  直近の更新・イベント → 界隈（よく見る配信者）で流行り始めたもの
- weekly_new（月曜 18:00）: 今週の、友達で遊べる新作・体験版・無料配布
- weekly_music（金曜 18:00）: 曲置き場によく貼られるアーティスト・界隈の歌い手の新曲・発表
- question（いつでも）: メンバーの質問（/調べて・アプリ）

各デスクは (system, prompt, 参考 URL, 検索回数, 取得回数) を返す。参考にした Steam ニュースの URL は出典として残してよい。
"""
import html
import json
import re
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from ..services import game_db as gdb

JST = timezone(timedelta(hours=9))
DEFAULT_STAPLES = ["VALORANT", "Apex Legends", "ストリートファイター6"]
STEAM_APPIDS = {"apex legends": "1172470", "エーペックスレジェンズ": "1172470", "ストリートファイター6": "1364780", "street fighter 6": "1364780",
                "pubg": "578080", "pubg: battlegrounds": "578080", "overwatch 2": "2357570", "lethal company": "1966720", "r.e.p.o.": "3241660"}

STYLE = (
    "書き方: 日本語。調べて確かめたことだけを書き、分からないことは書かない（推測で埋めない）。各項目は 1〜2 文で、なぜドデカに関係あるかが分かるように。"
    "各項目の最後に出典を Markdown のリンク [サイト名](URL) で付ける（検索・取得した結果にあった URL だけ）。時刻は日本時間。"
    "見出しは「## 」、項目は「- 」。今夜（日本時間 19 時〜翌 2 時）に関係ある項目は先頭に【今夜】。"
    "最後の行に、ドデカの bot「イリーナ」（妖艶で余裕のある魔王のお姉さん。一人称は「わたし」。ネットスラング混じり）の一言を "
    "「**イリーナ**「…」」の形で 1 つだけ。"
)


def _dodeka(guild_id: str) -> str:
    return ("あなたは日本の Discord サーバー「ドデカ」の調査係。ドデカは固定 8 人の友人で、夜 21〜1 時に VC に集まってゲームをする。"
            "よく遊ぶのは VALORANT・ストリートファイター6・Apex Legends。2〜8 人で遊べる協力・パーティのインディー（R.E.P.O.・Lethal Company など）も"
            "ときどき遊ぶ。にじさんじ・ぶいすぽ・ホロライブの VTuber や、加藤純一・k4sen・SHAKA などの配信者をよく見ている。"
            "音楽は歌ってみた・ボカロ・アニソン・J-POP（Ado・ヨルシカ・キタニタツヤ・Mrs. GREEN APPLE・アイマスなど）。\n" + STYLE)


def staples(guild_id: str, n: int = 4) -> List[str]:
    """実際に遊ばれている定番（14 日で 2 人以上・合計 2 時間以上）。足りなければ既定で埋める"""
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    from .. import db
    with db._connect() as c:
        rows = c.execute("SELECT game_name, COUNT(DISTINCT user_id), SUM((julianday(COALESCE(ended_at, ?)) - julianday(started_at)) * 1440) "
                         "FROM game_sessions WHERE guild_id = ? AND started_at >= ? GROUP BY game_name",
                         (datetime.now(timezone.utc).isoformat(), guild_id, since)).fetchall()
    played = [g for g, users, minutes in sorted(rows, key=lambda r: -(r[2] or 0)) if users >= 2 and (minutes or 0) >= 120]
    out: List[str] = []
    for g in played + DEFAULT_STAPLES:
        if g.lower() not in {x.lower() for x in out}:
            out.append(g)
    return out[:n]


def steam_news(appid: str, n: int = 4, days: int = 5) -> Tuple[str, List[str]]:
    """Steam の公式ニュース（キー不要）。パッチノートやイベント告知が入る"""
    try:
        u = f"https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count={n}&maxlength=500&format=json"
        d = json.load(urllib.request.urlopen(u, timeout=15))
    except Exception:
        return "", []
    lines, urls = [], []
    since = datetime.now(JST) - timedelta(days=days)
    for it in d.get("appnews", {}).get("newsitems", []):
        t = datetime.fromtimestamp(it["date"], JST)
        if t < since:
            continue
        body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(it.get("contents") or ""))).strip()
        lines.append(f"- {t:%m/%d %H:%M} {it['title']}（{it.get('feedlabel') or ''}）{it['url']}\n  {body[:300]}")
        urls.append(it["url"])
    return "\n".join(lines), urls


def _streamers() -> List[str]:
    from ..scene import sources
    return [c["name"] for c in sources.channels()]


def daily(guild_id: str) -> Tuple[str, str, List[str], int, int]:
    now = datetime.now(JST)
    games = staples(guild_id)
    refs, urls = [], []
    for g in games:
        appid = STEAM_APPIDS.get(g.lower())
        if appid:
            txt, us = steam_news(appid)
            if txt:
                refs.append(f"### {g}（Steam {appid} の公式ニュース）\n{txt}")
                urls += us
    # 界隈で今週やっているゲーム（配信者の動画から）
    scene_games = []
    try:
        from ..scene import store as sstore
        c = Counter(v.get("game_en") or v.get("game") for v in sstore.videos_since(7, ["game"]) if v.get("game") or v.get("game_en"))
        scene_games = [f"{g}（配信者 {n} 本）" for g, n in c.most_common(6)]
    except Exception:
        pass
    prompt = (
        f"今日は {now:%Y年%m月%d日（%a）%H:%M}（日本時間）。web_search と web_fetch で調べて、ドデカの「今日の調査」を作って。\n\n"
        "## 今夜\n今夜（日本時間 19 時〜翌 2 時）に見る・遊ぶ価値があるもの（大会の配信・ゲーム内イベントの開始/終了・配信者の大会やコラボ・無料配布やセールの終了）を、"
        "時刻つきで最大 4 つ。無ければ「特になし」。\n"
        f"## ゲームごと（{'・'.join(games)}）\n直近 72 時間の公式アップデート・パッチ・イベント・大会・日本のコミュニティで話題になっていることを、ゲームごとに最大 2 点。"
        "見つからないゲームは「新しい動きは見つからず」と 1 行で。\n"
        "## 界隈\nよく見る配信者のあいだで流行り始めたゲームや大会があれば最大 2 点（無ければ書かない）。"
        + (f"参考: 配信者の今週の動画で多いゲーム = {'、'.join(scene_games)}。" if scene_games else "")
        + f"\n配信者の例: {'、'.join(_streamers()[:14])}\n"
        + ("\n参考（Steam の公式ニュース。URL は出典に使ってよい）:\n" + "\n".join(refs) if refs else "")
    )
    return _dodeka(guild_id), prompt, urls, 8, 3


def weekly_new(guild_id: str) -> Tuple[str, str, List[str], int, int]:
    now = datetime.now(JST)
    hints = []
    try:
        from ..scene import curate
        cur = curate.current(max_age_h=24 * 7) or {}
        games = {g["appid"]: g for g in gdb.all_games([p["appid"] for p in cur.get("picks", [])])}
        hints = [f"{games[p['appid']]['name']}（{p['why']}）" for p in cur.get("picks", []) if p["appid"] in games]
    except Exception:
        pass
    prompt = (
        f"今日は {now:%Y年%m月%d日（%a）}（日本時間）。web_search と web_fetch で調べて、ドデカの「今週の新作」を作って。\n"
        "対象: 今週（月〜日）に発売・早期アクセス開始・体験版/プレイテスト・期間限定の無料配布がある、PC（Steam 中心）で友達 2〜8 人で遊べるゲーム。"
        "協力ホラー・物理系わちゃわちゃ・脱出・パーティを優先。大作でもマルチが売りなら可。最大 6 本。\n"
        "各ゲーム: 何人で・いくら（無料/体験版なら明記）・いつから（日本時間）・なぜドデカ向きか、を 1〜2 文で。見出しは「## 今週の新作」と、"
        "あれば「## 体験版・無料」。\n"
        + (f"参考（イリーナの今週の候補）: {'、'.join(hints)}\n" if hints else "")
    )
    return _dodeka(guild_id), prompt, [], 5, 2


def weekly_music(guild_id: str) -> Tuple[str, str, List[str], int, int]:
    now = datetime.now(JST)
    artists = []
    try:
        from ..scene import store as sstore
        artists = [c["name"] for c in sstore.music_channels()[:16] if c["name"] and "Topic" not in c["name"]]
    except Exception:
        pass
    prompt = (
        f"今日は {now:%Y年%m月%d日（%a）}（日本時間）。web_search で調べて、ドデカの「今週の新曲」を作って。\n"
        "対象: この 1 週間の新曲・MV・アルバムの発表/リリース・ライブやツアーの発表・歌ってみたで話題になったもの。最大 6 点。"
        "アーティストは下の、ドデカの曲置き場によく貼られる人を優先（ほかに大きな話題があれば 1〜2 点まで可）。\n"
        "見出しは「## 新曲・MV」「## ライブ・発表」（無い見出しは書かない）。\n"
        + (f"よく貼られるアーティスト・チャンネル: {'、'.join(artists)}\n" if artists else "")
    )
    return _dodeka(guild_id), prompt, [], 5, 1


def _recent_daily(guild_id: str) -> Tuple[str, List[str]]:
    """直近（36 時間以内）の「今日の調査」。質問の下敷きにする（同じことを調べ直さない・リンクはそのまま使える）"""
    try:
        from . import store
        rep = store.last_of(guild_id, "daily")
    except Exception:
        return "", []
    if not rep or not rep.get("markdown"):
        return "", []
    try:
        if datetime.now(timezone.utc) - datetime.fromisoformat(rep["created_at"]) > timedelta(hours=36):
            return "", []
    except ValueError:
        return "", []
    return rep["markdown"], [s["url"] for s in rep.get("sources") or [] if s.get("url")]


def question(guild_id: str, q: str, who: str) -> Tuple[str, str, List[str], int, int]:
    now = datetime.now(JST)
    daily_md, daily_urls = _recent_daily(guild_id)
    prompt = (
        f"今日は {now:%Y年%m月%d日 %H:%M}（日本時間）。ドデカのメンバー（{who}）からの質問に、web_search と web_fetch で調べて答えて。"
        "大会の日程・パッチ・新作の情報は英語の公式やメディアのほうが早いので、英語でも検索する。日付や時刻は公式のページを web_fetch して確かめる。\n"
        "最初の 1〜2 文で結論。続けて根拠や選択肢を「- 」で最大 6 点（各点に出典）。見出しは付けなくてよい。"
        "ゲームのおすすめを聞かれたら、候補を web_search で見つけたあと steam_lookup で日本円の価格・人数・日本語対応・評価を確かめ、"
        "人数・価格・協力/対戦・日本語・評価を書く（ストアのリンクを出典に）。#ゲーム置き場 に貼られたことがあるものは「置き場にもある」と書く。"
        "候補は 3〜5 本を目安に（1 本しか見つからなければ、検索の言葉を変えてもう一度探す）。ツールの項目名（英語）は本文に出さない。"
        + ("\n\n参考（イリーナが今日調べたこと。関係あればそのまま使ってよく、リンクも出典に使ってよい）:\n" + daily_md[:6000] if daily_md else "")
        + "\n\n質問: " + q.strip()[:500]
    )
    return _dodeka(guild_id), prompt, daily_urls, 6, 2


DESKS = {"daily": daily, "weekly_new": weekly_new, "weekly_music": weekly_music}
TITLES = {"daily": "今日の調査", "weekly_new": "今週の新作", "weekly_music": "今週の新曲"}
