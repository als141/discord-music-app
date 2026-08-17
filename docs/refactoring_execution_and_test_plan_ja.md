# イリーナ リファクタリング実行計画書 — テスト整備から本番検証まで

- **作成日**: 2026-07-19
- **対象**: discord-music-app（backend: FastAPI/discord.py on Raspberry Pi 4 / frontend: Next.js on Vercel）
- **位置づけ**: `discord_music_bot_repo_audit_and_refactor_plan_ja.md`（2026-04-06 監査書）の実行版。
  監査書が「何を・なぜ直すか」を定義するのに対し、本書は「**どの順番で・どうテストし・どう本番に出し・どう戻すか**」を定義する。
- **原則**: 本番は現在絶好調で稼働中（3週間以上連続稼働・7日間でERROR 1件）。**動いているものを壊さないことが最優先**。美しさより回帰防止。

---

## 0. 現状サマリ（2026-07-19 検証済み）

### 0.1 監査書P0課題の消化状況

| # | 課題 | 状態 | 根拠 |
|---|---|---|---|
| 1 | 検索 filter バグ | ✅ 修正済み | `main.py` `_build_search_items()` が全filter対応（commit `9551f91`） |
| 2 | `/join-voice-channel` 500エラー | ✅ 修正済み | 同上。400/404/503 に整理済み |
| 3 | `full_path`（サーバー絶対パス）露出 | ❌ 未対応 | `schemas.py:64` `SongResponse.full_path` |
| 4 | upload編集/削除の権限がclient申告`user_id`依存 | ❌ 未対応 | `main.py` edit/delete で `song.uploader_id != user_id` のみ |
| 5 | cookiesファイル情報のログ出力 | ❌ 未対応 | `music_player.py:78-139` |
| 6 | slash `/join` がMusicPlayerを毎回再生成 | ❌ 未対応 | `bot.py` `join_channel` で無条件 `music_players[guild_id] = MusicPlayer(...)` |
| 7 | API契約ずれ（realtime-session / set-volume / seek） | ⚠️ 未確認 | Phase 0 で棚卸しする |

### 0.2 本番インフラの実態（SSH検証済み）

| 項目 | 実態 | 影響 |
|---|---|---|
| 自動デプロイtimer | **10秒間隔**（`OnUnitActiveSec=10s`）。CLAUDE.mdの「2分ごと」は誤り | **mainにpushすると10秒以内に本番へ出る。** リファクタ中の最大リスク要因 |
| deploy.sh | `git reset --hard origin/main` + `uv sync --frozen` + service restart | mainへのマージ＝即本番デプロイ＋再起動（再生が途切れる） |
| YouTube cookies | 2026-03-26 作成、約4ヶ月更新なし | いつ失効してもおかしくない。再生障害時の第一容疑者 |
| yt-dlp | 2026.3.17（4ヶ月前） | 現在は正常。YouTube側変更で突然壊れる系 |
| 音楽キャッシュ | 1.1GB / 163ファイル、掃除機構なし | ディスク残9.9GB。中期課題 |
| テスト | **0本**。CI なし | 回帰検知手段が「本番で気づく」しかない |

### 0.3 コード規模（リファクタ対象の大物）

| ファイル | 行数 |
|---|---|
| `backend/app/main.py` | 1,211 |
| `backend/app/bot.py` | 1,182 |
| `backend/app/services/music_player.py` | 660 |
| `frontend/src/store/usePlayerStore.ts` | 842 |
| `frontend/src/components/MainPlayer.tsx` | 828 |

---

## 1. 進め方の大原則

1. **テストを先に、リファクタを後に。**
   現状テスト0本のままP0修正や分割を始めない。まず現在の挙動を固定する
   「特性テスト（characterization test）」を書き、緑を確認してから変更する。

2. **1デプロイ＝1関心事。**
   deploy.sh は restart を伴う（再生が一瞬切れる）。複数の変更を混ぜると
   障害時の切り分けができなくなる。P0修正も1件ずつ main にマージする。

3. **main は常にデプロイ可能。作業は必ずブランチで。**
   10秒timerがある限り、main への push は「本番リリースボタン」と同義。
   作業ブランチ → ローカルでテスト → main マージ、の順を厳守。
   ※ Phase 0-0 でtimer間隔を緩めるまでは特に注意。

4. **デプロイ後は必ずスモークテストで確認する。**
   本書 §6.2 のスモークスクリプトを毎回実行。「pushして終わり」を禁止する。

5. **本番hotfixは必ずGitへ戻す。**
   deploy.log の「Local ahead」状態を常態化させない（監査書 §11.1 と同旨）。

6. **利用時間帯を避ける。**
   イリーナは夜間（22時〜深夜）に実際に使われている。restart を伴うデプロイは
   **日中〜夕方**に行う。深夜メンテは「誰かが聴いている最中」の可能性が高い。

---

## 2. フェーズ全体像

| フェーズ | 内容 | 期間目安 | mainマージ回数目安 |
|---|---|---|---|
| **Phase 0-0** | デプロイ安全化（timer緩和・rollback手順整備） | 半日 | 1 |
| **Phase T** | テスト基盤構築 + 特性テスト | 2〜3日 | 1〜2 |
| **Phase 0** | P0ホットフィックス4件 + API契約棚卸し | 2〜3日 | 4〜6（1件ずつ） |
| **Phase 1** | backend構造リファクタ（Settings / PlayerManager / ルータ分割） | 1〜2週 | 5〜8 |
| **Phase 2** | Pi運用最適化（feature flag / cache掃除 / health拡張） | 1週 | 3〜5 |
| **Phase 3** | frontend contract-first化（OpenAPI型生成 / store分割） | 1〜2週 | 5〜8 |
| **Phase 4** | 依存更新の定常化（yt-dlp等） | 継続 | 随時 |

依存関係: Phase 0-0 → T → 0 は直列必須。Phase 1 以降は T の資産の上でしか行わない。

---

## 3. Phase 0-0: デプロイ安全化（最初にやる。コード変更より先）

リファクタ開始前に「事故ったときに戻れる」状態を作る。

### 3.1 デプロイtimerを10秒→2分に緩和

Pi 上で:

```bash
sudo tee /etc/systemd/system/discord-music-bot-deploy.timer > /dev/null <<'EOF'
[Unit]
Description=Check for Discord Music Bot updates every 2 minutes

[Timer]
OnBootSec=30
OnUnitActiveSec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl restart discord-music-bot-deploy.timer
systemctl list-timers | grep deploy   # 間隔確認
```

効果: GitHubへのfetchが1日8,640回→720回に減り、push後の「うっかり即デプロイ」猶予も生まれる。

### 3.2 ロールバック手順を確立（リハーサル必須）

**方式: revertコミット方式を正とする。**（mainがforce-push不要で履歴も残る）

```bash
# ローカル（WSL）側:
git revert <壊れたコミット> --no-edit
git push origin main
# → 2分以内にPiが自動で旧挙動に戻る
```

緊急時（Piを直接戻す。自動デプロイと競合するのでtimer停止を先に）:

```bash
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13
sudo systemctl stop discord-music-bot-deploy.timer
cd ~/discord-music-app && git reset --hard <直前の正常コミット>
cd backend && ~/.local/bin/uv sync --frozen
sudo systemctl restart discord-music-bot
# 復旧後、必ずGit側もrevertしてtimerを再開する
sudo systemctl start discord-music-bot-deploy.timer
```

**受け入れ条件**: ダミーコミット（README空行など）で「push→自動デプロイ→revert→自動巻き戻し」を1周リハーサルし、所要時間を計測して本書に追記する。

### 3.3 現在動作しているcommitの記録

デプロイの度に `deploy.sh` が動作commitを記録するようにする（Phase 2 で実装、それまでは手動メモ）。当面は障害時に `ssh ... "cd ~/discord-music-app && git log -1 --oneline"` で確認。

---

## 4. Phase T: テスト基盤構築

### 4.1 backend: pytest 導入

```bash
cd backend
uv add --dev pytest pytest-asyncio httpx
```

構成:

```
backend/
  tests/
    conftest.py          # FastAPI TestClient + Discord bot のフェイク
    test_search.py       # 検索契約テスト
    test_join_voice.py   # join-voice-channel 契約テスト
    test_upload_crud.py  # upload/edit/delete 契約テスト
    test_player_manager.py  # Phase 1 で追加
```

**方針:**
- Discordへの実接続はテストしない。`bot.py` の `client` / `guild` / `voice_client` は
  フェイク（`unittest.mock.MagicMock` + 必要なasyncメソッドのみ`AsyncMock`）に差し替える。
- YouTube/ytmusicapi への実リクエストもモックする。実APIを叩くテストは
  `@pytest.mark.external` を付け、CIでは除外・手動実行のみとする。
- SQLite はテスト用一時ファイル（`tmp_path` fixture）を使う。

### 4.2 最初に書く特性テスト（変更前の挙動固定）

監査書 §10.1 の8本を基礎に、**現状の挙動をそのまま**テストに写す。
「あるべき挙動」ではなく「今の挙動」を書くのがポイント（リファクタ後に差分が出たら気づくため）。

1. `/search?query=X&filter=songs|videos|albums|playlists|artists` — 各filterでSearchItemが返る・artist/titleがNoneにならない
2. `/join-voice-channel` — invalid ID→400 / 未存在→404 / 非voice→400 / timeout→503
3. `/uploaded-audio-list/{guild_id}` — 現状のレスポンス形（**full_path含む**。Phase 0-3 でこのテストを更新して削除を固定する）
4. `/uploaded-audio-edit` / `-delete` — uploader_id一致/不一致の403
5. `/queue/{guild_id}` / `/current-track/{guild_id}` — プレイヤー未存在時の挙動
6. `MusicPlayer` history/previous の遷移（可能な範囲でロジックだけ切り出してテスト）
7. `/` ヘルスチェック → `{"status":"ok"}`
8. CORS — vercel.appプレビューorigin許可 / 不正origin拒否

### 4.3 frontend: vitest 導入（Phase 3 の準備。Phase Tでは最小限）

```bash
cd frontend
bun add -d vitest @testing-library/react happy-dom
```

Phase Tでは `usePlayerStore` の `reorderQueue` / optimistic update rollback の2本だけ書く（Phase 3 の分割時に本格化）。

### 4.4 CI: GitHub Actions

`.github/workflows/test.yml` を新設。**mainへのpush＝本番デプロイ**なので、CIはマージ前のブランチで走らせる意味が大きい。

```yaml
name: test
on:
  push:
    branches-ignore: [main]
  pull_request:
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: cd backend && uv sync --frozen && uv run pytest -m "not external"
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: cd frontend && bun install && bun run build
```

**受け入れ条件**: 特性テスト8本が緑 / CIがブランチpushで走る / `pytest -m "not external"` がネット遮断環境でも通る。

---

## 5. Phase 0: P0ホットフィックス（1件ずつ、テスト→修正→デプロイ→検証）

各修正は共通フローで行う:

> ブランチ作成 → 期待挙動のテストを追加（この時点では赤） → 修正 → 全テスト緑 → mainマージ → 自動デプロイ(2分) → §6.2 スモーク実行 → journalctl 10分監視

### 0-1. slash `/join` の MusicPlayer 再生成を止める

- **変更**: `bot.py` `join_channel` を HTTP 側 `/join-voice-channel` と同じ「既存プレイヤーがあれば `voice_client` 参照更新のみ」に揃える。既存の分岐ロジックを関数に切り出して両者から呼ぶ（PlayerManager化はPhase 1。ここでは重複排除だけ）。
- **テスト**: join 2回連続で `music_players[guild_id]` が同一インスタンスのままであること。
- **本番検証**: Discordから `/join` を同一VCへ2回実行 → 再生継続・ログに `Task was destroyed` が増えないこと。
- **リスク**: 低。HTTP側で実績のあるロジックへの統一。

### 0-2. cookiesログ出力の削除

- **変更**: `music_player.py:78-139` のcookiesパス/内容ログを削除し、「cookies: loaded / not found」の存在有無のみINFOで残す。
- **テスト**: ログ出力のアサート（caplog fixture）。
- **本番検証**: 再起動後 `journalctl | grep -i cookie` でパスが出ないこと。**再生成功も確認**（cookiefile設定自体を壊していないか）。
- **リスク**: 低。ただしログ削除時にcookiefile設定行を巻き込まないよう注意。

### 0-3. `full_path` 露出の廃止

- **変更**:
  - `SongResponse` から `full_path` を削除（DB内部モデル `UploadedSong` には残してよい）。
  - upload成功レスポンスの `new_song` 素通し返却をやめ `SongResponse` に変換。
  - frontend側で `full_path` を参照している箇所を洗い出し（`grep -rn full_path frontend/src`）、`song.id` ベース（`/add-uploaded/{guild_id}/{song_id}` 等のopaque ID方式）へ置換。**backend/frontendの変更は同一コミットでマージ**（契約変更のため片方だけ先行させない）。
- **テスト**: uploaded-audio-list レスポンスに `full_path` キーが存在しないこと。アップロード曲のqueue追加が song.id 経由で成功すること。
- **本番検証**: Web UIからアップロード済み曲を再生できること。
- **リスク**: **中**。frontend連動必須。Vercelのデプロイとタイミング差が出るため、backend側は「旧パス受け付けも一時的に残す→次リリースで削除」の2段階も検討。

### 0-4. upload編集/削除の権限をサーバー側検証に変更

- **変更**: 現状Discord OAuth session（frontend `/api/auth/session`）があるため、backendへは署名付きの本人証明を渡す方式にする。最小実装として、frontendのAPI RouteでセッションからDiscord user_idを取り出しHMAC署名を付けてbackendへプロキシする（または既存の認証トークンをbackendで検証）。設計は着手時に `frontend/src/app/api/auth` の実装を確認して決定。
- **テスト**: 署名なし/不正署名で403、正当な本人のみ編集・削除可。
- **本番検証**: 自分の曲の編集・削除が通り、別アカウントからは403。
- **リスク**: 中。認証フローの確認が先。**Phase 0の中では最後に回してよい**。

### 0-5. API契約の棚卸し（realtime-session / set-volume / seek）

- `frontend/src/utils/api.ts` と `backend/app/main.py` の全エンドポイントを突き合わせ、メソッド/パス/ボディの不一致表を作る。
- 不一致は「backend実装に合わせる or 未使用なら両側から削除」で1件ずつ解消。
- 成果物: `docs/api_contract.md`（Phase 3 のOpenAPI型生成までの暫定truth）。

**Phase 0 受け入れ条件**（監査書 §8.1 と同一 + 追加）:
- [ ] upload一覧レスポンスに `full_path` が無い
- [ ] `/join` 連打でもプレイヤーが1個のまま
- [ ] ログにcookiesパスが残らない
- [ ] 編集/削除がclient申告user_idだけでは通らない
- [ ] 契約不一致表の全行がクローズ
- [ ] **全期間を通じ、本番の再生機能が停止しなかった**

---

## 6. 本番デプロイ・検証の標準手順

### 6.1 デプロイ前チェックリスト

- [ ] ブランチでCI緑（backend pytest + frontend build）
- [ ] 変更は1関心事のみか
- [ ] 時刻は日中〜夕方か（夜間の利用時間帯を避ける）
- [ ] 今誰か聴いていないか: `curl -s https://api.atoriba.jp/bot-voice-status/<主要guild_id>` で確認。再生中なら待つか、Discordで一声かける
- [ ] ロールバック対象commit（現在のmain HEAD）をメモしたか

### 6.2 デプロイ後スモークテスト（毎回実行）

`scripts/smoke_test.sh` として追加する:

```bash
#!/bin/bash
# 本番スモークテスト: デプロイ後に毎回実行する
set -e
API="https://api.atoriba.jp"
fail=0

check() {  # check <名前> <期待コード> <URL>
  code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "$3")
  if [ "$code" = "$2" ]; then echo "OK   $1 ($code)"; else echo "FAIL $1 (got $code, want $2)"; fail=1; fi
}

check "health"        200 "$API/"
check "bot-guilds"    200 "$API/bot-guilds"
check "search"        200 "$API/search?query=YOASOBI"
check "search filter" 200 "$API/search?query=YOASOBI&filter=songs"
check "recommendations" 200 "$API/recommendations"
check "frontend"      200 "https://discord-music-app.vercel.app/"

echo "---"
ssh -i ~/.ssh/id_rsa_pi als0028@192.168.11.13 \
  "systemctl is-active discord-music-bot && journalctl -u discord-music-bot --since '5 minutes ago' --no-pager | grep -cE 'ERROR|Traceback' || true"

[ $fail -eq 0 ] && echo "SMOKE TEST PASSED" || { echo "SMOKE TEST FAILED"; exit 1; }
```

### 6.3 デプロイ後の監視

- 直後10分: `journalctl -u discord-music-bot -f` を流し見（ERROR/Traceback/契約系400連発がないか)
- 翌日: `journalctl -u discord-music-bot --since '24 hours ago' --no-pager | grep -cE 'ERROR'` がベースライン（現状ほぼ0〜1/週）から増えていないか
- 実利用確認: 夜の利用後に再生・スキップ・キュー操作が普段どおりだったか（可能なら利用者に一言聞く）

### 6.4 ロールバック判断基準

以下のいずれかで**即revert**（調査はロールバック後）:
- スモークテスト失敗
- 再生開始が失敗する（`再生準備`→`再生開始` ログが出ない）
- Voice接続が確立しない
- ERROR頻度が明らかに増加（10分で3件以上など）

---

## 7. Phase 1: backend構造リファクタ

Phase T の特性テストが緑である状態を維持しながら、以下を**この順で**行う。
各ステップは独立してmainマージ＆デプロイする。

1. **`settings.py` 新設**（監査書 §9.1 の `BaseSettings` 案を採用）
   - `load_dotenv()` / `os.getenv()` 散在を `get_settings()` に集約
   - 特性テストに「settings優先順位」テストを追加してから移行
2. **`PlayerManager` 導入**（監査書 §9.2 案 + asyncio.Lock）
   - `music_players` dict 直接操作を全廃し、HTTP/slash/on_voice_state_update の3経路を統一
   - 単体テスト: get_or_create冪等性 / destroy時のshutdown呼び出し / 並行呼び出しで1個だけ生成
   - `Task was destroyed` 警告の解消をここで確認（shutdownでplayer_loopを正しくcancel＋await）
3. **`main.py` ルータ分割**: `api/voice.py` `api/queue.py` `api/search.py` `api/upload.py` へ。main.py は app factory + ルータ登録のみ（目標200行以下）
4. **`bot.py` 分割**: 音楽コア（events/slash音楽コマンド）と optional（generate_image / valorant / birthday）を分離
5. **`music_player.py` から source準備（yt-dlp呼び出し）を `services/source_resolver.py` に切り出し**
6. **`db.py` repository化**（Phase 3 のstore分割と対で効く）

**受け入れ条件**: 特性テスト全緑のまま / `main.py` ≤ 200行 / プレイヤー生成・破棄が `PlayerManager` の1箇所のみ / 7日間本番でERROR増なし・`Task was destroyed` 消滅。

---

## 8. Phase 2: Pi運用最適化

1. **feature flag**: `Settings` に `ENABLE_AI_CHAT` / `ENABLE_REALTIME` / `ENABLE_VALORANT` / `ENABLE_IMAGE_GEN` を追加し、OFFでルータ/コマンド自体を登録しない。**音楽コアのみで起動するプロファイルを作り、テストで担保**
2. **音楽キャッシュ掃除**: 起動時+日次で「最終アクセスからN日経過 or 総量上限超過分をLRU削除」するジョブ。アップロード曲ディレクトリは対象外にすること
3. **health拡張**: `/` に `commit_hash` / `discord_connected` / `active_players` / `disk_free_mb` を追加（スモークテストを拡張して活用）
4. **deploy.sh 改善**: デプロイ成功時に `deployed: <hash>` を deploy.log に記録 / restart前に `uv run pytest -m "not external" -q` を実行し、失敗したらrestartしない（Pi上での実行時間を計測し、遅すぎるなら契約テストのみのサブセットにする）
5. **CLAUDE.md / memory の記述を実態に合わせて更新**（timer間隔ほか）

---

## 9. Phase 3: frontend contract-first化

1. FastAPIの `openapi.json` から `openapi-typescript` で型生成し、`utils/api.ts` を生成型で包む（route driftを型エラー化）
2. `usePlayerStore.ts`（842行）を playback / queue / connection / ui にスライス分割。分割前に主要action（play/pause/skip/reorder/rollback）のvitestを書いて挙動固定
3. `MainPlayer.tsx`（828行）/ `HomeScreen.tsx`（773行）のコンポーネント分割
4. E2Eスモーク（Playwright、既存 `scripts/open-vercel-browser.sh` 資産を流用): ログイン→サーバー選択→検索→キュー追加 の1本だけ維持する（増やしすぎない）
5. dead code / `@ts-expect-error` 3件の解消

---

## 10. Phase 4: 依存更新の定常化

- **月次**: yt-dlp / yt-dlp-ejs を `uv lock --upgrade-package` で更新 → CI緑 → デプロイ → スモーク。壊れたらrevertで即戻す（この頻度なら破壊的変更に一度に当たる量が小さい)
- **cookies**: 再生エラー（403 / Sign in to confirm 系）が出たら最優先で更新。予防的にも2〜3ヶ月ごとに更新するのが安全
- discord.py / FastAPI / Next.js のメジャー更新は、Phase 1-3 完了後（テスト資産が揃ってから）のみ着手

---

## 11. リスク一覧と対応

| リスク | 発生局面 | 対策 |
|---|---|---|
| mainへの誤push即デプロイ | 全期間 | timer 2分化(§3.1) + ブランチ運用厳守 + revertリハーサル済み |
| 契約変更でfrontend/backendの片側だけ先行 | Phase 0-3, 3 | 同一コミットでマージ / 一時的な後方互換の維持 |
| リファクタでVoice再接続保護ロジック(2026-03-26修正)を壊す | Phase 1-2 | `on_voice_state_update` の5秒待機ロジックに特性テストを付けてから触る |
| デプロイrestartで利用中の再生が切れる | 全期間 | 利用時間帯回避 + bot-voice-statusで在室確認 |
| cookies失効とリファクタ起因障害の混同 | 全期間 | 障害時はまず `yt-dlp単体テスト`(CLAUDE.mdのヘルスチェック手順)で切り分け |
| Pi上のuv sync失敗（lockファイル不整合） | 依存変更時 | lockはローカルで更新しコミット（既知gotcha） / deploy.shは `--frozen` 維持 |

---

## 12. 完了の定義

- [ ] P0が全てクローズし、本番で7日間ERROR増なし
- [ ] backend: 契約テスト+単体テストがCIで常時実行されている
- [ ] frontend: 型生成でroute driftが検出できる
- [ ] 音楽コアのみで起動するプロファイルがある
- [ ] デプロイ→スモーク→ロールバックが文書化され、1回以上リハーサル済み
- [ ] CLAUDE.md / memory が実態と一致している
