#!/usr/bin/env python3
"""#ゲーム置き場の過去の投稿を取り込む（Pi の backend/ で実行）。

  cd ~/discord-music-app/backend
  .venv/bin/python ../scripts/backfill_game_shelf.py --guild 1093915551174234212 --channel 1381958352267116574 [--seed seed.json]

- Discord REST（bot トークン）で全メッセージを読み、リンクを game_posts に入れる（読み取りのみ・何も送らない）
- --seed: 事前に作った {games: {appid: {...summary, profile}}, x: {status_id: {text, appid}}} を入れて、
  Steam / fxtwitter / Claude を二重に叩かないようにする（種に無いものだけ取りに行く）
- 最後に未解決の投稿を解決し、価格・無料配布・同時接続数を 1 回更新する
"""
import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import timezone, datetime

sys.path.insert(0, os.getcwd())
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.getcwd(), ".env"))  # DISCORD_TOKEN / STEAM_API_KEY / CLAUDE_API_KEY
from app import db  # noqa: E402
from app.services import game_db as gdb, game_shelf, game_sources as src  # noqa: E402


def fetch_messages(channel_id: str):
    tok = os.environ["DISCORD_TOKEN"]
    out, before = [], None
    while True:
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages?limit=100" + (f"&before={before}" if before else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bot {tok}", "User-Agent": "DiscordBot (irina, 1.0)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                batch = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(float(json.loads(e.read()).get("retry_after", 1)) + 0.3)
                continue
            raise
        if not batch:
            return out
        out += batch
        before = batch[-1]["id"]
        time.sleep(0.4)


def avatar(u):
    return f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.png?size=64" if u.get("avatar") else \
        f"https://cdn.discordapp.com/embed/avatars/{(int(u['id']) >> 22) % 6}.png"


async def main(a):
    db.init_db()
    gdb.kv_set("game_backfill_lock", gdb.now_iso())
    try:
        msgs = fetch_messages(a.channel)
        added = 0
        for m in msgs:
            u = m["author"]
            if u.get("bot"):
                continue
            name = (m.get("member") or {}).get("nick") or u.get("global_name") or u.get("username")
            ts = datetime.fromisoformat(m["timestamp"]).astimezone(timezone.utc).isoformat()
            for l in src.classify_links(m.get("content") or ""):
                added += gdb.add_post(guild_id=a.guild, channel_id=a.channel, message_id=m["id"], kind=l["kind"],
                                      url=l["url"], ref=l["ref"], posted_by_id=u["id"], posted_by_name=name,
                                      posted_by_image=avatar(u), posted_at=ts)
            gdb.upsert_member(a.guild, u["id"], name, avatar(u))
        print(f"messages={len(msgs)} new_posts={added}")
        if a.seed:
            seed = json.load(open(a.seed))
            for appid, g in (seed.get("games") or {}).items():
                prof = g.pop("profile", None)
                gdb.upsert_game(appid, **g, details_at=gdb.now_iso(),
                                **({"profile": json.dumps(prof, ensure_ascii=False), "profile_at": gdb.now_iso()} if prof else {}))
            n = 0
            for p in gdb.posts_for_guild(a.guild):
                if p["kind"] != "x" or p["resolved"]:
                    continue
                x = (seed.get("x") or {}).get(p["ref"].split("/")[-1])
                if x and x.get("text"):
                    fields = {"x_text": x["text"]}
                    if x.get("appid"):
                        fields.update(appid=x["appid"], resolved=1)
                    gdb.update_post(p["id"], **fields)
                    n += 1
            print(f"seeded games={len(seed.get('games') or {})} x_posts={n}")
        while True:
            done = await game_shelf.resolve_pending(50)
            left = len(gdb.pending_posts(1000))
            print(f"resolved batch={done} pending={left}", flush=True)
            if not done or not left:
                break
        posted = {p["appid"] for p in gdb.posts_for_guild(a.guild) if p.get("appid")}
        for g in gdb.all_games(posted):
            if g.get("details_at") and not g.get("review_desc"):
                rev = await src.steam_reviews(g["appid"])
                if rev:
                    gdb.upsert_game(g["appid"], review_desc=rev["desc"], review_total=rev["total"], review_pct=rev["pct"])
        await game_shelf.refresh_prices()
        await game_shelf.refresh_offers()
        await game_shelf.refresh_players()
        for k in ("game_prices_at", "game_offers_at", "game_players_at"):
            gdb.kv_set(k, gdb.now_iso())
    finally:
        gdb.kv_set("game_backfill_lock", "2000-01-01T00:00:00+00:00")
    print("done")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--guild", required=True)
    ap.add_argument("--channel", required=True)
    ap.add_argument("--seed")
    asyncio.run(main(ap.parse_args()))
