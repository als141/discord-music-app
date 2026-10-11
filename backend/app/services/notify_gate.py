"""オーナーが OK した通知だけを送る（オーナー指定 2026-10-11「通知は私が OK しないと送らないでね」）。

自動で届く通知（アプリのプッシュ）と、自動の Discord 投稿は、種類ごとにオーナーが管理画面で許可するまで送らない。
許可は app_kv の `notify_approved`（{種類: true}）。既定はすべて送らない。
ここを通らないもの: オーナー自身が送るお知らせ（管理画面）、本人が押すテスト通知、コマンドへの返事（/今夜 など）。
"""
import json
from typing import Dict, List

from . import game_db as gdb

KINDS: Dict[str, str] = {
    "push_shelf": "曲置き場に曲が置かれたとき（アプリの通知）",
    "push_vc_music": "VC で音楽が流れ始めたとき（アプリの通知）",
    "push_game_deals": "セール・無料配布のまとめ（アプリの通知、1 日 1 回）",
    "push_game_gather": "VC に人がそろったら（アプリの通知）",
    "discord_weekly_recap": "今週のドデカを #一般 に投稿（日曜 21 時）",
}
_warned: set = set()


def approved() -> Dict[str, bool]:
    try:
        d = json.loads(gdb.kv_get("notify_approved") or "{}")
        return {k: bool(d.get(k)) for k in KINDS}
    except ValueError:
        return {k: False for k in KINDS}


def allowed(kind: str) -> bool:
    ok = approved().get(kind, False)
    if not ok and kind not in _warned:
        _warned.add(kind)
        print(f"[notify-gate] {kind} はオーナーの許可が無いので送りません（管理画面で許可できます）")
    return ok


def set_approved(kind: str, on: bool) -> Dict[str, bool]:
    if kind not in KINDS:
        raise ValueError(kind)
    d = approved()
    d[kind] = bool(on)
    gdb.kv_set("notify_approved", json.dumps(d))
    _warned.discard(kind)
    return d


def listing() -> List[Dict[str, object]]:
    a = approved()
    return [{"kind": k, "label": v, "on": a[k]} for k, v in KINDS.items()]
