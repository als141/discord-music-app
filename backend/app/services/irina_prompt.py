"""イリーナの system prompt「束（bundle）」の読み込み。

ユーザーが管理するディレクトリ（`IRINA_PROMPT_DIR`、既定 ~/irina。Pi では /home/als0028/irina）から、
次の順で連結する。どのファイルも内容は加工しない（CSV だけは表を箇条書きに変換する）。

  1. persona.md        — 人格・世界観・口調（誰であるか）。無ければ旧 ~/irina_persona.txt を読む
  2. instructions.md   — ユーザーが書く指示（任意）
  3. style.md          — 話し方の実例・few-shot（任意）
  4. knowledge/*.md|txt|csv — 語録・ミーム・内輪ネタなどの参考データ。<knowledge name="…"> で囲んで入れる
  5. knowledge/_auto/x_trends.md — 当日の X トレンドメモ（irina_trends.py が自動生成。任意）

戻り値のキーは全ファイルの mtime/size のハッシュ。どれか 1 つでも変わると新しい会話チェーンになる（保存した次の発言から反映）。
中身はログに出さない（ファイル名とサイズだけ）。
"""
import csv
import hashlib
import io
import os
from typing import Any, Dict, List, Optional, Tuple

PROMPT_DIR_DEFAULT = "~/irina"
LEGACY_PERSONA_FILE = "~/irina_persona.txt"
KNOWLEDGE_MAX_CHARS = int(os.getenv("IRINA_KNOWLEDGE_MAX_CHARS") or "60000")   # 参考データ全体の上限（超えた分は末尾を落として明記）
CSV_COLUMNS_ENV = "IRINA_KNOWLEDGE_CSV_COLUMNS"  # 例: "語録,使用方法,カテゴリ"（省略時は全列。備考など長い列を落としてトークンを節約できる）

_cache: Dict[str, Any] = {"key": None, "text": None, "info": None}


def prompt_dir() -> str:
    return os.path.expanduser(os.getenv("IRINA_PROMPT_DIR") or PROMPT_DIR_DEFAULT)


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read()


def _csv_to_bullets(text: str, columns: Optional[List[str]]) -> str:
    """CSV を「- 主列 — 他列」の箇条書きに。ヘッダ行を持つ想定。列指定があればその順で使う"""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return ""
    header = [h.strip() for h in rows[0]]
    if columns:
        idx = [header.index(c) for c in columns if c in header]
    else:
        idx = list(range(len(header)))
    if not idx:
        idx = list(range(len(header)))
    lines = [f"（列: {', '.join(header[i] for i in idx)}）"]
    for r in rows[1:]:
        cells = [r[i].strip() if i < len(r) else "" for i in idx]
        if not any(cells):
            continue
        main = cells[0]
        rest = [f"{header[i]}: {c}" for i, c in zip(idx[1:], cells[1:]) if c]
        lines.append(f"- {main}" + (" — " + " / ".join(rest) if rest else ""))
    return "\n".join(lines)


def _knowledge_files(d: str) -> List[str]:
    kdir = os.path.join(d, "knowledge")
    files: List[str] = []
    if not os.path.isdir(kdir):
        return files
    for root, _dirs, names in os.walk(kdir):
        for n in sorted(names):
            if n.startswith(".") or not n.lower().endswith((".md", ".txt", ".csv")):
                continue
            files.append(os.path.join(root, n))
    # _auto（自動生成）は最後に
    files.sort(key=lambda p: (1 if os.sep + "_auto" + os.sep in p else 0, p))
    return files


def load_bundle() -> Tuple[str, str, Dict[str, Any]]:
    """(system prompt の先頭部分, 変更検知キー, 情報) を返す。ファイルが無ければ空文字と 'empty' を返す"""
    d = prompt_dir()
    parts: List[str] = []
    stat_parts: List[str] = []
    info: Dict[str, Any] = {"dir": d, "files": []}

    def add_file(path: str, label: Optional[str] = None, wrap_knowledge: bool = False) -> None:
        try:
            st = os.stat(path)
        except FileNotFoundError:
            return
        stat_parts.append(f"{path}:{st.st_mtime_ns}:{st.st_size}")
        try:
            text = _read(path)
        except Exception as e:
            info["files"].append({"file": os.path.basename(path), "error": f"{type(e).__name__}"})
            return
        if path.lower().endswith(".csv"):
            cols_env = os.getenv(CSV_COLUMNS_ENV)
            cols = [c.strip() for c in cols_env.split(",")] if cols_env else None
            text = _csv_to_bullets(text, cols)
        if not text.strip():
            return
        if wrap_knowledge:
            name = os.path.splitext(os.path.basename(path))[0]
            text = f'<knowledge name="{name}">\n{text.strip()}\n</knowledge>'
        parts.append(text.strip("\n"))
        info["files"].append({"file": os.path.relpath(path, d), "chars": len(text)})

    persona = os.path.join(d, "persona.md")
    if os.path.exists(persona):
        add_file(persona)
    else:
        add_file(os.path.expanduser(LEGACY_PERSONA_FILE))
    add_file(os.path.join(d, "instructions.md"))
    add_file(os.path.join(d, "style.md"))

    knowledge_parts_start = len(parts)
    for path in _knowledge_files(d):
        add_file(path, wrap_knowledge=True)
    # 参考データの総量に上限（超えた分は落として明記）
    total = sum(len(p) for p in parts[knowledge_parts_start:])
    if total > KNOWLEDGE_MAX_CHARS:
        kept: List[str] = []
        budget = KNOWLEDGE_MAX_CHARS
        for p in parts[knowledge_parts_start:]:
            if budget <= 0:
                break
            kept.append(p if len(p) <= budget else p[:budget] + "\n…（長いので省略）")
            budget -= len(p)
        parts = parts[:knowledge_parts_start] + kept
        info["truncated"] = True

    key = hashlib.sha1("|".join(stat_parts).encode("utf-8")).hexdigest()[:12] if stat_parts else "empty"
    text = "\n\n".join(parts)
    if _cache["key"] != key:
        _cache.update({"key": key, "text": text, "info": info})
        summary = ", ".join(f"{f['file']}({f.get('chars', '?')})" for f in info["files"]) or "(none)"
        print(f"[irina-prompt] bundle loaded from {d}: {summary} → {len(text)} chars")
    return text, key, info
