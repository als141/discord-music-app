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
- **自動デプロイ**: 2分ごとにGitHubをチェック (`discord-music-bot-deploy.timer`)
- **手動デプロイ**: `cd ~/discord-music-app && bash deploy.sh`
- **コード場所**: `/home/als0028/discord-music-app/backend/`
- **環境変数**: `/home/als0028/discord-music-app/backend/.env`
- **Cookie**: `/home/als0028/discord-music-app/backend/cookies.txt`（2026-03-04作成、定期的な更新が必要な場合あり）
- **PYTHONUNBUFFERED=1**: systemdサービスに設定済み（ないとprint出力がjournalに出ない）
- **Node.js**: v20.20.0 (yt-dlpの署名解読に必須。v18はunsupported)
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
| Node.js | v20.20.0 | >= 20 |
| discord.py | 2.7.1 | >= 2.7.x |
| davey | 0.1.4 | 必須 |
| yt-dlp | 2026.3.17 | >= 2026.3 |
| yt-dlp-ejs | 0.8.0 | >= 0.5.0 |

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

### 2026-04-07: 音楽再生の yt-dlp フォールバック追加
- `backend/app/services/music_player.py` で `extract_info` 実行をリトライ可能に変更。
- 取得エラー `The page needs to be reloaded` / `Requested format is not available` が発生した場合、`bestaudio/best` と `best` の順でフォーマット候補を切り替え再試行するようにした。
- 再試行で成功した yt-dlp インスタンスを使って保存ファイル名を生成するようにし、`prepare_source` 側で再生ファイル参照不整合を防止した。

- 変更範囲は音楽再生処理のみで、チャット系プロンプトロジックには手を入れていない。

### yt-dlp Configuration (CRITICAL)
- **js_runtimes**: `{'node': {}, 'deno': {}}` を明示指定必須。デフォルトはdenoのみ。
- **Node.js 20以上が必要**: 18.xは `(unsupported)` と表示されて署名解読が動かない
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
- **Piサービス停止が遅い**: 大量のMusicPlayerが溜まってる証拠。`systemctl kill` で強制終了後 `start`
- **検索500エラー**: SearchItemのartist/titleがNoneになっていないか確認。`or`演算子でNullセーフに
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
