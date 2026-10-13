"""ドデカのおすすめを組み立てる（決定的なスコア＋Claude の並びと一言）。

材料: reco_events（流した・貼った・置いた・2024 年に bot へ貼った）× reco_tracks（音楽だけ）
  → 好みのプロフィール（アーティストごとの重み。最近の重みと、全期間の重み）
  → 4 つの気分ごとの候補とスコア
    - now（いま聴きたい）: 最近よく流れる曲を種にした YouTube Music の「次に流れる曲」＋「最近流れてない定番」
    - memories（懐かしい）: 半年以上前にドデカで流れた・貼られた曲（だれが・いつ）＋10 年以上前の名曲
    - new（新しい）: 好きなアーティストの今年の曲
    - nico（ニコニコ）: 今週伸びてる・関連・殿堂入り（好みのボカロ P・歌い手に寄せる）
理由の「だれが・いつ」はデータからだけ作る（Claude には書かせない）。Claude は並びと、発見枠の一言だけ（curate.py）
VC にいま居る人がいれば、その人たちの曲を種・思い出として強める。並びは 3 時間ごとに少し入れ替わる（毎回同じにしない）
"""
import math
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from . import links, sources, store

JST = timezone(timedelta(hours=9))
KIND_W = {"play": 1.0, "queue": 1.0, "box": 1.0, "post": 0.6}
SHELF_POST_W = 0.9
RECENT_HALF_LIFE = 60.0
MOODS = ("now", "memories", "new", "nico")
PER_MOOD = 12


def _dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def gap_text(days: float) -> str:
    if days < 14:
        return f"{max(1, int(days))}日ぶり"
    if days < 60:
        return f"{int(days // 7)}週間ぶり"
    months = int(days // 30.4)
    if months < 12:
        return f"{months}か月ぶり"
    y, m = divmod(months, 12)
    return f"{y}年{m}か月ぶり" if m else f"{y}年ぶり"


def _season(d: datetime) -> str:
    m = d.astimezone(JST).month
    return "春" if 3 <= m <= 5 else "夏" if 6 <= m <= 8 else "秋" if 9 <= m <= 11 else "冬"


def tokens_of(artists: Iterable[Dict[str, Any]], *names: Optional[str]) -> Set[str]:
    toks: Set[str] = set()
    for a in artists or []:
        if a.get("id"):
            toks.add("id:" + a["id"])
        for al in links.name_aliases(a.get("name")):
            toks.add("n:" + al)
    for n in names:
        for al in links.name_aliases(n):
            toks.add("n:" + al)
    return toks


def track_tokens(t: Dict[str, Any]) -> Set[str]:
    return tokens_of(t.get("artists") or [], t.get("orig_artist"), t.get("channel"))


def display_of(t: Dict[str, Any]) -> Tuple[str, str, Optional[str]]:
    """(題名, アーティスト, アーティストID)。歌ってみたは歌った人をアーティストに"""
    arts = t.get("artists") or []
    title = t.get("song") or t.get("title") or "（題名なし）"
    if t.get("song_type") == "cover":
        return title, _clean_channel(t.get("channel")), None
    if arts:
        return title, ", ".join(a["name"] for a in arts[:2]), arts[0].get("id")
    return title, t.get("orig_artist") or _clean_channel(t.get("channel")), None


def _clean_channel(n: Optional[str]) -> str:
    n = (n or "").replace("- Topic", "").strip()
    for sep in (" / ", "／", "|", "｜", "【", "("):
        n = n.split(sep)[0]
    return n.strip() or "？"


class Profile:
    """ドデカの好み。tracks は音楽と判定された曲だけ"""

    def __init__(self, guild_id: str, now: Optional[datetime] = None):
        self.guild_id = guild_id
        self.now = now or datetime.now(timezone.utc)
        evs = store.events(guild_id)
        alltracks = store.tracks({e["key"] for e in evs})
        self.tracks = {k: t for k, t in alltracks.items() if t.get("kind") == "music" and not t.get("gone")}
        self.stats: Dict[str, Dict[str, Any]] = {}
        self.aff_all: Dict[str, float] = defaultdict(float)
        self.aff_recent: Dict[str, float] = defaultdict(float)
        self.user_tokens: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        self.people: Set[str] = set()
        self.first_at: Optional[datetime] = None
        self.skipped: Dict[str, datetime] = {}
        for e in evs:
            t = self.tracks.get(e["key"])
            at = _dt(e["at"])
            if not t or not at:
                continue
            if e["kind"] == "skip":
                # すぐ飛ばされた: その再生を数えず、アーティストを少し下げる
                dec = 0.5 ** (max(0.0, (self.now - at).total_seconds() / 86400) / RECENT_HALF_LIFE)
                st = self.stats.get(e["key"])
                if st:
                    st["n"] = max(0, st["n"] - 1)
                    st["w"] -= 1.0
                    st["wr"] -= dec
                for tok in track_tokens(t):
                    self.aff_all[tok] -= 1.3
                    self.aff_recent[tok] -= 1.3 * dec
                self.skipped[e["key"]] = max(self.skipped.get(e["key"], at), at)
                continue
            w = KIND_W.get(e["kind"], 0.5)
            if e["kind"] == "post" and e.get("channel_id") in sources.SHELF_CHANNELS:
                w = SHELF_POST_W
            age = max(0.0, (self.now - at).total_seconds() / 86400)
            dec = 0.5 ** (age / RECENT_HALF_LIFE)
            st = self.stats.setdefault(e["key"], {"n": 0, "users": Counter(), "first": at, "last": at, "kinds": Counter(),
                                                  "w": 0.0, "wr": 0.0, "events": []})
            st["n"] += 1
            if e.get("user_id"):
                st["users"][e["user_id"]] += 1
                self.people.add(e["user_id"])
            st["first"] = min(st["first"], at)
            st["last"] = max(st["last"], at)
            st["kinds"][e["kind"]] += 1
            st["w"] += w
            st["wr"] += w * dec
            st["events"].append(e)
            self.first_at = at if self.first_at is None else min(self.first_at, at)
            for tok in track_tokens(t):
                self.aff_all[tok] += w
                self.aff_recent[tok] += w * dec
                if e.get("user_id"):
                    self.user_tokens[e["user_id"]][tok] += w
        self.max_all = max(self.aff_all.values(), default=1.0) or 1.0
        self.stats = {k: st for k, st in self.stats.items() if st["n"] > 0}
        self.max_recent = max(self.aff_recent.values(), default=1.0) or 1.0

    def affinity(self, toks: Set[str]) -> Tuple[float, float]:
        """(全期間, 最近)。0〜1。いちばん強いアーティストを 1 として sqrt で均す（飛ばされてマイナスなら 0）"""
        a = max(0.0, max((self.aff_all.get(t, 0.0) for t in toks), default=0.0))
        r = max(0.0, max((self.aff_recent.get(t, 0.0) for t in toks), default=0.0))
        return math.sqrt(a / self.max_all), math.sqrt(r / self.max_recent)

    def recently_skipped(self, days: float = 30) -> Set[str]:
        return {k for k, at in self.skipped.items() if (self.now - at).total_seconds() < days * 86400}

    def days_since(self, key: str) -> Optional[float]:
        st = self.stats.get(key)
        return (self.now - st["last"]).total_seconds() / 86400 if st else None

    def aliases(self, top: int = 80) -> Set[str]:
        """好きなアーティスト名（ニコニコのタグと突き合わせる用）"""
        names = sorted(((v, t[2:]) for t, v in self.aff_all.items() if t.startswith("n:")), reverse=True)[:top]
        return {n for _, n in names if len(n) >= 2}


# ---------------------------------------------------------------- 候補

def _thumb(thumb: Optional[str], key: str) -> str:
    """YouTube Music の小さいジャケット（w60-h60）は大きくする。無ければ動画のサムネ"""
    if thumb and "googleusercontent" in thumb:
        return re.sub(r"=w\d+-h\d+", "=w240-h240", thumb)
    return thumb or links.thumb_of(key)


def _clean(title: str, artist: str) -> str:
    from .meta import display_title
    return display_title(title, artist) or title


def _item(key: str, title: str, artist: str, *, artist_id: Optional[str] = None, thumb: Optional[str] = None,
          year: Optional[int] = None, kind: str, reason: str, sub: Optional[str] = None, score: float, who: Optional[str] = None,
          seed: Optional[str] = None, label: Optional[str] = None, seed_artist: Optional[Tuple[Optional[str], str]] = None) -> Dict[str, Any]:
    """reason の {A} はこの曲のアーティスト、{S} は種の曲のアーティスト、{who} は who の名前（service._finish が日本語名で埋める）"""
    return {"key": key, "title": _clean(title, artist), "artist": artist, "artist_id": artist_id, "thumb": _thumb(thumb, key),
            "year": year, "kind": kind, "reason": reason, "sub": sub, "score": score, "who": who, "seed": seed, "label": label,
            "seed_artist_id": (seed_artist or (None, ""))[0], "seed_artist": (seed_artist or (None, ""))[1],
            "toks": tokens_of([{"name": artist, "id": artist_id}]) if artist else set()}


_LABEL = {"cover": "歌ってみた", "live": "ライブ", "dance": "踊ってみた"}


def _track_item(p: Profile, key: str, *, kind: str, reason: str, sub: Optional[str], score: float, who: Optional[str] = None) -> Dict[str, Any]:
    t = p.tracks[key]
    title, artist, aid = display_of(t)
    it = _item(key, title, artist, artist_id=aid, thumb=t.get("thumb"), year=t.get("year"), kind=kind, reason=reason, sub=sub,
               score=score, who=who, label=_LABEL.get(t.get("song_type") or ""))
    it["toks"] = track_tokens(t)
    return it


def _top_user(st: Dict[str, Any], prefer: Set[str]) -> Optional[str]:
    us = st["users"]
    if not us:
        return None
    for u, _ in us.most_common():
        if u in prefer:
            return u
    return us.most_common(1)[0][0]


def _verb(st: Dict[str, Any]) -> str:
    k = st["kinds"]
    if k["play"] or k["queue"]:
        return "流した"
    if k["box"]:
        return "置いた"
    return "貼った"


def seeds(p: Profile, vc: Set[str], n: int = 14) -> List[Tuple[str, float]]:
    """最近よく流れる曲（アーティストは 2 曲まで）。VC に居る人の曲は強める"""
    scored = []
    for k, st in p.stats.items():
        if not k.startswith("yt:"):
            continue
        s = st["wr"] + 0.15 * st["w"] + 0.3 * (len(st["users"]) - 1)
        if vc and set(st["users"]) & vc:
            s *= 1.8
        scored.append((s, k))
    scored.sort(reverse=True)
    out: List[Tuple[str, float]] = []
    per_artist: Counter = Counter()
    for s, k in scored:
        _, artist, _ = display_of(p.tracks[k])
        if per_artist[artist] >= 2:
            continue
        per_artist[artist] += 1
        out.append((k, s))
        if len(out) >= n:
            break
    return out


def radio_pool(p: Profile, seed_list: List[Tuple[str, float]], radios: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    """種ごとの「次に流れる曲」を足し合わせる（何曲もの種から出てくる曲ほど強い）"""
    pool: Dict[str, Dict[str, Any]] = {}
    top_seed = max((w for _, w in seed_list), default=1.0) or 1.0
    for sk, sw in seed_list:
        for pos, it in enumerate(radios.get(sk) or []):
            c = pool.setdefault(it["key"], {"it": it, "s": 0.0, "seeds": Counter()})
            contrib = (sw / top_seed) * (1.0 / (1.0 + pos / 8.0))
            c["s"] += contrib
            c["seeds"][sk] += contrib
    return pool


def _seed_artist(p: Profile, sk: str) -> Tuple[Optional[str], str]:
    """種の曲のアーティスト（YouTube Music の ID, 名前）。歌ってみたは歌った人、名前は判定の日本語表記を優先"""
    t = p.tracks.get(sk)
    if not t:
        return None, ""
    if t.get("song_type") == "cover":
        return None, _clean_channel(t.get("channel"))
    arts = t.get("artists") or []
    first = arts[0] if arts else {}
    return first.get("id"), (t.get("orig_artist") or first.get("name") or _clean_channel(t.get("channel"))).split("、")[0]


def _fan(p: Profile, toks: Set[str], min_w: float = 2.0) -> Optional[str]:
    """そのアーティストをいちばん流している人（この人向け、のアイコン用）"""
    best, who = 0.0, None
    for u, tw in p.user_tokens.items():
        w = max((tw.get(t, 0.0) for t in toks), default=0.0)
        if w > best:
            best, who = w, u
    return who if best >= min_w else None


def build_now(p: Profile, vc: Set[str], radios: Dict[str, List[Dict[str, Any]]], blocked: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
    sl = seeds(p, vc)
    pool = radio_pool(p, sl, radios)
    disc = []
    for k, c in pool.items():
        if k in blocked:
            continue
        ds = p.days_since(k)
        if ds is not None and ds < 60:
            continue  # 最近ドデカで流れた・貼られた
        it = c["it"]
        if it.get("duration") and it["duration"] > 15 * 60:
            continue
        a_all, a_rec = p.affinity(tokens_of(it.get("artists") or []))
        s = c["s"] + 0.6 * a_rec + 0.3 * a_all
        sk = c["seeds"].most_common(1)[0][0]
        seed_users = set(p.stats[sk]["users"]) if sk in p.stats else set()
        reason = "いまの VC 向け" if vc and seed_users & vc else "{S}を流すなら"
        arts = it.get("artists") or []
        who = _top_user(p.stats[sk], vc) if sk in p.stats else None
        disc.append(_item(k, it["title"], ", ".join(a["name"] for a in arts[:1]) or "？", artist_id=(arts[0].get("id") if arts else None),
                          thumb=it.get("thumb"), year=it.get("year"), kind="discovery", reason=reason, sub=None, score=s, seed=sk,
                          who=who, seed_artist=_seed_artist(p, sk)))
    favs = []
    for k, st in p.stats.items():
        if k in blocked:
            continue
        ds = p.days_since(k) or 0
        if not (21 <= ds <= 200) or (st["n"] < 2 and len(st["users"]) < 2):
            continue
        s = math.log2(1 + st["n"]) + 0.6 * (len(st["users"]) - 1) + min(ds, 120) / 120
        if vc and set(st["users"]) & vc:
            s *= 1.5
        who = _top_user(st, vc)
        reason = f"{len(st['users'])}人が{_verb(st)}" if len(st["users"]) >= 2 else f"ドデカの定番 · {st['n']}回"
        favs.append(_track_item(p, k, kind="favorite", reason=reason, sub=gap_text(ds), score=s, who=who))
    return {"discovery": disc, "favorite": favs}


def build_memories(p: Profile, vc: Set[str], radios: Dict[str, List[Dict[str, Any]]], blocked: Set[str],
                   extra: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    mem = []
    for k, st in p.stats.items():
        if k in blocked:
            continue
        ds = p.days_since(k) or 0
        if ds < 150:
            continue
        months = ds / 30.4
        s = math.log2(1 + st["n"]) + 0.6 * (len(st["users"]) - 1) + 0.08 * min(months, 24) + (0.3 if st["kinds"]["queue"] else 0.0)
        if vc and set(st["users"]) & vc:
            s *= 1.4
        who = _top_user(st, vc)
        last = st["last"].astimezone(JST)
        if st["n"] >= 3:
            reason = f"{st['first'].astimezone(JST).year}年{_season(st['first'])}によく流れた · {st['n']}回"
        else:
            reason = f"{last.year}年{last.month}月に{{who}}が{_verb(st)}"
        mem.append(_track_item(p, k, kind="memory", reason=reason, sub=gap_text(ds), score=s, who=who))
    # 10 年以上前の名曲: 思い出の曲・定番を種にしたラジオから、古い年のもの
    old_year = datetime.now(timezone.utc).year - 10
    mem_seeds = sorted(((st["w"], k) for k, st in p.stats.items() if k.startswith("yt:")), reverse=True)
    pool = radio_pool(p, [(k, w) for w, k in mem_seeds], radios)
    tb = []
    for k, c in pool.items():
        it = c["it"]
        if k in blocked or k in p.stats or not it.get("year") or it["year"] > old_year:
            continue
        toks = tokens_of(it.get("artists") or [])
        a_all, _ = p.affinity(toks)
        sk = c["seeds"].most_common(1)[0][0]
        arts = it.get("artists") or []
        tb.append(_item(k, it["title"], ", ".join(a["name"] for a in arts[:1]) or "？", artist_id=(arts[0].get("id") if arts else None),
                        thumb=it.get("thumb"), year=it["year"], kind="throwback", reason="{S}好きなら", sub=f"{it['year']}年",
                        score=c["s"] + 0.5 * a_all + 0.4 * len(c["seeds"]), seed=sk, who=_fan(p, toks) or _top_user(p.stats[sk], vc),
                        seed_artist=_seed_artist(p, sk)))
    tb += [x for x in extra if x["key"] not in blocked and x["key"] not in p.stats]
    return {"memory": mem, "throwback": tb}


def build_new(p: Profile, radios: Dict[str, List[Dict[str, Any]]], blocked: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
    year = datetime.now(timezone.utc).year
    sl = sorted(((st["w"] + 2 * st["wr"], k) for k, st in p.stats.items() if k.startswith("yt:")), reverse=True)[:30]
    pool = radio_pool(p, [(k, w) for w, k in sl], radios)
    out = []
    for k, c in pool.items():
        it = c["it"]
        if k in blocked or k in p.stats or (it.get("year") or 0) < year:
            continue
        toks = tokens_of(it.get("artists") or [])
        a_all, a_rec = p.affinity(toks)
        arts = it.get("artists") or []
        name = ", ".join(a["name"] for a in arts[:1]) or "？"
        sk = c["seeds"].most_common(1)[0][0]
        fan = _fan(p, toks)
        reason = "{A}の新曲" if a_all > 0.25 else "{S}好きに"
        out.append(_item(k, it["title"], name, artist_id=(arts[0].get("id") if arts else None), thumb=it.get("thumb"), year=it.get("year"),
                         kind="new", reason=reason, sub=f"{it['year']}年", score=c["s"] + 1.2 * a_all + 0.5 * a_rec, seed=sk,
                         who=fan or _top_user(p.stats[sk], set()), seed_artist=_seed_artist(p, sk)))
    return {"new": out}


def _nico_match(p_alias: Set[str], it: Dict[str, Any]) -> Optional[str]:
    for tag in it.get("tags") or []:
        n = links.normalize_name(tag)
        if len(n) >= 2 and n in p_alias:
            return tag
    return None


def _nico_title(t: str) -> Tuple[str, str]:
    """「楽園 / ナースロボ＿タイプＴ」→ (楽園, ナースロボ＿タイプＴ)。【】は外す"""
    import html as _html
    t = _html.unescape(t or "")
    core = re.sub(r"【[^】]*】", " ", t).strip()
    if " / " in core:
        a, b = core.split(" / ", 1)
        return a.strip() or t, b.strip()
    return core or t, ""


def _man(n: Optional[int]) -> str:
    n = n or 0
    return f"{n / 10000:.1f}万".replace(".0万", "万") if n >= 10000 else f"{n:,}"


def build_nico(p: Profile, trend: List[Dict[str, Any]], classic: List[Dict[str, Any]], related: Dict[str, List[Dict[str, Any]]],
               blocked: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
    alias = p.aliases()
    out: List[Dict[str, Any]] = []
    rel: List[Dict[str, Any]] = []
    old: List[Dict[str, Any]] = []
    for it in trend[:150]:
        if it["key"] in blocked or it["key"] in p.stats:
            continue
        m = _nico_match(alias, it)
        s = math.log10(1 + (it.get("likes") or 0)) + (2.0 if m else 0.0)
        title, artist = _nico_title(it["title"])
        out.append(_item(it["key"], title, artist, thumb=it.get("thumb"), year=it.get("year"), kind="trend",
                         reason=f"{m}好きなら · 今週伸びてる" if m else "今週ニコニコで伸びてる", sub=f"♡{_man(it.get('likes'))}", score=s))
    for sk, items in related.items():
        st = p.stats.get(sk)
        if not st:
            continue
        stitle = display_of(p.tracks[sk])[0]
        for pos, it in enumerate(items[:12]):
            if it["key"] in blocked or it["key"] in p.stats:
                continue
            title, artist = _nico_title(it["title"])
            rel.append(_item(it["key"], title, artist, thumb=it.get("thumb"), year=it.get("year"), kind="related",
                             reason=f"「{stitle[:14]}」の関連", sub=None, score=2.2 + st["w"] * 0.2 - pos * 0.1))
    for it in classic[:400]:
        if it["key"] in blocked or it["key"] in p.stats:
            continue
        m = _nico_match(alias, it)
        s = 0.8 * math.log10(1 + (it.get("views") or 0)) - 3.0 + (2.0 if m else 0.0)
        title, artist = _nico_title(it["title"])
        old.append(_item(it["key"], title, artist, thumb=it.get("thumb"), year=it.get("year"), kind="classic",
                         reason=f"{m}好きなら" if m else "ニコニコの名曲", sub=f"{it.get('year')}年 · {_man(it.get('views'))}回", score=s))
    return {"trend": out, "related": rel, "classic": old}


# ---------------------------------------------------------------- いまの起点（流れてる曲・キュー・さっき置いた曲）

_ANCHOR_REASON = {"playing": "流れてる「{t}」から", "queue": "次の「{t}」とつながる", "box": "置いた「{t}」から",
                  "played": "さっきの「{t}」から"}


def _short(t: str, n: int = 12) -> str:
    t = re.sub(r"[【\[(（].*?[】\])）]", "", t or "").strip() or (t or "")
    t = t.split(" / ")[0].split("／")[0].strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def build_context(p: Profile, anchors: List[Dict[str, Any]], radios: Dict[str, List[Dict[str, Any]]], blocked: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
    """いま流れてる曲・キュー・さっき置いた/流した曲の「次に流れる曲」。ここがいちばん上に来る（入れた瞬間に変わる）"""
    out: List[Dict[str, Any]] = []
    skip = {a["key"] for a in anchors}
    for a in anchors:
        for pos, it in enumerate((radios.get(a["key"]) or [])[:25]):
            k = it["key"]
            if k in blocked or k in skip:
                continue
            ds = p.days_since(k)
            if ds is not None and ds < 2:
                continue  # きのう今日流れた
            if it.get("duration") and it["duration"] > 15 * 60:
                continue
            arts = it.get("artists") or []
            if k.startswith("nico:"):
                title, artist = _nico_title(it["title"])
                aid = None
            else:
                title, artist, aid = it["title"], ", ".join(x["name"] for x in arts[:1]) or "？", (arts[0].get("id") if arts else None)
            a_all, _ = p.affinity(tokens_of(arts))
            s = a["w"] * 4.0 / (1.0 + pos / 6.0) + 0.5 * a_all
            x = _item(k, title, artist, artist_id=aid, thumb=it.get("thumb"), year=it.get("year"), kind="context",
                      reason=_ANCHOR_REASON.get(a["src"], "「{t}」から").replace("{t}", _short(a.get("title") or "")), sub=None,
                      score=s, seed=a["key"])
            x["toks"] = tokens_of(arts) | x["toks"]
            out.append(x)
    return {"context": out}


def neighborhood(anchors: List[Dict[str, Any]], radios: Dict[str, List[Dict[str, Any]]]) -> Set[str]:
    """起点の曲とその「次に流れる曲」のアーティスト。ほかの枠の曲も、ここに近いものを上げる（全体がいまに寄る）"""
    toks: Set[str] = set()
    for a in anchors:
        toks |= tokens_of([], a.get("artist"))
        for it in (radios.get(a["key"]) or [])[:15]:
            toks |= tokens_of(it.get("artists") or [])
    return toks


def lean_to(buckets: Dict[str, List[Dict[str, Any]]], neigh: Set[str], weight: float = 1.5) -> None:
    if not neigh:
        return
    for name, items in buckets.items():
        if name == "context":
            continue
        for it in items:
            if it.get("toks") and it["toks"] & neigh:
                it["score"] += weight


# 一面に混ぜるときの並び（足りない枠は飛ばして次へ）。いまの起点が無いときは「好みから」が上に来る
MIXED = ["context", "context", "memory", "context", "new", "scene", "discovery", "context", "favorite", "trend", "memory",
         "context", "scene", "discovery", "throwback", "new", "related", "memory", "classic", "discovery", "favorite", "context"]

TAGS = {"context": "続けて", "discovery": "好みから", "favorite": "定番", "memory": "懐かしい", "throwback": "懐かしい",
        "new": "新曲", "scene": "界隈", "trend": "ニコニコ", "related": "ニコニコ", "classic": "ニコニコ"}

# 気分ごとの混ぜ方（Claude の選曲の候補づくりに使う）
PATTERNS = {
    "now": ["discovery", "discovery", "favorite"],
    "memories": ["memory", "memory", "throwback"],
    "new": ["new"],
    "nico": ["trend", "related", "trend", "classic"],
}


def _rank(bucket: List[Dict[str, Any]], curated: Dict[str, Tuple[int, Optional[str]]], rnd: random.Random) -> List[Dict[str, Any]]:
    """Claude が選んだ曲を上げ、少しだけ揺らしてスコア順に"""
    ranked = []
    for it in bucket:
        s = it["score"]
        if it["key"] in curated:
            i, why = curated[it["key"]]
            s += 3.0 * max(0.2, 1 - i / 20)
            if why and it["kind"] in ("discovery", "throwback", "new", "trend", "classic", "related"):
                it = {**it, "reason": why}
        ranked.append((s * (1 + rnd.uniform(-0.12, 0.12)), it))
    ranked.sort(key=lambda x: -x[0])
    return [it for _, it in ranked]


def compose(mood: str, buckets: Dict[str, List[Dict[str, Any]]], curated: Optional[List[Dict[str, Any]]], seed: int,
            limit: int = PER_MOOD, per_artist: int = 2, per_seed: int = 2, exclude: Optional[Set[str]] = None) -> List[Dict[str, Any]]:
    """枠ごとに並べてから、気分の混ぜ方で 1 本に。同じ曲・同じアーティスト（2 曲まで）・同じ種（2 曲まで）・他の気分で出した曲は飛ばす"""
    cur = {c["key"]: (i, c.get("reason")) for i, c in enumerate(curated or [])}
    rnd = random.Random(seed)
    queues = {name: _rank(b, cur, rnd) for name, b in buckets.items()}
    order = MIXED if mood == "mixed" else (PATTERNS.get(mood) or list(buckets))
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set(exclude or ())
    arts: Counter = Counter()
    seeds_used: Counter = Counter()
    idle = 0
    i = 0
    while len(out) < limit and idle < len(order):
        q = queues.get(order[i % len(order)]) or []
        i += 1
        picked = False
        while q:
            it = q.pop(0)
            a = links.normalize_name(it.get("artist")) or it["key"]
            cap = per_seed + 3 if it["kind"] == "context" else per_seed   # いまの起点からは多めに
            if it["key"] in seen or arts[a] >= per_artist or (it.get("seed") and seeds_used[it["seed"]] >= cap):
                continue
            seen.add(it["key"])
            arts[a] += 1
            if it.get("seed"):
                seeds_used[it["seed"]] += 1
            out.append(it)
            picked = True
            break
        idle = 0 if picked else idle + 1
    return out


def rotate_seed(guild_id: str, now: Optional[datetime] = None) -> int:
    """3 時間ごとに変わる（同じ時間帯のあいだは同じ並び）"""
    import hashlib
    now = (now or datetime.now(timezone.utc)).astimezone(JST)
    return int(hashlib.sha1(f"{guild_id}|{now:%Y%m%d}|{now.hour // 3}".encode()).hexdigest()[:8], 16)
