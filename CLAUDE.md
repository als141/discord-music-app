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
- **サービス（2026-09-21 からプロセス分割）**:
  - `discord-music-bot.service` = **voice プロセス**（`IRINA_ROLE=voice`, Discord bot + MusicPlayer, 内部 `127.0.0.1:8081`）。ドロップイン `/etc/systemd/system/discord-music-bot.service.d/role.conf`（ExecStart 上書き）と `killmode.conf`（KillMode=mixed）
  - `discord-music-web.service` = **web プロセス**（`IRINA_ROLE=web`, 公開 API `0.0.0.0:8080` ← Cloudflare Tunnel）。bot は起動せず、bot 依存ルート21本と `/ws/{guild}` を voice へ中継（`backend/app/api/voice_proxy.py`）
  - どちらも同じ `app.main:app`。ローカル開発は `IRINA_ROLE` 未設定＝`all`（従来の1プロセス）
- **ログ確認**: `journalctl -u discord-music-bot -f`（音声）/ `journalctl -u discord-music-web -f`（API）/ 両方 `journalctl -u discord-music-bot -u discord-music-web -f`
- **過去ログ**: `journalctl -u discord-music-bot --since '24 hours ago' --no-pager`
- **デプロイログ**: `~/discord-music-app/deploy.log`
- **自動デプロイ**: **10秒ごと**にGitHubをチェック (`discord-music-bot-deploy.timer`, `OnUnitActiveSec=10s`)。mainへのpush＝即本番デプロイ。**どのプロセスを再起動するかは `deploy.sh` が変更ファイルで判定**:
  - `backend/app/bot.py` / `services/**` / `db.py` / `config.py` / `logging.py` / `api/voice.py` / `__init__.py` / `pyproject.toml` / `uv.lock` に当たる → **voice + web を再起動**（数秒無音 → レジューム①で同じ位置から再開）
  - それ以外の `backend/` 変更（main.py の検索/おすすめ/履歴、api/chat 等）→ **web だけ再起動**（音楽は止まらない）
  - 例外: コミットメッセージに `[restart-voice]` を含めると voice も再起動（lifespan や main.py の配線を変えた時に使う）
  - `backend/` 以外の変更 → pull のみ（auto-deploy.sh）
- **デプロイ前チェック（voice 再起動を伴う変更のとき）**: `bash scripts/predeploy_check.sh` — 誰かが再生中（has_player=true のギルドあり）なら push を待つ（レジュームで復帰はするが数秒切れる）。web だけの変更なら不要
- **本番スモークテスト**: `bash scripts/smoke_test.sh`（デプロイ後に毎回実行。全主要API+ルート欠落+Piのエラーログを確認）
- **同時追加テスト（テストサーバー限定）**: `node scripts/concurrent-add-test.mjs`
- **実再生テスト（テストサーバー限定）**: `node scripts/live-playback-test.mjs` — bot を テストサーバー(1080511818658762752)/VC 一般 に入れて add-url/pause/resume/skip/disconnect を REST で叩き、WS 更新を検証。人がいるサーバーでは絶対に実行しない
- **レジューム実機テスト（テストサーバー限定）**: `bash scripts/resume-test.sh` — join→2曲追加→40秒再生→Pi で `sudo systemctl restart discord-music-bot`→再join で「保存済みキューを復元」「再生位置レジューム (40±秒)」→状態一致→disconnect で `player_state` 行が消えることまで 7 ケース。**bot を再起動するので人が再生中なら回さない**。2026-09-21 に 7/7
- **リアルタイム同期のブラウザテスト**: `node scripts/realtime-sync-test.mjs`（dev サーバー必要。Playwright で WS を偽装、14 ケース）
- **Pi を触るテストの前に**: `ListAgents` で同じリポを触っている別 Claude セッション（例: "Irina Discord bot の動作確認"）が busy でないか確認し、居れば `SendMessage` で restart / テストサーバー操作を止めてもらう。2026-09-21 に別セッションの restart 2回と join/disconnect が混入して resume-test が 5/7 に壊れた。誰が restart したかは Pi の `journalctl _COMM=sudo --since '30 min ago'` で分かる
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
| yt-dlp | 2026.8.19（2026-09-09更新） | 最新追従（403が出たら更新） |
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

### 2026-09-21: プロセス分割（無停止アップデート②、commit 04f47d7c）
- **構成**: 同じ `app.main:app` を `IRINA_ROLE` で2つ起動。**voice**（`discord-music-bot.service`, 127.0.0.1:8081）= Discord bot + MusicPlayer + `backend/app/api/voice.py` の21ルート+`/ws`。**web**（`discord-music-web.service`, 0.0.0.0:8080 ← Cloudflare）= 検索/おすすめ/履歴/アップロード等 + `api/voice_proxy.py` が voice ルーターから自動生成した中継ルート（HTTP は aiohttp で素通し、WS は双方向ポンプ）。`all`（既定）= 従来の1プロセス（ローカル `uv run uvicorn app.main:app` はこれ）
- **voice に新しいルートを足すとき**: `api/voice.py` の `router` に足すだけ。web 側の中継は `build_proxy_router()` が openapi ごと自動追加（smoke_test のルート欠落検知もそのまま効く）
- **voice 停止中の挙動**: 中継ルートは `503 {"detail":"音声サービスに接続できません…"}`、`/ws` は code 1011 で閉じる（frontend は自動再接続）、`/` は `"voice":"down"`。検索等の web ルートは生きている
- **deploy.sh の再起動判定**: 上の Infrastructure 節を参照（voice パターン一致 or `[restart-voice]` で voice も再起動、それ以外は web のみ）。`discord-music-web` が無い環境では従来どおり bot だけ再起動（後方互換）
- **Pi 上の repo 外ファイル**: `/etc/systemd/system/discord-music-web.service`、`/etc/systemd/system/discord-music-bot.service.d/role.conf`（`Environment=IRINA_ROLE=voice` + `ExecStart=` 上書きで 127.0.0.1:8081）、同 `killmode.conf`。Pi を作り直すときは手で入れる（内容はこの節と `deploy.sh` から復元可能）
- **切替手順（実施済み）**: timer 停止 → push → Pi で `git reset --hard origin/main` + `uv sync --frozen` → ユニット導入 + `daemon-reload` + `enable discord-music-web` → `restart discord-music-bot`（voice, 状態保存→復元）→ `start discord-music-web` → `curl localhost:8080/`=`{"role":"web","voice":"ok"}`, `localhost:8081/`=`{"role":"voice"}` → timer 再開
- **検証**: ローカル（テストbot を voice、web 別プロセス）で WS 中継 OK・live-playback 13/14（1件は yt-dlp のローカル速度によるタイミング）・voice kill → 503/1011/検索生存・復旧 OK。本番: smoke（`health voice` 含む）全 OK、`wss://api.atoriba.jp/ws/…` で update/pong、`resume-test.sh` 7/7（voice 再起動を web が中継したまま復元）
- **無停止デプロイの実測（2026-09-21）**: テストサーバーで再生中に main.py のコメントだけ変えて push → deploy.log `Restarting: discord-music-web (voice restart needed: 0)`、voice の MainPID 495985 → 495985（不変）、web 495722 → 496288、`/player-state` は `夜に駆ける|True|v0|32e6da` のまま（epoch も不変＝プレイヤーそのもの）。**音楽は一切止まらなかった**
- **診断**: `curl https://api.atoriba.jp/` の `voice` が `down` なら voice プロセス停止（`journalctl -u discord-music-bot`）。web が落ちていれば Cloudflare 経由が全部 502/530（`journalctl -u discord-music-web`）。両方のログを一度に: `journalctl -u discord-music-bot -u discord-music-web -f`
- **ローカルで分割構成を再現**: `cd backend; set -a; . ./.env; set +a; DISCORD_TOKEN="$TEST_DISCORD_TOKEN" IRINA_ROLE=voice .venv/bin/python -m uvicorn app.main:app --port 8081` と `IRINA_ROLE=web IRINA_VOICE_UPSTREAM=http://127.0.0.1:8081 .venv/bin/python -m uvicorn app.main:app --port 8080` → `API_BASE=http://127.0.0.1:8080 node scripts/live-playback-test.mjs`（テストbot「０才児」がテストサーバーの VC に入る）

### 2026-09-21: デプロイ跨ぎのレジューム（無停止アップデート①、commits 5951df3〜cb71a80 系）
- **目的**: backend の push（=bot再起動）でキュー・再生中の曲が消えていた → 「数秒無音のあと同じ曲の同じ位置から自動再開」に。Discord は 1トークン=1ボイス接続なので Web 流のブルーグリーンは音声に使えない前提での最適解
- `db.py`: `player_state`（guild_id / state_json / updated_at）+ `save_player_state`/`load_player_state`(30分期限)/`clear_player_state`
- `MusicPlayer`: 位置トラッキング（`_elapsed_base`/`_play_started_at`/`current_position()`）、`snapshot_state`/`_save_state_sync`/`restore_saved_state`、30秒ごと定期保存。保存トリガ=再生開始・追加完了・pause/resume・remove・reorder・曲終了。再開は ffmpeg `-ss`（3秒未満は頭出しなし）。ログ「再生位置レジューム: <曲> (N秒から)」「保存済みキューを復元: N曲」
- 復元タイミング=起動時VC復帰/自動入室/手動join（新規プレイヤー作成時）。破棄=明示切断/全員退出。障害切断（did not reconnect）では保存を残す
- **落とし穴（修正済み）**: `systemctl restart` は既定 `KillMode=control-group` で ffmpeg 子まで即 SIGTERM → after コールバックが `play_next_song` を発火し current=None/pos=0 で保存し、レジュームが頭出しなしに劣化。対策 2 段: ①`play_next_song` は `shutdown_flag` 中は何もしない ②Pi の systemd ドロップイン `/etc/systemd/system/discord-music-bot.service.d/killmode.conf` に `KillMode=mixed` + `TimeoutStopSec=25`（SIGTERM を uvicorn 本体のみに送り、lifespan が live 状態を保存してから終了）。**この override は repo 外なので Pi 上にだけ存在する**
- 検証: テストサーバーで 再生→22秒→restart → スナップショット `current:夜に駆ける position:25.2 queue:[...]` → 再join で「25秒から」レジューム。smoke/live-playback/realtime 全 OK
- **追加修正 cd884b46（current 二重復元）**: このプレイヤーは `queue[0]` が再生中の曲そのもの（`play_next_song` で pop）なので、`snapshot_state()` の `queue` に current を含めると復元後に「夜に駆ける|夜に駆ける,アイドル」と二重になった。`rest = [s for s in self.queue if not s.pending and s is not self.current]` で除外。`scripts/resume-test.sh` を追加し 7/7 で確認（`保存済みキューを復元: 2曲 (先頭 夜に駆ける を 42秒から)` / `再生位置レジューム: 夜に駆ける (42秒から)`）
- 既知の無害な競合: 起動時VC復帰（on_ready+3秒）はテスト中の手動 join/disconnect より遅れて発火することがあり、人が居る VC に直後に再入室する（`Rejoined voice channel ... on startup (1 users present)`）。テストスクリプトは冒頭で disconnect するので実害なし

### 2026-09-21: Discord ログイン頻繁切れの修正（fbf5135f → 統合版 f6bfbbcd, frontend/Vercel 本番反映済み）
- **原因**: `frontend/src/lib/auth.ts` が Discord アクセストークン（約7日で失効）を初回保存のみで **リフレッシュしていなかった**。NextAuth セッション Cookie は生きていても Discord トークンだけ死に、`/api/discord/userGuilds` が 401 → サーバー一覧が壊れ「ログインが外れた」体験に
- **修正**: jwt コールバックで `expiresAt` を見て失効間近なら `refresh_token` で Discord トークンを黙って更新（`refreshDiscordToken`）。セッションを明示 90日 + `updateAge` 1日でローリング延長。Session/JWT 型に `refreshToken`/`expiresAt`/`error` 追加。refresh 失敗でも強制サインアウトしない
- 注意: `NEXTAUTH_SECRET` を rotate すると全 JWT 失効=全員ログアウトになる。Vercel env を変えないこと
- 未検証部分: 実トークン失効(7日)をまたぐ挙動は時間経過が要るため未実測。ビルド/型は通過、Vercel デプロイ success
- **統合版 f6bfbbcd（fbf5135f の上に、サブエージェント実装 f909898c をマージ）** — 原因は2つあり、fbf5135f は原因Bのみだった:
  - **原因A（セッション復帰不能）**: next-auth v4 のクライアントは `/api/auth/session` の取得が一度失敗すると `__NEXTAUTH._session=null` になり、以後 focus/refetchInterval のどちらでも取り直さない（`react/index.js` の `_getSession` が `_session===null` で早期 return）。オフライン・PWA 復帰で1回失敗しただけで IntroPage に落ちて戻らなかった → `src/hooks/use-session-guard.ts`（新規）: 一度 authenticated になった後に unauthenticated へ落ちたら `getSession()` を 1s/3s/8s で再試行、取れたら `nextauth.message` キーの合成 `StorageEvent` を dispatch して SessionProvider を復帰（同一タブでは storage イベントが飛ばない仕様の回避。**next-auth 内部実装依存**）。`MainApp` は `useSession()` → `useSessionGuard()` に置換し、`status==='recovering'` 中は「接続を確認しています...」。localStorage `irina.session.seen` で PWA 再起動直後の失敗も復帰対象。ログアウトボタンは `markExplicitSignOut()` で印を消してから `signOut()`
  - **原因B の罠**: App Router の route handler 内で `getServerSession` を呼ぶと jwt callback は走るが**更新後の JWT がレスポンス Cookie に書き戻されない**。Discord は refresh_token をローテーションするので、書き戻されないまま refresh すると「使用済み refresh_token を毎回使う」状態で恒久失敗する → `app/api/discord/userGuilds/route.ts` は `getToken({req, secret})`（読み取りのみ）にし、リフレッシュは `/api/auth/session` 経由だけで起こす。401 は `code: NO_SESSION | DISCORD_REAUTH_REQUIRED`、429 `RATE_LIMITED`、その他 502 `UPSTREAM_ERROR`（Discord の本文は返さない）
  - `store/useGuildStore.ts`: `fetchUserGuildsWithReauth()` — DISCORD_REAUTH_REQUIRED なら `getSession()` で refresh を促して**1回だけ**再試行、まだ 401 なら `needsReauth: true`。`SideMenu` はその時「再取得」ではなく「再ログイン」(`signIn('discord')`) を出す。`NO_SESSION` は即 needsReauth
  - `app/providers.tsx`: `<SessionProvider refetchInterval={30*60} refetchOnWindowFocus refetchWhenOffline={false}>`
  - `lib/auth.ts`: `refreshDiscordAccessToken()`（期限の24時間前で更新、失敗しても accessToken は消さず `error='RefreshAccessTokenError'`、本文はログに出さない）。`accessTokenExpires`（ms）が正だが、fbf5135f 期間に発行された JWT の `expiresAt`（秒）も `?? token.expiresAt*1000` で読む互換あり。maxAge は 90 日を維持
  - **Vercel env 確認済み（2026-09-21, `vercel env ls`）**: `NEXTAUTH_SECRET` / `DISCORD_CLIENT_SECRET` / `NEXTAUTH_URL` / `NEXT_PUBLIC_DISCORD_CLIENT_ID` は Development・Preview・Production 共通の1値（環境間の不一致なし）。`NEXTAUTH_URL=https://discord-music-app.vercel.app`（https なので `getToken` の Cookie 名 `__Secure-next-auth.session-token` と整合）
  - 本番確認: `curl https://discord-music-app.vercel.app/api/discord/userGuilds` → `{"code":"NO_SESSION","error":"ログインが必要です。"}`（新 route が生きている印）。ブラウザでの実確認（オフライン→復帰で IntroPage に落ちない / 401 時に「再ログイン」が出る）はユーザーの Discord ログインが必要で未実施
  - 既存ログイン中のユーザーは JWT に refresh_token が無い → 7日失効時に一度「再ログイン」を押してもらえば以後は自動リフレッシュに乗る
  - `src/utils/api.ts` の `api.getUserGuilds()` はどこからも呼ばれていないデッドコード（未削除）
  - **追加 75e999b2**: ①`refreshDiscordAccessTokenDeduped()` — 同じ refresh_token での同時リフレッシュを同一インスタンス内で1回にまとめ、直近60秒の結果を再利用（複数タブ/PWA の二重 refresh で後発が invalid_grant → 使用済み refresh_token が Cookie に残り以後更新不能＝数日後に再ログイン、を防ぐ）②`session.maxAge` 90日 → **1年** ③ユーザー実機: 修正前の JWT（refresh_token なし）の人は一度だけ「Discordの認証の有効期限が切れました → 再ログイン」が出る（2026-09-21 にオーナーで確認、再ログイン後はサーバー一覧 OK）。これは想定どおりの1回きりの移行
  - **実ブラウザ検証（2026-09-21 02:20、オーナーがログインした Chromium で実施・全 OK）**: `/api/auth/session` user あり error なし / `/api/discord/userGuilds` 200（47件）/ メイン画面表示・「再ログイン」「サーバーがありません」なし。`window.fetch` を差し替えて `/api/auth/session` だけ失敗させる → 「接続を確認しています...」（IntroPage に落ちない）→ 解除後 2 秒で復帰。16 秒失敗し続けて再試行を使い切っても、`online` イベントで 1 秒で復帰。検証スクリプトはスクラッチパッドの `verify-login3.cjs`（要点: CDP 9222 に `connectOverCDP`、Service Worker が fetch を握るので `page.route` では失敗を注入できず、`window.fetch` のモンキーパッチで注入する）
  - CDP オフライン emulation（`Network.emulateNetworkConditions offline`）では `navigator.onLine=false` になり `refetchWhenOffline={false}` で next-auth が再取得しないため、そもそも失敗しない（これも意図した保護）
  - **人のログインが要る検証のためのブラウザ**: `node scripts/open-login-browser.mjs` — WSLg 上に headed Chromium（プロフィール `.tmp/chrome-profile` 永続、CDP `http://127.0.0.1:9222`）。人がログインした後は Playwright の `chromium.connectOverCDP('http://127.0.0.1:9222')` で同じセッションを操作できる。Playwright の Chromium が無ければ `cd frontend && bunx playwright install chromium`

### テスト用 Discord bot（2026-09-21 追加）
- `backend/.env` に `TEST_DISCORD_TOKEN` / `TEST_DISCORD_APP_ID` / `TEST_GUILD_ID`(=テストサーバー 1080511818658762752) を追加。プロセス分割（無停止②）検証・ローカル開発で本番 bot と別トークンを使うため。**本番 systemd は今まで通り `DISCORD_TOKEN` を使用**（テストbotはまだコード側で未使用＝箱だけ用意）

### git push が "could not read Username for github" で失敗する時
- このマシンの WSL シェルで git push が資格情報を拾えず失敗することがある。`gh auth setup-git` 済みなので `git -c credential.helper='!gh auth git-credential' push origin main` で通る（gh は als141 でログイン済み）


### 2026-09-21: 自動入室が9/15から停止していた（ゾンビプレイヤー、commit 3768b34）
- **症状**: ドデカサーバーで 9/15 18:27 を最後に Auto-joined が出ない。`/player-state` は has_player=True なのに `/bot-voice-status` は channel_id=null（= VC に居ないのにプレイヤーだけ残存）
- **原因**: 9/15 23:39 の Discord 大規模障害（gateway 503 / ギルド同期 500 連発がログに残る）で、切断イベント（on_voice_state_update）が来ないまま VC 接続が消え、MusicPlayer が music_players に残留。自動入室ガード `guild_id not in music_players` に恒久的にブロックされた
- **修正**: 自動入室時に「voice_client が None なのにプレイヤーが残っている」場合はゾンビと判断して `shutdown()`→pop してから入室続行（`bot.py` "Cleaning up stale MusicPlayer before auto-join"）
- **診断コマンド**: has_player=True かつ channel_id=null のギルドがあればゾンビ。`curl /player-state/{gid}` と `/bot-voice-status/{gid}` を突き合わせる
- 備考: Web の手動参加（/join-voice-channel）は voice_client 参照を張り替えるためゾンビでも動く。壊れるのは自動入室だけなので気づきにくい
- 注意: `/player-state` 等を Python urllib（UAなし）で叩くと Cloudflare に 403 で弾かれる。検証は curl を使う

### 2026-09-09: 全曲ダウンロード403 → yt-dlp 2026.8.19 で復旧（commit 222bf9d）
- **症状**: 全ての新規ダウンロードが `unable to download video data: HTTP Error 403: Forbidden`（当日34件。それ以前の7日間は再生試行ゼロ＝発生時期は特定不能、キャッシュ済み曲は再生できていた）
- **切り分けの要点**:
  1. サービス再起動では直らない（新プロセスでも403）
  2. オプション（source_address / cookiefile 有無）も無関係
  3. **動画による**: HLS(m3u8) フォーマットに逃げられる動画（dQw4w9WgXcQ 等）は成功、直リンク https フォーマットしか無い動画（SX_ViT4Ra7k 等）は403 → YouTube の PO Token 必須化に旧 yt-dlp が非対応のパターン
- **修正**: `uv lock --upgrade-package yt-dlp --upgrade-package yt-dlp-ejs --upgrade-package bgutil-ytdlp-pot-provider` → yt-dlp 2026.7.4→**2026.8.19**、bgutil 1.3.1→**2.0.0**。Pi の隔離 venv（/tmp/ytnew）で失敗動画のダウンロード成功を確認してから lock 更新→push→自動デプロイ
- 新版は `bestaudio` として正しく音声フォーマット(251)を選ぶようになった（旧版は動画 HLS 96 を掴んでいた）
- 検証: 今日実際に失敗していた `5QpiAu-Ek4Q`（怪獣）をテストサーバーで実再生 → 再生開始 OK、smoke_test 全 OK
- **教訓**: 「HTTP Error 403 (download時)」= yt-dlp が古い兆候。一部の曲だけ鳴る（=キャッシュ or HLS）ので気づきにくい。まず Pi の隔離 venv で最新版を試す

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
- **cookies.txt は yt-dlp が毎回書き戻す**（`YoutubeDL.py` `if self.params.get('cookiefile') is not None: self.cookiejar.save()`）。Pi の `backend/cookies.txt` の mtime が常に最新なのはそのため。YouTube 側でセッションが回転（ブラウザで同じアカウントを使う等）すると first-party の `SID/HSID/SSID/APISID/SAPISID/LOGIN_INFO/__Secure-1P*` が応答で消され、ファイルが `__Secure-3P*` だけの「劣化状態」になる
- **2026-09-21 02:10 に解消**: ユーザーが再エクスポートした cookies.txt（17KB, SID/SAPISID/LOGIN_INFO 等フルセット、有効期限 2027-10）を Pi に導入。手順: `systemctl stop discord-music-bot` → 旧を `~/backups/cookies-degraded-2026-09-21.txt` に退避 → 新を `backend/cookies.txt` と `~/backups/cookies-2026-09-21.txt`（原本控え）に配置 → `start discord-music-bot` + `restart discord-music-web`（`ytmusic_personal` は起動時にしか作られない）。検証: 年齢制限動画 x8VYWazR5mE が simulate 成功、`/recommendations` が 5 セクション（おすすめ/新作/毎日のおすすめ/おすすめのアルバム/おすすめのミックス）に復活。**ローカルの `backend/cookies.txt`（3月・無効）はあえて更新していない**: 同じセッション cookie を Pi とローカルの2箇所で使うと互いに回転させて無効化し合うため。ローカル開発は cookie 無しで十分
- **劣化していた時の状態（記録）**: Pi の cookies.txt は 1549 バイトで `__Secure-3PSID/3PAPISID/3PSIDTS/3PSIDCC` 等 12 個のみ（3月の元エクスポートは 3064 バイト・22 個）。yt-dlp は未ログイン扱いになり、**年齢制限動画が「Sign in to confirm your age」で落ちる**（concurrent-add-test の x8VYWazR5mE で発覚）。3月の元ファイル（ローカル `backend/cookies.txt`, gitignore）を Pi で試すと `The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser` → 元も無効。**ブラウザから新規エクスポートが必要（ユーザー作業）**。`ytmusic_personal`（SAPISIDHASH は `__Secure-3PAPISID` でも作れる）は部分的に生きていて `/recommendations` は「おすすめ / 新作 / おすすめの話題の曲」の 3 セクション（劣化前は 7）
- **cookie 再エクスポート手順（yt-dlp 公式推奨）**: ①Chrome のシークレットウィンドウで youtube.com にログイン ②拡張「Get cookies.txt LOCALLY」で youtube.com の cookie を Netscape 形式でエクスポート ③**そのシークレットウィンドウを閉じる**（開いたままだとブラウザ側が回転させて Pi の分が無効になる） ④`scp -i ~/.ssh/id_rsa_pi cookies.txt als0028@192.168.11.13:~/discord-music-app/backend/cookies.txt` ⑤同じ内容を `~/backups/cookies-YYYY-MM-DD.txt` にも置く（yt-dlp の書き戻しで劣化した時に戻せるように） ⑥`sudo systemctl restart discord-music-bot`（ytmusic_personal は起動時にしか作られない。predeploy_check で再生中でないことを確認） ⑦検証: Pi で `.venv/bin/python -m yt_dlp --cookies ~/discord-music-app/backend/cookies.txt --js-runtimes node --js-runtimes deno --simulate 'https://www.youtube.com/watch?v=x8VYWazR5mE'` が WARNING なしで通り、`curl https://api.atoriba.jp/recommendations` のセクションが 7 に戻る
- **以後の運用で cookie を長持ちさせるコツ**: エクスポート元のブラウザセッションを使い続けない（yt-dlp 側だけが cookie を回転させれば長期間有効）。ローカル PC の普段使いの Chrome からのエクスポートは避ける
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
- **自動入室だけ効かない（手動参加は効く）**: ゾンビプレイヤーを疑う。`/player-state`=has_player:true かつ `/bot-voice-status`=null のギルドが該当（2026-09-21 事例。修正済みだが診断法として）
- **再起動後にレジュームが頭出しなし（0秒から）/ current が無い**: ①Pi の `/etc/systemd/system/discord-music-bot.service.d/killmode.conf`（KillMode=mixed）が残っているか `systemctl show discord-music-bot -p KillMode` で確認 ②journal の「Nギルドのプレイヤー状態を保存しました」の直後に after コールバックの保存が走っていないか（`_state_frozen` で防いでいる）③テスト中に別セッションが restart していないか `journalctl _COMM=sudo`
- **Web で「ログインが外れた」報告**: ①`/api/discord/userGuilds` の 401 の `code` を見る（NO_SESSION=Cookie なし / DISCORD_REAUTH_REQUIRED=Discord トークン失効） ②Vercel の Functions ログで `[auth] Discord token refresh failed with status` を探す ③`NEXTAUTH_SECRET` を変えていないか（変えると全員ログアウト）
- **ダウンロード時 HTTP Error 403: Forbidden**: yt-dlp が YouTube の PO Token 必須化に置いていかれた兆候（2026-09-09 事例）。キャッシュ済み・HLS 可の曲は鳴るので部分的に動いて見える。隔離 venv で最新版を試し、lock 更新でデプロイ
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
