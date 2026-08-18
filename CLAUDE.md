# Claude Code Memory - Discord Music App

## MANDATORY: セッション終了時にこのファイルとmemoryディレクトリを必ず更新すること
- 新しい知見、バグ修正、インフラ変更、設定変更があれば必ずCLAUDE.mdとmemory/配下を更新する
- 更新せずにセッションを終了してはいけない
- 特に: 依存関係の変更、デプロイ手順の変更、新しいデバッグパターンは必ず記録する
- セッション中に得た全ての知識・修正内容・調査結果を次のセッションでも再現できる粒度で記録する

## Project Overview
Discord音楽ボットアプリケーション。フロントエンド（Next.js/Vercel）とバックエンド（FastAPI/Discord.py/Raspberry Pi）で構成。

## Development Commands

### Frontend (Next.js)
- **パッケージマネージャー**: `bun` を使用
- **ビルド**: `bun run build`
- **開発サーバー**: `bun run dev`
- **依存関係インストール**: `bun install`
- **依存関係追加**: `bun add <package>`

### Backend (FastAPI/Python)
- **パッケージマネージャー**: `uv` を使用
- **依存関係インストール**: `uv sync`
- **依存関係追加**: `uv add <package>`
- **開発サーバー起動**: `uv run python -m app.main` または `uv run uvicorn app.main:app --reload`
- **注意**: Pi上のvenvではlockファイルが古い場合がある。`uv pip install --python .venv/bin/python <pkg>` で直接更新する必要がある場合あり

## Important Reminders
- フロントエンドのビルドは必ず `bun` を使用すること
- バックエンドのパッケージ管理は必ず `uv` を使用すること
- `npm` や `pip` は使用しないこと

## Infrastructure

### Production (Raspberry Pi 4)
- **SSH**: `ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13`
- **Pi上のuv**: `~/.local/bin/uv`（パスが通っていないのでフルパス指定が必要）
- **サービス**: `discord-music-bot.service` (systemd)
- **ログ確認**: `journalctl -u discord-music-bot -f`
- **過去ログ**: `journalctl -u discord-music-bot --since '24 hours ago' --no-pager`
- **デプロイログ**: `~/discord-music-app/deploy.log`
- **自動デプロイ**: **10秒ごと**にGitHubをチェック (`discord-music-bot-deploy.timer`, `OnUnitActiveSec=10s`)。mainへのpush＝即本番デプロイ＋再起動
- **デプロイ前チェック（backend変更時は必須）**: `bash scripts/predeploy_check.sh` — 誰かが再生中（has_player=true のギルドあり）なら push を待つ。push＝10秒で bot 再起動＝再生が切れる
- **本番スモークテスト**: `bash scripts/smoke_test.sh`（デプロイ後に毎回実行。全主要API+ルート欠落+Piのエラーログを確認）
- **同時追加テスト（テストサーバー限定）**: `node scripts/concurrent-add-test.mjs`
- **実再生テスト（テストサーバー限定）**: `node scripts/live-playback-test.mjs` — bot を テストサーバー(1080511818658762752)/VC 一般 に入れて add-url/pause/resume/skip/disconnect を REST で叩き、WS 更新を検証。人がいるサーバーでは絶対に実行しない
- **リアルタイム同期のブラウザテスト**: `node scripts/realtime-sync-test.mjs`（dev サーバー必要。Playwright で WS を偽装、14 ケース）
- **リファクタ実行計画**: `docs/refactoring_execution_and_test_plan_ja.md`
- **手動デプロイ**: `cd ~/discord-music-app && bash deploy.sh`
- **コード場所**: `/home/als0028/discord-music-app/backend/`
- **環境変数**: `/home/als0028/discord-music-app/backend/.env`
- **Cookie**: `/home/als0028/discord-music-app/backend/cookies.txt`（2026-03-04作成、定期的な更新が必要な場合あり）
- **PYTHONUNBUFFERED=1**: systemdサービスに設定済み（ないとprint出力がjournalに出ない）
- **Node.js**: **v22.23.2**（2026-08-17 に NodeSource `node_22.x` へ更新。yt-dlp 2026.7 系は Node >= 22 必須。v20 は `(unsupported)` になり cookie 使用時に全フォーマット消失）
- **UFW**: incoming UDP 50000-65535許可済み（Discord Voice用）

### Pi上のパッケージバージョン確認コマンド
```bash
# 全バージョン一括確認
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13 "cd ~/discord-music-app/backend && .venv/bin/python -c \"
import yt_dlp, discord, sys
print(f'Python: {sys.version.split()[0]}')
print(f'discord.py: {discord.__version__}')
print(f'yt-dlp: {yt_dlp.version.__version__}')
\" && node --version"

# 個別パッケージ確認
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13 "~/.local/bin/uv pip show yt-dlp --python ~/discord-music-app/backend/.venv/bin/python"
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13 "~/.local/bin/uv pip show yt-dlp-ejs --python ~/discord-music-app/backend/.venv/bin/python"
```

### Pi上のパッケージバージョン（2026-04-07時点）
| パッケージ | バージョン | 最低要件 |
|-----------|-----------|---------|
| Python | 3.12.13 | - |
| Node.js | v22.23.2（2026-08-17更新） | >= 22（yt-dlp 2026.7+） |
| discord.py | 2.7.1 | >= 2.7.x |
| davey | 0.1.6（2026-08-17更新） | 必須 |
| fastapi / starlette / uvicorn | 0.141.1 / 1.6.0 / 0.52.3（2026-08-17更新） | - |
| yt-dlp | 2026.7.4（2026-08-17更新） | >= 2026.7 |
| yt-dlp-ejs | 0.8.0 | >= 0.5.0 |
| ytmusicapi | 1.12.2（2026-08-17更新） | >= 1.12 |

### Cloudflare Tunnel
- **URL**: `https://api.atoriba.jp` → Pi:8080
- **トンネル名**: `discord-music-api`
- **サービス**: `cloudflared.service` (systemd)
- **ドメイン**: `atoriba.jp` (お名前.com → Cloudflare NS)

### Frontend (Vercel)
- **URL**: `https://discord-music-app.vercel.app`
- **NEXT_PUBLIC_API_URL**: `https://api.atoriba.jp`
- **Playwright GUI確認**: `scripts/open-vercel-browser.sh` を実行すると、`Vercel` の画面をWSL2上でheaded表示できる。

### Railway（削除済み）
- プロジェクト削除済み。RailwayはUDP非対応でDiscord Voice接続不可。
- 同じDISCORD_TOKENで2台同時稼働すると Voice close code 4006/4017 が発生する。

## Key Technical Notes

### 2026-08-17: 関連曲500 / アルバム非表示の修正（ytmusicapi 1.12.2）
- **症状**: `/related/{video_id}` が `500 {"detail":"'endpoint'"}`、検索でアルバムが画面に出ない
- **原因1**: ytmusicapi 1.11.4 の `get_watch_playlist` が YouTube Music 応答変更で `KeyError('endpoint')`。1.12.2 で修正済み
- **原因2**: `YTMusic(language='ja')` だとアルバムの `type` が `'アルバム'` で返り、frontend の判定 `['album','single','ep']` に一致しなかった。さらに 1.11.4 の ja パースは artists に `'再生回数 11億 回'` や `'2026年'` が混入していた
- **注意（上流バグ）**: ytmusicapi 1.12.x は `language='ja'` だと **filter 付き search が空配列** になる（カテゴリ見出し「曲」と "song" を照合するため）。→ `main.py` は検索/関連/詳細取得用 `ytmusic = YTMusic(language='en', location='JP')` と、`get_home`/mood 用 `ytmusic_ja` の2インスタンス構成にした。**ytmusic を ja に戻してはいけない**
- `_normalize_album_type()` でロケール表記を正規化、`/related` は10件に制限、`/charts` は `songs` が無い場合 `videos`(list) にフォールバック
- 検証: ローカルで `app.main` の関数を直接呼んで全フィルタ/related/recommendations/mood/album/playlist を確認 → 本番デプロイ → `scripts/smoke_test.sh` 全OK

### 2026-08-18: ホームのおすすめを YouTube アカウント個人化に（cookies.txt を ytmusicapi にも使用）
- `main.py` `_build_ytmusic_personal()`: yt-dlp 用 `COOKIES_FILE`（Netscape 形式）から `SAPISID` 等を読み、ytmusicapi のブラウザ認証 JSON（`Authorization: SAPISIDHASH placeholder`。実値は ytmusicapi が毎回生成）で `ytmusic_personal` を作る。失敗時は None → 公開ホームにフォールバック。**読み取り専用でしか使わないこと**
- `/recommendations`: 個人化ホームから `HOME_PERSONAL_SECTIONS`（おすすめ / 新作 / おすすめの話題の曲 / 毎日のおすすめ / おすすめのアルバム / おすすめのミュージック ビデオ / おすすめのミックス）だけをホワイトリスト。「もう一度聴く」「最近聞いていないお気に入り」「ショートで視聴した曲」「ライブラリから」等の履歴が透けるものは出さない。cookies 無効時は公開の 新作 + おすすめ。キャッシュ1時間
- **ミックス（playlistId が `RD…`）は個人化プレイリスト**: 未ログインで `get_playlist` すると別人向けの中身（洋楽サントラ等）が返る。`/playlist/{id}` は `RD` 始まりなら `ytmusic_personal` で取得（ユーザー報告で発覚）
- frontend: ホームのプレイリスト/アルバム/ミックスをタップ → `CollectionDialog`（曲一覧、1曲ずつ / 先頭50曲まとめて追加）。アーティスト → ArtistDialog。以前は browse URL を yt-dlp に投げていた
- ホームアイテムの型判定: `browseId` が `MPRE` → アルバム（type からシングル/EP）、`UC` → アーティスト。`author` None 対応
- 調査メモ: ログイン状態の `get_home` は21セクション、`get_history`(200件) `get_liked_songs` `get_library_playlists` 等も取れる（個人情報なので UI には出していない）

### 2026-08-18: Discord ステータスを「バージョン1.0.0」に変更
- `bot.py:595` `CustomActivity(name='バージョン1.0.0')`（旧「工藤夏生デバッグ中」）。変更は bot 再起動を伴う

### 2026-08-18: 同時追加の堅牢化・ゾンビプレイヤー修正（commits 48d58aa / 曲飛ばし修正 / disconnect修正）
- **同時に複数曲を追加**: `MusicPlayer.add_to_queue` はプレースホルダ（`Song.pending=True`, title「読み込み中…」）を即座にキューへ入れ、yt-dlp 取得後に**同じ位置に差し替え**（失敗なら削除+通知）。到着順がそのままキュー順。UI は `Track.pending` でスピナー表示、先頭が pending なら `is_loading`
- **曲飛ばしバグ（同時追加テストで発見）**: 追加完了時の `next.set()` で player_loop が早起きし、再生中の曲を再スタート→stop→after コールバック連鎖で曲が次々消えていた。→ loop は after コールバックの `_song_finished` でのみ次へ進み、早起きは待ち直す。`next.set()` は「再生中でも一時停止中でもない」時だけ
- `skip()` が一時停止中に効かなかったのを修正
- **ゾンビプレイヤー**: `/disconnect-voice-channel` が `del music_players[...]` だけで `shutdown()` していなかった → 古い `player_loop` が生き残り、次に VC に入った瞬間に古いキューを勝手に再生した。→ `pop` + `await player.shutdown()`
- テスト: `node scripts/concurrent-add-test.mjs`（6件同時・1件無効、9ケース）、`live-playback-test.mjs`（14ケース）、`realtime-sync-test.mjs`（14ケース）全 OK

### 2026-08-18: デザイン刷新の試行と着地（commit 8b4fc7b5）
- ブランチ `design/2026-listening-room` で「紙色＋明朝＋藍」の刷新案を作ったが、ユーザー評価は「明朝不要・フォントは前の方が良い・色味がAIっぽい・挨拶コピー不要」→ **見た目は元の白地＋ローズ＋システムサンセリフに戻し**、機能改善だけ main にマージ
- 残ったもの: `use-artwork-accent.ts`（再生中サムネから代表色を抽出し `--color-primary`/`--accent-glow` を実行時上書き。@property でクロスフェード）、ヘッダーのワードマーク＋接続ピル、`GuildStatsCard`（この30日の再生 = /history-stats）、`ScrollRow`（横スクロール行の左右矢印。`scroll-snap` と `touch-action:pan-x` を撤去した理由もコメント）、`SectionAllDialog`（「すべて見る」）
- **教訓（好み）**: 装飾的コピー・セリフ見出し・くすんだ配色は避ける。機能改善を優先（memory/user_preferences.md）
- Before/After ギャラリー（不採用案の記録）: https://claude.ai/code/artifact/ee315839-8349-4a9c-9430-9550e024459d

### 2026-08-18: 再生履歴の SQLite 永続化 + 起動時 VC 自動復帰（commit bdadb627）
- `backend/app/db.py` に `play_history` テーブル（guild_id / video_id / url / title / artist / thumbnail / added_by_id,name,image / played_at）。同じ `uploaded_songs.db` ファイル内（Pi の `backend/` cwd）。WAL + busy_timeout=5000
- 記録タイミング: `MusicPlayer` の「再生開始」直後（`_record_play_history`、`asyncio.to_thread`、失敗しても再生継続）
- API: `GET /history/{guild_id}?limit=50&user_id=`（古い→新しい順、frontend が reverse）、`GET /history-stats/{guild_id}?days=30&top=10`（total_plays / top_tracks / top_users）。`Track.played_at` 追加
- メモリの `player.history` deque は previous() 用に残している（UI からは未使用）
- **バックアップ**: Pi の cron `30 4 * * * ~/backups/backup_irina_db.sh`（`sqlite3.Connection.backup`、14日保持、`~/backups/irina-YYYY-MM-DD.db`）
- **起動時 VC 自動復帰**: `bot.py` `_rejoin_occupied_voice_channels()` — on_ready の3秒後、人がいる VC へ接続して MusicPlayer 作成。deploy 直後に「Rejoined voice channel ... on startup」がログに出れば OK。これで deploy 中に人がいても bot が戻る（再生中の曲は止まるので predeploy_check は引き続き必要）
- 検証: live-playback-test 14/14（履歴3件含む）、smoke_test に /history /history-stats 追加

### 2026-08-17: リアルタイム同期の修正（commit 94044cf8 + 69878ae6）
- **根本原因1**: `bot.py` の `notify_clients_local` が **no-op** だった。自動参加やスラッシュコマンドで作られた MusicPlayer（通常の利用経路）からはブラウザへ WebSocket 更新が一切飛んでいなかった → `register_notify_clients()` で main.py の `notify_clients` を登録して委譲
- **根本原因2**: frontend の version 比較がサーバー再起動・ギルド切替の巻き戻りを考慮しておらず、deploy のたびに更新を全部無視 → MusicPlayer ごとの `state_epoch`（uuid）を送り、epoch が変わったら version リセット
- 追加: `GET /player-state/{guild_id}`（WS update と同形）、WS で `{"type":"ping"}`→`pong`、`{"type":"sync"}`→状態再送。`build_player_state()` が WS/REST 共通
- frontend `WSConnection`: 無制限再接続（上限15s/非表示時60s）、75秒無応答で張り直し、25秒ごと ping、`visibilitychange/online/focus/pageshow` で即再接続 or sync。store は WS 断中 10 秒ごと `/player-state` ポーリング。エラートースト廃止、ヘッダーに「同期中…/再接続中…」
- **検証**: `node scripts/realtime-sync-test.mjs`（Playwright routeWebSocket で epoch/version/再接続/REST フォールバック 14 ケース）。本番 WS は `wss://api.atoriba.jp/ws/{guild}` に Node の WebSocket で接続し update/pong/sync/30秒ping を確認済み
- **事故**: 94044cf8 の編集で 7 ルート（upload-audio*, set-volume, bot-guilds, disconnect-voice-channel）を巻き込み削除 → 69878ae6 で復元。以後 `smoke_test.sh` が openapi.json でルート欠落を検知する
- 依存更新: backend は yt-dlp 2026.7.4 / fastapi 0.141 / starlette 1.6 / uvicorn 0.52 / aiohttp 3.14 / davey 0.1.6（openai, google-genai の major は保留）。frontend は semver 内 `bun update`（next 16.3.1 等）+ `middleware.ts`→`proxy.ts`
- 実再生テスト（テストサーバー）: join→add-url→add-url→pause→resume→skip→/player-state整合→disconnect の 11 ケース全 OK。曲追加から再生開始まで 7〜15 秒（yt-dlp 抽出+DL）かかるので `is_loading`（`MusicPlayer.is_preparing`）を状態に追加し、再生ボタン/ミニプレイヤーにスピナー表示（commit 807a00bb）

### 2026-08-17: レスポンシブ再設計（commit 5cfd9d54）
- **デスクトップ（lg=1024px以上）**: 右カラムに Now Playing パネルを常時ドッキング（`.now-playing-aside`）。ミニプレイヤー/フルスクリーンプレイヤーは出さない。`MainPlayer variant="docked"`
- **モバイル/タブレット**: 従来どおりミニプレイヤー→フルスクリーン（`variant="sheet"`）。シートは**常時マウント + translateY 切替**（AnimatePresence の exit 待ちで白いラッパーが残るバグがあったため）。横向きスマホは `.player-sheet-body` の media query で2カラム
- Header 中央に接続先（サーバー名/VC名/接続状態ドット）を常設。`useGuildStore` から取得、クリックでサイドメニュー
- 判定は `useIsDesktop()`（`src/hooks/use-media-query.ts`, `useSyncExternalStore`, SSR は false）
- SearchResults は `fixed` → main カラム内 `absolute inset-0 z-30`。ミニプレイヤー分の下余白は main の CSS 変数 `--bottom-inset` で共有
- **レイアウト検証手順**: `cd frontend && NEXT_PUBLIC_API_URL=https://api.atoriba.jp bun run dev` → `node scripts/preview-screenshots.mjs` → `scripts/screenshots/*.png`（6ビューポート、横スクロール/console error を自動判定）。`/dev-preview` はモックセッションで MainApp を表示（開発時のみ。middleware の `authorized` で許可、本番は `notFound()`）。API/WS は Playwright の route モック
- **注意**: Turbopack の永続キャッシュ（`.next/cache`, `.next/dev`）で globals.css の変更が反映されないことがあった。CSS が古いと感じたら `rm -rf .next/cache .next/dev` して dev 再起動
- `playwright` は frontend の devDependency（スクリプトは `createRequire` で frontend 側を解決）

### 2026-08-17: デバイスモード（ブラウザ再生）を削除（commit 711ed26e）
- ユーザー要望により「デバイスモード」を全削除。Header のトグル、store の `isOnDeviceMode`/`deviceQueue`/`deviceCurrentTrack`/`audioRef`/`volume`/`currentTime`/`duration`、MainApp の `<audio>` 要素、MainPlayer のシーク/音量UI、各コンポーネントの `isOnDeviceMode` props
- backend の `GET /stream`（デバイスモード専用。未認証で任意URLを Pi にダウンロードするエンドポイント）も削除 → 404
- 残っているもの: backend `/set-volume` はサーバー側音量用で frontend `api.setVolume` から呼べるが UI からは未使用（契約棚卸し対象）
- 検証: `tsc --noEmit` / `bun run build` 通過、Vercel 本番 Ready、Pi 自動デプロイ成功、smoke_test 全 OK
- 注意: `bun run lint`（`next lint`）は Next.js のバージョン都合で以前から壊れている（今回の変更とは無関係）

### 2026-08-17: 自動デプロイが4ヶ月間動いていなかった（deploy.log 誤コミット）
- `deploy.log` が `.gitignore` にあるのに `3847ef9f`（2026-04-07）で誤ってコミットされていた
- Pi では `auto-deploy.sh` が常に deploy.log へ追記 → `git status --porcelain` が常に dirty → `deploy.sh` の「未コミット変更あり → skip」に毎回該当し、**pushしても本番に反映されない**状態だった
- 修正: `git rm --cached deploy.log`（commit `c6487ee`）。Pi 側は timer 停止 → `git checkout -- deploy.log` → `bash deploy.sh` → timer 再開で復旧。旧ログは `~/deploy.log.bak-20260817`
- **教訓**: `deploy.sh` の dirty 判定は untracked ファイルも含む。Pi のリポジトリ直下に一時ファイルを置かない（バックアップは `~` 直下へ）
- **手動デプロイの正しい手順**（timer と競合するので必ず停止してから）:
  ```bash
  ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13 "cd ~/discord-music-app && sudo systemctl stop discord-music-bot-deploy.timer && git status --porcelain && bash deploy.sh; sudo systemctl start discord-music-bot-deploy.timer"
  ```

### 2026-04-07: 音楽再生の yt-dlp フォールバック追加
- `backend/app/services/music_player.py` で `extract_info` 実行をリトライ可能に変更。
- 取得エラー `The page needs to be reloaded` / `Requested format is not available` が発生した場合、`bestaudio/best` と `best` の順でフォーマット候補を切り替え再試行するようにした。
- 再試行で成功した yt-dlp インスタンスを使って保存ファイル名を生成するようにし、`prepare_source` 側で再生ファイル参照不整合を防止した。

- 変更範囲は音楽再生処理のみで、チャット系プロンプトロジックには手を入れていない。

### 2026-04-07: voice join API の検証完了
- `POST /join-voice-channel/{guild_id}/{channel_id}` の不正入力を直接検証（`abc/xyz`）し、`400 Invalid guild_id or channel_id` を確認。
- `guild`/`channel` 未存在時のレスポンスを `404` に分岐。
- 非音声チャンネル時は `400 Only voice and stage voice channels are supported` を確認。
- `TIMEOUT` 発生時は `503` に変換される実装とログ `"[join] voice connect timeout"` を確認。
- CORS は `https://discord-music-app.vercel.app` + `https://api.atoriba.jp` + `^https://.*\.vercel\.app$` で許可され、CORS preflight と不正 origin の振る舞いを手動確認。

### 2026-04-07: Playwright / ブラウザ可視化手順の確立
- `scripts/open-vercel-browser.sh` を更新し、WSL2 の `DISPLAY` 自動探索と headed 起動の運用を整理。
- `npx playwright` での `Vercel` 実ページ確認（console/network）を日次チェック可能化。
- `browser_network_requests` で `/api/auth/session`, `/api/voice-channels` の 200/404 応答を現環境で確認。
- `Discord` ドメイン上で `api.atoriba.jp` への直接フェッチは CSP により阻害されるため、検証は `discord-music-app.vercel.app` 側で実施すべきと確認。

### yt-dlp Configuration (CRITICAL)
- **js_runtimes**: `{'node': {}, 'deno': {}}` を明示指定必須。デフォルトはdenoのみ。
- **Node.js 22以上が必要**（yt-dlp 2026.7+）: 20.x 以下は `verbose` で `node-20.x (unsupported)` と出て n challenge が解けず、cookie 使用時（web_creator client）は「Requested format is not available」で全滅する。cookie なし（tv client）は動くので気づきにくい
- **yt-dlp-ejs**: YouTube署名解読スクリプト。0.5.0以上が必要
- **format**: `bestaudio*/bestaudio/best`（`bestaudio/best/139`は一部環境でフォーマットが見つからない）
- **cookiefile**: YouTube Premium認証用。Pi上では絶対パスで指定
- **Pi上のyt-dlp更新手順（重要）**:
  1. ローカルでlockファイルを更新: `uv lock --upgrade-package yt-dlp --upgrade-package yt-dlp-ejs`
  2. コミット＆プッシュ
  3. Pi上でデプロイ: `bash deploy.sh`
  - **注意**: Pi上で `uv pip install` で直接更新しても、次の `deploy.sh`（内部で `uv sync`）でlockファイルのバージョンに戻される！必ずlockファイルも更新すること

### Discord.py Voice Connection
- **discord.py 2.7.x必須**: 2.6.xにはVoice endpointのポート443固定バグがある（PR #10210）
- **daveyライブラリ必須**: discord.py 2.7.xはPyNaClではなくdaveyが必要
- **Voice close code 4006/4017**: セッション競合（複数インスタンス）またはポート問題
- **Voice close code 1006**: 異常切断。ネットワーク一時障害で頻繁に発生する（1日2-5回程度）
- **Voice close code 1001**: Going Away。サーバー側のメンテナンス等
- **auto-join**: クールダウン30秒、最大3回失敗で5分停止。重複プレイヤー作成防止チェックあり
- **disconnect重複イベント**: `_voice_disconnect_processing` setで2秒間吸収

### Voice Reconnect Protection（2026-03-26追加）
- **問題**: Voice WebSocket切断時（code 1006等）、discord.pyがリコネクト中に `on_voice_state_update(after.channel=None)` が発火し、MusicPlayerがシャットダウンされてしまう
- **修正**: `bot.py` の `on_voice_state_update` で、`guild.voice_client` が存在する場合は5秒待ってリコネクト成功を確認してからシャットダウン判断
- **ログメッセージ**:
  - `"Voice reconnected successfully, keeping MusicPlayer alive"` → リコネクト成功、プレイヤー保持
  - `"Voice did not reconnect, shutting down MusicPlayer"` → 5秒待ってもリコネクトしなかった、正常シャットダウン
- **効果**: 修正前は毎回MusicPlayer破壊 → 修正後はリコネクト成功率100%（2週間で18/18回成功）

### Search API Null Safety（2026-03-26修正）
- **問題**: YouTube Music APIがプレイリストの `author` フィールドに `None` を返す場合がある。`dict.get('author', 'Unknown Author')` はキーが存在するが値がNoneの場合、デフォルト値ではなくNoneを返す
- **修正**: 全ての `artist`/`title`/`author` フィールドで `or` 演算子を使用
  - 修正前: `playlist.get('author', 'Unknown Author')` → Noneが返る場合あり
  - 修正後: `playlist.get('author') or 'Unknown Author'` → 必ず文字列が返る
- **該当箇所**: `main.py` の `search()` エンドポイント内、songs/videos/albums/artists/playlists の全SearchItem生成箇所

### MusicPlayer Management
- `/join-voice-channel`: 既存プレイヤーがあればvoice_client参照更新のみ。新規作成しない
- `on_voice_state_update`: `guild_id not in music_players` チェックで重複防止
- `history` deque: `maxlen=50` 設定済み

### State Management
- **Frontend**: Zustand for state management
- **WebSocket**: Real-time state sync with version-based conflict resolution
- **Optimistic Updates**: All player operations use optimistic updates with rollback
- **WS更新バッチ化**: 1回のsetState()で全フィールド更新（6回→1回に最適化済み）
- **デバウンス**: 150ms（50msから変更）

### Frontend Optimization (実施済み)
- Header, SideMenu, HomeScreen, MainPlayer: React.memo化
- SearchResultCard: React.memo化
- QueueTrackItem: インラインarrow関数排除（安定callbackパターン）
- categorizedResults: useMemo化
- ポーリング: 10秒→30秒、Page Visibility APIでタブ非表示時スキップ
- activeChannelId: ポーリングで強制上書きしない
- audio要素: 常時レンダリング（src制御、DOM破棄防止）
- QueueList: staggerChildrenアニメーション削除

### Feature Flags
- `src/lib/features.ts` - Feature toggles (e.g., VOICE_CHAT_ENABLED)

### API Endpoints
- `GET /` - ヘルスチェック
- （`GET /stream` は 2026-08-17 に削除済み）
- `GET /bot-guilds` - ボットが参加しているサーバー一覧
- `GET /voice-channels/{guild_id}` - ボイスチャンネル一覧
- `GET /bot-voice-status/{guild_id}` - ボットのVC接続状態
- `POST /join-voice-channel/{guild_id}/{channel_id}` - VC参加
- `POST /disconnect-voice-channel/{guild_id}` - VC切断
- `GET /search?query=...` - 楽曲検索
- `POST /add-url/{guild_id}` - 曲追加
- `GET /current-track/{guild_id}` - 現在再生中
- `GET /queue/{guild_id}` - キュー取得
- `POST /skip/{guild_id}` / `POST /pause/{guild_id}` / `POST /resume/{guild_id}`
- `GET /recommendations` - おすすめ
- `GET /related/{video_id}` - 関連曲
- `POST /chat` - AIチャット
- `GET /realtime-session` - リアルタイムセッション
- `WS /ws/{guild_id}` - WebSocket
- `GET /uploaded-audio-list/{guild_id}` - アップロード済みオーディオ一覧
- `GET /auto-connect-info/{guild_id}` - 自動接続情報
- `GET /playlist/{browse_id}` - プレイリスト曲一覧
- `GET /player-state/{guild_id}` - プレイヤー状態（WS update と同形）
- `GET /history/{guild_id}?limit=&user_id=` - 再生履歴（SQLite）
- `GET /history-stats/{guild_id}?days=&top=` - 再生統計

### Dead Code Removed (2026-03-04)
- `MainPlayerContext.tsx`, `PlaybackContext.tsx`, `VolumeContext.tsx`, `GuildContext.tsx` 削除
- `use-player.ts` フック削除（usePlayerStoreに統合済み）
- `api.ts` の `getServers()`, `setupWebSocket()` 削除（重複）
- `contexts/` ディレクトリ自体を削除

## Debugging Tips

### ログ調査の基本手順
```bash
# SSH接続
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13

# サービス状態確認
systemctl status discord-music-bot.service

# リアルタイムログ
journalctl -u discord-music-bot -f

# 過去ログ（24時間/7日/2週間）
journalctl -u discord-music-bot --since '24 hours ago' --no-pager
journalctl -u discord-music-bot --since '7 days ago' --no-pager

# エラーのみ抽出
journalctl -u discord-music-bot --since '24 hours ago' --no-pager | grep -E 'ERROR|500 Internal|WARNING'

# 重要イベント抽出（推奨）
journalctl -u discord-music-bot --since '7 days ago' --no-pager | grep -E 'Auto-joined|no users remaining|Could not connect|Disconnected from voice\.\.\.|500 Internal|page needs to be reloaded|yt-dlp.*ERROR|Started server process|keeping MusicPlayer|did not reconnect|asyncio:Task'

# 統計情報
journalctl -u discord-music-bot --since '7 days ago' --no-pager | grep -c 'ERROR'
```

### 既知の問題パターン
- **VC入退室ループ**: まず同じDISCORD_TOKENで別インスタンスが動いていないか確認
- **yt-dlp format error**: `verbose: True` でJS runtime状態を確認。`node (unavailable)` なら Node.js 20+をインストール
- **yt-dlp "The page needs to be reloaded"**: yt-dlpのバージョンが古い。lockファイルごと更新してデプロイ
- **WebSocket切断**: journalctlで `WebSocket disconnected` の頻度を確認。Cloudflare Tunnel経由だと正常
- **Piのログが出ない**: `PYTHONUNBUFFERED=1` がsystemdサービスに設定されているか確認
- **Playwright の headed 表示**: WSL2では`DISPLAY`未設定があるとブラウザが起動しない。`scripts/open-vercel-browser.sh` を使い、必要なら `DISPLAY="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf):0"` を設定。
- **Piサービス停止が遅い**: 大量のMusicPlayerが溜まってる証拠。`systemctl kill` で強制終了後 `start`
- **検索500エラー**: SearchItemのartist/titleがNoneになっていないか確認。`or`演算子でNullセーフに
- **push しても本番に反映されない**: Pi で `cd ~/discord-music-app && git status --porcelain` を確認。何か出ていれば deploy.sh が skip している（deploy.log 誤コミット事件参照）
- **ブラウザに再生状態が反映されない**: ①Pi の journal で `notify_clients failed` / `WebSocket通知エラー` を確認 ②ブラウザで `wss://api.atoriba.jp/ws/{guild}` に接続して update が来るか（Node: `new WebSocket(...)`）③ヘッダーのドットが黄色（再接続中）なら WS 断。`/player-state/{guild}` を直接叩いて backend 側の状態を見る
- **yt-dlp 更新後に「Requested format is not available」**: `verbose: True` で JS runtime が `(unsupported)` になっていないか確認。Node のバージョン要件が上がっていることが多い
- **/related が 500 / 検索が空 / アルバムが出ない**: ytmusicapi のバージョンと `YTMusic(language=...)` を確認。上流の応答変更が原因のことが多い。ローカル venv で新版を試してから lock 更新
- **Discord Gateway 520エラー**: Discord側のインフラ問題。指数バックオフで自動復旧する。コード対処不要
- **asyncio "Task was destroyed but it is pending"**: MusicPlayerのshutdown時に発生。動作に実害なし（クリーンアップの改善余地あり）

### Pi上のヘルスチェック
```bash
# API動作確認
curl -s http://localhost:8080/
# 検索テスト
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/search?query=YOASOBI"
# yt-dlpテスト
cd ~/discord-music-app/backend && .venv/bin/python -c "
import yt_dlp
ydl_opts = {'format': 'bestaudio*/bestaudio/best', 'cookiefile': '/home/als0028/discord-music-app/backend/cookies.txt', 'quiet': True, 'js_runtimes': {'node': {}, 'deno': {}}}
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info('https://www.youtube.com/watch?v=dQw4w9WgXcQ', download=False)
    print('Title:', info.get('title'))
    print('SUCCESS')
"
```

## Bug Fix History

### 2026-04-07: `/join-voice-channel` のタイムアウト例外を修正
- **原因**
  - 旧実装は `channel.connect()/move_to()` のタイムアウト（`TimeoutError`）を捕捉せず、`POST /join-voice-channel/{guild_id}/{channel_id}` が `500` を返していた。
- **対応**
  - `backend/app/main.py` の `/join-voice-channel` を再設計し、IDの型チェックを追加。
  - `asyncio.wait_for(..., timeout=15)` を接続/移動に適用し、`TimeoutError` を `503` に変換。
  - 無効IDは `400`、対象外チャンネル型は `400`、存在しない guild/channel は `404` に整理。
  - `guild.voice_client` が該当接続に失敗した場合は `disconnect()` を試行し、状態をクリーンアップ。
  - CORS を `allow_origin_regex: ^https://.*\.vercel\.app$` でプレビュー含め許可。

### 2026-03-26: 検索500エラー + Voice reconnect + yt-dlp更新
- **コミット**: `2e8b243f` (コード修正) + `95566639` (lockファイル更新)
- **修正1**: SearchItem pydantic validation error (artist=None) → `or`演算子でNullセーフに
- **修正2**: Voice切断時のMusicPlayer破壊 → 5秒待機してリコネクト確認ロジック追加
- **修正3**: yt-dlp 2026.3.3→2026.3.17, yt-dlp-ejs 0.5.0→0.8.0 に更新
- **効果**: 検索500エラー0件、Voiceリコネクト成功率100%（2週間で18/18回）

## MANDATORY: セッション終了時にこのファイルとmemoryディレクトリを必ず更新すること
- 上記の「MANDATORY」セクションを再読し、必ず更新を行うこと
- 新しいバグ修正、設定変更、デバッグパターン、バージョン変更を全て記録する
- 次のセッションで同じ会話を引き継げる粒度で書く
