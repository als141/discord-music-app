"""イリーナが自分のソースコードを読むためのツール（`read_code`。オーナー指定 2026-10-16「GitHub とかから自身のコードも読みに行ける力を」）。

- 読むのはこのリポジトリ（GitHub の als141/discord-music-app、PUBLIC）の **HEAD にコミットされた内容だけ**。
  Pi のチェックアウトは自動デプロイで 10 秒ごとに origin/main と同じになるので、いま本番で動いているコードそのもの
- 作業ツリーのファイルは開かない（`git ls-tree` / `git show HEAD:<path>` / `git grep … HEAD` だけ）。
  同じディレクトリにある backend/.env・cookies.txt・uploaded_songs.db・未コミットの CLAUDE.md は、コミットされていないので読めない
- 結果には GitHub のリンク（その時点のコミットの blob と行番号）を付ける。Discord にそのまま貼れる
- 念のため、トークンらしい文字列（Discord / xAI / OpenAI / Anthropic / Google / GitHub）は伏せ字にしてから返す
- git はシェルを通さず固定の引数で呼ぶ。10 秒で打ち切る（voice プロセスのイベントループを止めない）

action:
  tree  … ファイル一覧（path でディレクトリを絞る）とサイズ
  read  … 1 ファイルを行番号付きで（既定 120 行ずつ、最大 300 行。場所は先に grep で当てる）
  grep  … 全ファイルから探す（正規表現。正規表現として読めなければ文字どおり）。最大 50 件
  log   … 変更履歴（path で絞れる）
  show  … 1 つのコミットの説明・変更ファイル・差分
"""
import asyncio
import os
import re
from typing import Any, Dict, List, Optional, Tuple

REPO = os.path.abspath(os.getenv("IRINA_CODE_REPO") or os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GIT_TIMEOUT_SEC = 10
MAX_CHARS = 9000
READ_DEFAULT_LINES = 120
READ_MAX_LINES = 300
GREP_MAX_HITS = 50
GREP_LINE_CHARS = 180
LOG_MAX = 40

_SECRET_RES = [
    re.compile(r"[MN][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}"),  # Discord bot token
    re.compile(r"xai-[A-Za-z0-9]{20,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
]
_SHA_RE = re.compile(r"^(HEAD(~\d{1,3})?|[0-9a-fA-F]{4,40})$")
_github_base: Optional[str] = None


def redact(s: str) -> str:
    for r in _SECRET_RES:
        s = r.sub("[伏せ字]", s)
    return s


async def _git(*args: str) -> Tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", REPO, "-c", "core.quotepath=off", *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat"},
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    return proc.returncode or 0, out.decode("utf-8", errors="replace"), err.decode("utf-8", errors="replace")


async def _github() -> str:
    """https://github.com/<owner>/<repo>（remote の書き方に依らず）"""
    global _github_base
    if _github_base is None:
        _, url, _ = await _git("remote", "get-url", "origin")
        url = url.strip()
        m = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?$", url)
        _github_base = f"https://github.com/{m.group(1)}/{m.group(2)}" if m else ""
    return _github_base


async def _head() -> str:
    _, sha, _ = await _git("rev-parse", "HEAD")
    return sha.strip()


def _clean_path(path: Optional[str]) -> Optional[str]:
    """リポジトリ内の相対パスに直す。外に出る・オプションに見えるものは None"""
    p = (path or "").strip().replace("\\", "/")
    p = re.sub(r"^(\./)+", "", p).lstrip("/")
    if p.endswith("/"):
        p = p.rstrip("/")
    if not p:
        return ""
    if p.startswith("-") or "\x00" in p or any(part == ".." for part in p.split("/")):
        return None
    return p


def _cap(s: str, limit: int = MAX_CHARS) -> Tuple[str, bool]:
    if len(s) <= limit:
        return s, False
    return s[:limit] + f"\n…（{len(s) - limit} 文字省略）", True


async def _tree(path: str) -> Dict[str, Any]:
    args = ["ls-tree", "-r", "-l", "HEAD"] + (["--", path] if path else [])
    code, out, err = await _git(*args)
    if code != 0:
        return {"error": f"一覧を取れなかった: {err.strip()[:200]}"}
    rows = []
    for line in out.splitlines():
        meta, _, name = line.partition("\t")
        parts = meta.split()
        if len(parts) < 4 or parts[1] != "blob":
            continue
        size = int(parts[3]) if parts[3].isdigit() else 0
        rows.append(f"{name}  {size / 1024:.1f}KB" if size >= 1024 else f"{name}  {size}B")
    if not rows:
        return {"error": f"「{path}」はコミットされたファイルにもディレクトリにも無い"}
    text, cut = _cap("\n".join(rows))
    return {"files": len(rows), "list": text, "truncated": cut,
            "hint": "中身は action=read、場所が分からないときは action=grep"}


async def _read(path: str, start: Optional[int], end: Optional[int]) -> Dict[str, Any]:
    if not path:
        return {"error": "path が要る（例: backend/app/bot.py）"}
    code, kind, _ = await _git("cat-file", "-t", f"HEAD:{path}")
    kind = kind.strip()
    if code != 0:
        return {"error": f"「{path}」はコミットされたファイルではない（.env・cookie・DB などリポジトリに無いものは読めない）。"
                         "場所が分からなければ action=tree か grep"}
    if kind == "tree":
        return await _tree(path)
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", REPO, "show", f"HEAD:{path}", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        raw, _ = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    if b"\x00" in raw[:8000]:
        return {"error": f"「{path}」はバイナリ（画像など）なので読めない", "bytes": len(raw)}
    lines = raw.decode("utf-8", errors="replace").splitlines()
    total = len(lines)
    a = max(1, int(start or 1))
    b = int(end) if end and int(end) >= a else a + READ_DEFAULT_LINES - 1
    b = min(total, b, a + READ_MAX_LINES - 1)
    if a > total:
        return {"error": f"このファイルは {total} 行しかない", "total_lines": total}
    width = len(str(b))
    body = "\n".join(f"{i:>{width}}\t{lines[i - 1]}" for i in range(a, b + 1))
    body, cut = _cap(body)
    sha = await _head()
    res: Dict[str, Any] = {"path": path, "lines": f"{a}-{b}", "total_lines": total, "content": body,
                           "url": f"{await _github()}/blob/{sha}/{path}#L{a}-L{b}"}
    if b < total or cut:
        res["more"] = f"続きは start_line={b + 1}（全 {total} 行）"
    return res


async def _grep(pattern: str, path: str, ignore_case: bool) -> Dict[str, Any]:
    if not pattern.strip():
        return {"error": "pattern が要る"}
    base = ["grep", "-n", "-I", "--no-color", "--full-name"] + (["-i"] if ignore_case else [])
    tail = ["-e", pattern, "HEAD"] + (["--", path] if path else [])
    code, out, err = await _git(*base, "-E", *tail)
    mode = "正規表現"
    if code not in (0, 1):  # 正規表現として読めなかった → 文字どおりに探す
        code, out, err = await _git(*base, "-F", *tail)
        mode = "文字どおり"
    if code == 1 or not out.strip():
        return {"hits": 0, "note": f"「{pattern}」は見つからなかった（{mode}で検索）"}
    if code != 0:
        return {"error": f"検索に失敗: {err.strip()[:200]}"}
    rows: List[str] = []
    all_hits = out.splitlines()
    for line in all_hits[:GREP_MAX_HITS]:
        line = line[5:] if line.startswith("HEAD:") else line
        f, _, rest = line.partition(":")
        n, _, txt = rest.partition(":")
        rows.append(f"{f}:{n}: {txt.strip()[:GREP_LINE_CHARS]}")
    text, _ = _cap("\n".join(rows))
    sha = await _head()
    res: Dict[str, Any] = {"hits": len(all_hits), "matches": text, "mode": mode,
                           "url_template": f"{await _github()}/blob/{sha}/<path>#L<行>"}
    if len(all_hits) > GREP_MAX_HITS:
        res["note"] = f"{len(all_hits)} 件のうち最初の {GREP_MAX_HITS} 件。path で絞れる"
    return res


async def _log(path: str, limit: Optional[int]) -> Dict[str, Any]:
    n = max(1, min(LOG_MAX, int(limit or 15)))
    args = ["log", f"-n{n}", "--date=format:%Y-%m-%d %H:%M", "--pretty=format:%h %ad %s"] + (["--", path] if path else [])
    code, out, err = await _git(*args)
    if code != 0:
        return {"error": f"履歴を取れなかった: {err.strip()[:200]}"}
    rows = [ln[:260] + ("…" if len(ln) > 260 else "") for ln in out.splitlines()]
    if not rows:
        return {"error": f"「{path}」の履歴は無い"}
    text, _ = _cap("\n".join(rows))
    return {"commits": text, "url_template": f"{await _github()}/commit/<sha>",
            "hint": "1 つのコミットの中身は action=show sha=…"}


async def _show(sha: str, path: str) -> Dict[str, Any]:
    sha = (sha or "HEAD").strip()
    if not _SHA_RE.match(sha):
        return {"error": "sha はコミットの ID（例: 941c175）か HEAD / HEAD~1"}
    args = ["show", "--stat", "--patch", "-U3", "--date=format:%Y-%m-%d %H:%M",
            "--format=commit %H%nDate: %ad%n%n%B", sha] + (["--", path] if path else [])
    code, out, err = await _git(*args)
    if code != 0:
        return {"error": f"そのコミットは無い: {err.strip()[:200]}"}
    text, cut = _cap(out)
    full = out.split("\n", 1)[0].replace("commit ", "").strip()
    res: Dict[str, Any] = {"commit": text, "url": f"{await _github()}/commit/{full}"}
    if cut:
        res["more"] = "差分が長いので途中まで。path でファイルを絞れる"
    return res


async def run(action: str, path: Optional[str] = None, pattern: Optional[str] = None, start_line: Optional[int] = None,
              end_line: Optional[int] = None, sha: Optional[str] = None, limit: Optional[int] = None,
              ignore_case: bool = False) -> Dict[str, Any]:
    p = _clean_path(path)
    if p is None:
        return {"error": "path はリポジトリの中の相対パス（例: backend/app/services/music_player.py）"}
    action = (action or "").strip().lower()
    try:
        if action == "tree":
            res = await _tree(p)
        elif action == "read":
            res = await _read(p, start_line, end_line)
        elif action == "grep":
            res = await _grep(str(pattern or ""), p, bool(ignore_case))
        elif action == "log":
            res = await _log(p, limit)
        elif action == "show":
            res = await _show(str(sha or "HEAD"), p)
        else:
            return {"error": "action は tree / read / grep / log / show のどれか"}
    except asyncio.TimeoutError:
        return {"error": "git が時間内に終わらなかった"}
    except FileNotFoundError:
        return {"error": "git が見つからない"}
    for k, v in list(res.items()):
        if isinstance(v, str):
            res[k] = redact(v)
    return res
