"""Web Push（VAPID）の送信。

- 鍵は .env: `VAPID_PRIVATE_KEY`（DER の base64url 1 行）/ `VAPID_PUBLIC_KEY`（ブラウザに渡す applicationServerKey）
  `VAPID_SUBJECT`（既定 https://discord-music-app.vercel.app。mailto: か https: のみ）
- ペイロードは Safari の Declarative Web Push 形式（`web_push: 8030` + `notification`、`mutable` は付けない）。
  iOS 18.4+ / Safari 18.5+ は Service Worker を起こさずにそのまま表示し、タップで navigate の URL を開く。
  Chrome / Firefox / それより古い Safari は sw.ts の push ハンドラが同じ JSON を読んで表示する
- 開封数は、navigate の URL に付けた `?n=<log_id>` をアプリが開いたときに数える（どちらの経路でも同じ）
- 404 / 410 が返った購読は失効なので消す
- 送信は requests（同期）なので to_thread で並列 8 本まで
"""
import asyncio
import json
import os
from typing import Any, Dict, Iterable, List, Optional

from .. import db

APP_ORIGIN = (os.getenv("IRINA_APP_ORIGIN") or "https://discord-music-app.vercel.app").rstrip("/")
DEFAULT_ICON = f"{APP_ORIGIN}/icons/icon-192x192.png"
CONCURRENCY = 8

_vapid = None


def public_key() -> Optional[str]:
    return (os.getenv("VAPID_PUBLIC_KEY") or "").strip() or None


def configured() -> bool:
    return bool(public_key() and (os.getenv("VAPID_PRIVATE_KEY") or "").strip())


def _get_vapid():
    global _vapid
    if _vapid is None:
        from py_vapid import Vapid02
        _vapid = Vapid02.from_string((os.getenv("VAPID_PRIVATE_KEY") or "").strip())
    return _vapid


def _subject() -> str:
    # VAPID の sub は mailto: か https: の URL だけ（http://localhost 等は py_vapid が拒否する）
    return (os.getenv("VAPID_SUBJECT") or "https://discord-music-app.vercel.app").strip()


def absolute_url(path_or_url: str) -> str:
    if not path_or_url:
        return f"{APP_ORIGIN}/"
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    return f"{APP_ORIGIN}{path_or_url if path_or_url.startswith('/') else '/' + path_or_url}"


def build_payload(*, title: str, body: str, url: str, kind: str, log_id: Optional[int] = None,
                  tag: Optional[str] = None, image: Optional[str] = None) -> Dict[str, Any]:
    """Declarative Web Push 形式 + SW 用の追加情報（irina）"""
    target = absolute_url(url)
    if log_id is not None:
        target += ("&" if "?" in target else "?") + f"n={log_id}"
    notification: Dict[str, Any] = {
        "title": title[:120],
        "body": body[:400],
        "navigate": target,
        "lang": "ja",
        "dir": "ltr",
        "icon": DEFAULT_ICON,
    }
    if tag:
        notification["tag"] = tag
    return {
        "web_push": 8030,
        "notification": notification,
        # WebKit は 2025-05 以降 app_badge をトップレベルで読む
        "app_badge": 1,
        "irina": {"kind": kind, "log_id": log_id, "url": target, "icon": DEFAULT_ICON, "image": image},
    }


def _send_one(device: Dict[str, Any], payload_json: str, ttl: int, urgency: str, topic: Optional[str]) -> Dict[str, Any]:
    from pywebpush import webpush, WebPushException
    sub = {"endpoint": device["push_endpoint"], "keys": {"p256dh": device["push_p256dh"], "auth": device["push_auth"]}}
    headers = {"Urgency": urgency}
    if topic:
        headers["Topic"] = topic
    try:
        resp = webpush(
            subscription_info=sub,
            data=payload_json,
            vapid_private_key=_get_vapid(),
            vapid_claims={"sub": _subject()},
            ttl=ttl,
            headers=headers,
            timeout=15,
        )
        status = getattr(resp, "status_code", 201)
        return {"device_id": device["device_id"], "ok": 200 <= status < 300, "status": status}
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        return {"device_id": device["device_id"], "ok": False, "status": status, "error": str(e)[:200]}
    except Exception as e:  # ネットワーク等
        return {"device_id": device["device_id"], "ok": False, "status": None, "error": f"{type(e).__name__}: {str(e)[:160]}"}


async def send(devices: Iterable[Dict[str, Any]], payload: Dict[str, Any], *, ttl: int = 24 * 3600,
               urgency: str = "normal", topic: Optional[str] = None) -> Dict[str, Any]:
    """端末群に送る。戻り値: {sent, failed, removed, results}"""
    targets = [d for d in devices if d.get("push_endpoint")]
    if not targets or not configured():
        return {"sent": 0, "failed": 0, "removed": 0, "results": []}
    payload_json = json.dumps(payload, ensure_ascii=False)
    sem = asyncio.Semaphore(CONCURRENCY)

    async def one(d):
        async with sem:
            return await asyncio.to_thread(_send_one, d, payload_json, ttl, urgency, topic)

    results: List[Dict[str, Any]] = await asyncio.gather(*(one(d) for d in targets))
    sent = failed = removed = 0
    for r in results:
        if r["ok"]:
            sent += 1
            await asyncio.to_thread(db.mark_push_result, r["device_id"], True)
        elif r.get("status") in (404, 410):
            removed += 1
            await asyncio.to_thread(db.clear_push_subscription, device_id=r["device_id"], error=f"expired ({r['status']})")
        else:
            failed += 1
            await asyncio.to_thread(db.mark_push_result, r["device_id"], False, r.get("error"))
    return {"sent": sent, "failed": failed, "removed": removed, "results": results}


async def send_logged(*, kind: str, title: str, body: str, url: str, devices: List[Dict[str, Any]],
                      created_by: Optional[str] = None, ttl: int = 24 * 3600, urgency: str = "normal",
                      topic: Optional[str] = None, tag: Optional[str] = None) -> Dict[str, Any]:
    """push_log に記録しながら送る（管理画面の履歴・開封数に出る）"""
    log_id = await asyncio.to_thread(db.add_push_log, kind=kind, title=title, body=body, url=url, created_by=created_by)
    payload = build_payload(title=title, body=body, url=url, kind=kind, log_id=log_id, tag=tag)
    res = await send(devices, payload, ttl=ttl, urgency=urgency, topic=topic)
    users = len({d["user_id"] for d in devices if d.get("push_endpoint")})
    await asyncio.to_thread(db.finish_push_log, log_id, target_users=users,
                            target_devices=len([d for d in devices if d.get("push_endpoint")]),
                            sent=res["sent"], failed=res["failed"], removed=res["removed"])
    print(f"[push] {kind} #{log_id} '{title[:30]}' → users={users} sent={res['sent']} failed={res['failed']} removed={res['removed']}")
    return {"log_id": log_id, "target_users": users, **{k: res[k] for k in ("sent", "failed", "removed")}}
