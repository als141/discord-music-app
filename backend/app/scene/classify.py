"""界隈の記事・動画を Claude で振り分ける。

記事の判定は 2026-10-11 に検証済み: 過去に #ゲーム置き場 に貼られた 169 件のうち 83% を fit>=2 で拾い、
同じメディアの RSS 270 件から選ぶのは 10%（Sonnet 5.5・effort low、439 件で $0.45）。
"""
import os
from typing import Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from ..services import game_sources as gsrc, llm_budget

# 振り分けは最新の Haiku 5.5（$0.10/$0.50。Sonnet 5.5 の 1/20）。2026-10-11 の検証で再現率 86%・採用率 14%（Sonnet は 83%・10%）。
# 選ぶのは後段の Opus 5.5 なので、少し広めに拾う Haiku で十分
# 2026-10-20 オーナー指定「裏で動くのは Sonnet 5.5」。量が多い振り分けなので effort は medium（思考はほぼ 0 のまま、low より取り違えが少ない）
MODEL = os.getenv("IRINA_SCENE_MODEL") or "claude-sonnet-5-5"
EFFORT = os.getenv("IRINA_SCENE_EFFORT") or "medium"

TASTE = """あなたは Discord サーバー「ドデカ」（固定 8 人の友人。夜に VC でゲームをする）のゲーム係。
彼らが #ゲーム置き場 に貼るのは、主に次のようなもの:
- 2〜8 人でオンライン協力・パーティで遊べるインディー/中小のゲーム（ホラー協力、物理系わちゃわちゃ、脱出、サバイバル、クラフト、ローグライク協力、対戦パーティ）
- SNS や実況で話題になりそうな、短時間で笑える・盛り上がるもの
- 無料配布・期間限定無料・フリーウィークエンド・体験版（デモ）・大型セール（期限があるもの）
- 大作でも、友達と一緒に遊べるマルチプレイが売りのもの
貼らないもの: アニメ・グッズ・映画・ハード・業界ニュース・e スポーツ大会・ソロ専用の物語ゲーム（よほど話題なら別）・ソシャゲのイベント・家庭用専用・DLC の細かい情報"""


class ArticleJudge(BaseModel):
    id: str
    game: Optional[str] = Field(description="記事が主に扱うゲーム名（記事の表記のまま。無ければ null）")
    game_en: Optional[str] = Field(description="そのゲームの英語の正式名（Steam の表記。分からなければ null）")
    multiplayer: Literal["coop", "pvp", "both", "solo", "unknown"]
    max_players: Optional[int]
    hook: Literal["free", "demo", "sale", "release", "announce", "early_access", "update", "buzz", "other"]
    fit: int = Field(ge=0, le=3, description="0=貼らない 1=たぶん貼らない 2=貼りそう 3=絶対貼る")
    why: str = Field(description="15 文字以内")


class ArticleBatch(BaseModel):
    items: List[ArticleJudge]


class VideoJudge(BaseModel):
    id: str
    kind: Literal["game", "song", "other"] = Field(description="game=ゲームの配信・切り抜き・大会 / song=歌ってみた・カバー・オリジナル曲・歌枠・踊ってみた / other=雑談など")
    game: Optional[str] = Field(description="kind=game のときのゲーム名（題名の表記。APEX→Apex Legends のように正式名に寄せる）")
    game_en: Optional[str] = Field(description="そのゲームの英語の正式名（Steam の表記。分からなければ null）")
    song: Optional[str] = Field(description="kind=song のときの曲名（原曲の曲名。歌枠で複数なら代表 1 曲、無ければ null）")
    artist: Optional[str] = Field(description="原曲のアーティスト（ボカロ P・歌手。オリジナル曲ならその本人。分からなければ null）")
    song_type: Optional[Literal["original", "mv", "cover", "dance", "live", "short", "other"]] = Field(
        description="kind=song のとき: original=本人のオリジナル曲/新曲 mv=公式 MV・リリック cover=歌ってみた・カバー dance=踊ってみた live=ライブ映像・歌枠 short=Shorts の切り出し")
    hook: Optional[str] = Field(description="kind=song のとき、何の動画かを 20 文字以内で（例: ヨルシカの新曲 MV、星街すいせいの歌ってみた）")


class VideoBatch(BaseModel):
    items: List[VideoJudge]


async def judge_articles(rows: List[Dict]) -> Tuple[Dict[str, Dict], float]:
    """rows: {id, text}"""
    res: Dict[str, Dict] = {}
    usd = 0.0
    for i in range(0, len(rows), 30):
        if not llm_budget.allowed("anthropic"):
            break
        chunk = rows[i:i + 30]
        lines = "\n".join(f"[{r['id']}] {r['text']}" for r in chunk)
        r = await gsrc._client().messages.parse(
            model=MODEL, max_tokens=16000, system=TASTE, output_config={"effort": EFFORT},
            messages=[{"role": "user", "content": "次の記事それぞれについて判定して、全件を返して。\n\n" + lines}],
            output_format=ArticleBatch)
        usd += llm_budget.cost(MODEL, r.usage)
        llm_budget.log("anthropic", MODEL, "scene_articles", llm_budget.cost(MODEL, r.usage))
        for it in (r.parsed_output.items if r.parsed_output else []):
            res[it.id] = it.model_dump()
    return res, usd


async def judge_videos(rows: List[Dict]) -> Tuple[Dict[str, Dict], float]:
    """rows: {id, text}（チャンネル名 | 題名）"""
    res: Dict[str, Dict] = {}
    usd = 0.0
    for i in range(0, len(rows), 40):
        if not llm_budget.allowed("anthropic"):
            break
        chunk = rows[i:i + 40]
        lines = "\n".join(f"[{r['id']}] {r['text']}" for r in chunk)
        r = await gsrc._client().messages.parse(
            model=MODEL, max_tokens=16000, output_config={"effort": EFFORT},
            system="日本の配信者・VTuber・アーティストの YouTube 動画の題名から、何の動画かを判定する。",
            messages=[{"role": "user", "content": "次の動画（チャンネル名 | 題名）それぞれについて判定して、全件を返して。\n\n" + lines}],
            output_format=VideoBatch)
        usd += llm_budget.cost(MODEL, r.usage)
        llm_budget.log("anthropic", MODEL, "scene_videos", llm_budget.cost(MODEL, r.usage))
        for it in (r.parsed_output.items if r.parsed_output else []):
            res[it.id] = it.model_dump()
    return res, usd
