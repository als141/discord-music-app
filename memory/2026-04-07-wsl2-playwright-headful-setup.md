# 2026-04-07: WSL2でPlaywrightウィンドウ確認用セットアップ

## 概要
- WSL2上でPlaywrightのブラウザ確認を「MCPだけでなく実際のウィンドウで」できるように、ヘルパースクリプトを追加。

## 変更
- 新規追加: `scripts/open-vercel-browser.sh`
  - `DISPLAY` 未設定時に、WSL環境の `nameserver` から Windows ホストIPを使って `DISPLAY=<host>:0` を候補設定。
  - `xdpyinfo` が使える場合は表示可能性を事前チェック。
  - `npx playwright open` を起動し、headed で `https://discord-music-app.vercel.app` を開く。
- 新規追加: `scripts/README.md`
  - 使い方、必要なXサーバー条件、`DISPLAY`設定例を明記。
- `CLAUDE.md` にPlaywright headed起動手順の参照を追記。

## 検証
- 実行時 `DISPLAY` は未設定状態だったため、スクリプトは「WSL2ではXサーバー要件を満たしているか確認」と案内して終了する挙動を確認。
- MCP上ではPlaywrightが headless で動作し、WSL2表示は別途Xサーバー設定が必要であることを確認。

## 次アクション
- Windows側でVcXsrv/WSLgを起動した状態で `./scripts/open-vercel-browser.sh` を再実行し、実際のブラウザウィンドウ表示とコンソールログ確認を行う。
