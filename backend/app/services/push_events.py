"""bot の出来事から自動で送るプッシュ通知（voice プロセスで動く）。

1. 曲置き場に曲が置かれた（`shelf`）
   - 対象チャンネル `IRINA_PUSH_SHELF_CHANNEL_IDS`（既定: ドデカの #曲置き場）
   - 90 秒まとめてから送る（連投を 1 通に）。貼った本人には送らない。1 人あたり 30 分に 1 通まで
2. VC で音楽が流れ始めた（`vc_music`）
   - しばらく（20 分以上）何も流れていなかったギルドで再生が始まったときだけ。デプロイ後のレジュームでは送らない
   - 曲を入れた本人と、そのボイスチャンネルに既にいる人には送らない。1 人あたり 3 時間に 1 通まで
どちらも既定オフで、各自が「通知とアプリ」でオンにした人にだけ送る（notif_prefs）。対象ギルドは `IRINA_PUSH_GUILD_IDS`（既定: ドデカ）。
"""
import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from .. import db
from . import push

DODEKA_GUILD_ID = "1093915551174234212"
SHELF_CHANNEL_DEFAULT = "1426606582606860428"  # ドデカ #曲置き場

SHELF_COALESCE_SEC = 90
SHELF_MIN_INTERVAL_SEC = 30 * 60
VC_IDLE_GAP_SEC = 20 * 60
VC_MIN_INTERVAL_SEC = 3 * 3600


def _ids(env: str, default: str) -> Set[str]:
    return {x.strip() for x in (os.getenv(env) or default).split(",") if x.strip()}


def push_guild_ids() -> Set[str]:
    return _ids("IRINA_PUSH_GUILD_IDS", DODEKA_GUILD_ID)


def shelf_channel_ids() -> Set[str]:
    return _ids("IRINA_PUSH_SHELF_CHANNEL_IDS", SHELF_CHANNEL_DEFAULT)


def _user_id_of(added_by: Any) -> Optional[str]:
    if added_by is None:
        return None
    if isinstance(added_by, dict):
        v = added_by.get("id")
    else:
        v = getattr(added_by, "id", None)
    return str(v) if v else None


def _user_name_of(added_by: Any) -> str:
    if added_by is None:
        return ""
    if isinstance(added_by, dict):
        return str(added_by.get("name") or "")
    return str(getattr(added_by, "display_name", None) or getattr(added_by, "name", "") or "")


def _targets(kind: str, exclude: Set[str], min_interval: int) -> List[Dict[str, Any]]:
    """設定をオンにしていて、間引き期間を過ぎた人の購読端末（設定の行が無い人は既定＝オフ）"""
    prefs = db.get_all_notif_prefs()
    devices = db.list_push_devices()
    ok_users: Set[str] = set()
    for uid in {d["user_id"] for d in devices}:
        if uid in exclude:
            continue
        if not prefs.get(uid, db.DEFAULT_NOTIF_PREFS).get(kind, False):
            continue
        if not db.throttle_ok(uid, kind, min_interval):
            continue
        ok_users.add(uid)
    return [d for d in devices if d["user_id"] in ok_users]


# ---------------------------------------------------------------------------
# 1. 曲置き場
# ---------------------------------------------------------------------------

_shelf_pending: Dict[str, Dict[str, Any]] = {}


def on_shelf_links(guild_id: str, channel_id: str, channel_name: Optional[str], poster_id: str,
                   poster_name: str, video_ids: List[str]) -> None:
    """shared_links.collect から呼ぶ（保存できたリンクがあったとき）"""
    if guild_id not in push_guild_ids() or channel_id not in shelf_channel_ids() or not push.configured():
        return
    key = f"{guild_id}:{channel_id}"
    entry = _shelf_pending.get(key)
    if entry is None:
        entry = {"guild_id": guild_id, "channel_name": channel_name or "曲置き場", "posters": {}, "video_ids": []}
        _shelf_pending[key] = entry
        asyncio.get_running_loop().create_task(_flush_shelf_later(key))
    entry["posters"][poster_id] = poster_name
    for v in video_ids:
        if v not in entry["video_ids"]:
            entry["video_ids"].append(v)


async def _flush_shelf_later(key: str) -> None:
    await asyncio.sleep(SHELF_COALESCE_SEC)
    entry = _shelf_pending.pop(key, None)
    if not entry:
        return
    try:
        # 曲名はこの間に resolver が付けていることが多い。無ければ「YouTube の動画」
        from . import shared_links
        await shared_links.resolve_pending()
        links = await asyncio.to_thread(db.get_shared_links, entry["guild_id"], 50)
        titles = []
        for vid in entry["video_ids"]:
            hit = next((l for l in links if l["video_id"] == vid), None)
            if hit and hit.get("title"):
                titles.append(f"{hit['title']}" + (f" — {hit['artist']}" if hit.get("artist") else ""))
        posters = list(entry["posters"].values())
        who = posters[0] if len(posters) == 1 else f"{posters[0]} ほか"
        n = len(entry["video_ids"])
        if n == 1:
            body = f"{who} が「{titles[0]}」を置きました" if titles else f"{who} が曲を置きました"
        else:
            body = f"{who} が {n} 曲置きました" + (f"：{titles[0]} ほか" if titles else "")
        body += "。タップでキューに追加できます"
        devices = await asyncio.to_thread(_targets, "shelf", set(entry["posters"].keys()), SHELF_MIN_INTERVAL_SEC)
        if not devices:
            return
        res = await push.send_logged(kind="shelf", title=f"#{entry['channel_name']} に新しい曲", body=body,
                                     url="/?tab=shelf", devices=devices, ttl=12 * 3600, topic="irina-shelf",
                                     tag="irina-shelf")
        if res["sent"]:
            await asyncio.to_thread(db.throttle_mark, sorted({d["user_id"] for d in devices}), "shelf")
    except Exception as e:
        print(f"[push] shelf notify failed: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# 2. VC で音楽が流れ始めた
# ---------------------------------------------------------------------------

async def on_now_playing(guild, song) -> None:
    """MusicPlayer の再生開始 / 終了フック（now_playing_status と一緒に呼ばれる）"""
    try:
        guild_id = str(guild.id)
        if guild_id not in push_guild_ids():
            return
        state = "playing" if song is not None else "idle"
        prev = await asyncio.to_thread(db.swap_guild_activity, guild_id, state)
        if song is None or not push.configured():
            return
        if getattr(song, "resumed", False):
            return  # デプロイ後のレジューム
        if prev is not None:
            if prev["state"] == "playing":
                return  # 続けて流れている
            try:
                idle_for = (datetime.now(timezone.utc) - datetime.fromisoformat(prev["changed_at"])).total_seconds()
            except ValueError:
                idle_for = VC_IDLE_GAP_SEC
            if idle_for < VC_IDLE_GAP_SEC:
                return  # ちょっと止まっていただけ
        vc = getattr(guild, "voice_client", None)
        channel = getattr(vc, "channel", None)
        if channel is None:
            return
        exclude = {str(m.id) for m in getattr(channel, "members", [])}
        adder_id = _user_id_of(getattr(song, "added_by", None))
        if adder_id:
            exclude.add(adder_id)
        adder = _user_name_of(getattr(song, "added_by", None))
        title = song.title or "曲"
        artist = f" — {song.artist}" if getattr(song, "artist", "") else ""
        body = f"「{title}{artist}」" + (f"（{adder} が追加）" if adder else "") + "。VC に入って一緒に聴けます"
        devices = await asyncio.to_thread(_targets, "vc_music", exclude, VC_MIN_INTERVAL_SEC)
        if not devices:
            return
        res = await push.send_logged(kind="vc_music", title=f"{channel.name} で音楽が流れ始めました", body=body,
                                     url="/", devices=devices, ttl=3600, topic="irina-vc-music", tag="irina-vc-music")
        if res["sent"]:
            await asyncio.to_thread(db.throttle_mark, sorted({d["user_id"] for d in devices}), "vc_music")
    except Exception as e:
        print(f"[push] vc_music notify failed: {type(e).__name__}: {e}")
