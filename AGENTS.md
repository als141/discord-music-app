# AGENTS.md

## Role
このリポジトリの作業方針を定義する補助ドキュメント。  

## Single Source of Truth (SSoT)
- 運用・設定・デバッグ方針の最優先参照先は `CLAUDE.md` です。
- `CLAUDE.md` に矛盾がある場合は、まず最新コミット時点の `CLAUDE.md` を優先して行動する。
- 追加判断が必要な場合は、`CLAUDE.md` を更新してから運用を変更する。

## 常時運用ルール
- 変更は作業ログを参照し、特に `backend/logs/app.log` を見ることで挙動確認を行う。
- 音声/音楽再生関連の不具合修正は、まず既存の `CLAUDE.md` の「Key Technical Notes」を確認してから手を入れる。
- 会話で指示があった場合を除き、不要なファイルは触らない。
