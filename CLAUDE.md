# Claude Code Memory - Discord Music App

## MANDATORY: セッション終了時にこのファイルとmemoryディレクトリを必ず更新すること
- 新しい知見、バグ修正、インフラ変更、設定変更があれば必ずCLAUDE.mdとmemory/配下を更新する
- 更新せずにセッションを終了してはいけない
- 特に: 依存関係の変更、デプロイ手順の変更、新しいデバッグパターンは必ず記録する

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
- **サービス**: `discord-music-bot.service` (systemd)
- **ログ**: `journalctl -u discord-music-bot -f`
- **デプロイログ**: `~/discord-music-app/deploy.log`
- **自動デプロイ**: 2分ごとにGitHubをチェック (`discord-music-bot-deploy.timer`)
- **手動デプロイ**: `cd ~/discord-music-app && bash deploy.sh`
- **コード場所**: `/home/als0028/discord-music-app/backend/`
- **環境変数**: `/home/als0028/discord-music-app/backend/.env`
- **Cookie**: `/home/als0028/discord-music-app/backend/cookies.txt`
- **PYTHONUNBUFFERED=1**: systemdサービスに設定済み（ないとprint出力がjournalに出ない）
- **Node.js**: v20.20.0 (yt-dlpの署名解読に必須。v18はunsupported)
- **UFW**: incoming UDP 50000-65535許可済み（Discord Voice用）

### Cloudflare Tunnel
- **URL**: `https://api.atoriba.jp` → Pi:8080
- **トンネル名**: `discord-music-api`
- **サービス**: `cloudflared.service` (systemd)
- **ドメイン**: `atoriba.jp` (お名前.com → Cloudflare NS)

### Frontend (Vercel)
- **URL**: `https://discord-music-app.vercel.app`
- **NEXT_PUBLIC_API_URL**: `https://api.atoriba.jp`

### Railway（削除済み）
- プロジェクト削除済み。RailwayはUDP非対応でDiscord Voice接続不可。
- 同じDISCORD_TOKENで2台同時稼働すると Voice close code 4006/4017 が発生する。

## Key Technical Notes

### yt-dlp Configuration (CRITICAL)
- **js_runtimes**: `{'node': {}, 'deno': {}}` を明示指定必須。デフォルトはdenoのみ。
- **Node.js 20以上が必要**: 18.xは `(unsupported)` と表示されて署名解読が動かない
- **yt-dlp-ejs**: YouTube署名解読スクリプト。0.5.0以上が必要
- **format**: `bestaudio*/bestaudio/best`（`bestaudio/best/139`は一部環境でフォーマットが見つからない）
- **cookiefile**: YouTube Premium認証用。Pi上では絶対パスで指定
- **Pi上のyt-dlp更新**: `uv pip install --python .venv/bin/python 'yt-dlp>=2026.3'` で直接venvに入れる

### Discord.py Voice Connection
- **discord.py 2.7.x必須**: 2.6.xにはVoice endpointのポート443固定バグがある（PR #10210）
- **daveyライブラリ必須**: discord.py 2.7.xはPyNaClではなくdaveyが必要
- **Voice close code 4006/4017**: セッション競合（複数インスタンス）またはポート問題
- **auto-join**: クールダウン30秒、最大3回失敗で5分停止。重複プレイヤー作成防止チェックあり
- **disconnect重複イベント**: `_voice_disconnect_processing` setで2秒間吸収

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

### Dead Code Removed (2026-03-04)
- `MainPlayerContext.tsx`, `PlaybackContext.tsx`, `VolumeContext.tsx`, `GuildContext.tsx` 削除
- `use-player.ts` フック削除（usePlayerStoreに統合済み）
- `api.ts` の `getServers()`, `setupWebSocket()` 削除（重複）
- `contexts/` ディレクトリ自体を削除

## Debugging Tips
- **VC入退室ループ**: まず同じDISCORD_TOKENで別インスタンスが動いていないか確認
- **yt-dlp format error**: `verbose: True` でJS runtime状態を確認。`node (unavailable)` なら Node.js 20+をインストール
- **WebSocket切断**: journalctlで `WebSocket disconnected` の頻度を確認。Cloudflare Tunnel経由だと正常
- **Piのログが出ない**: `PYTHONUNBUFFERED=1` がsystemdサービスに設定されているか確認
- **Piサービス停止が遅い**: 大量のMusicPlayerが溜まってる証拠。`systemctl kill` で強制終了後 `start`
