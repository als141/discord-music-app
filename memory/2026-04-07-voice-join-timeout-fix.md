# 2026-04-07: Voice Join Timeout Fix Verification

## 概要
- 01:21 付近で `POST /join-voice-channel/{guild_id}/{channel_id}` が `500 Internal Server Error` になり、ログに `asyncio.exceptions.TimeoutError` が出ていた事象を追跡。

## 対応
- `/join-voice-channel` の入力値検証を追加（`guild_id`,`channel_id` を `int` 化）。
- `channel.connect()` / `voice_client.move_to()` を `asyncio.wait_for(..., timeout=15)` でガード。
- `TimeoutError` を `503` へ変換し、`guild.voice_client.disconnect()` を試行して不安定状態をクリーンアップ。
- `voice`/`stage_voice` 判定を追加し、非音声チャンネルは `400` を返却。
- CORS に `allow_origin_regex="^https://.*\.vercel\.app$"` を追加。

## 検証
- `python -m compileall backend/app/main.py` 実行
- `fastapi.testclient` による以下の直接検証:
  - 無効ID => `400` (`Invalid guild_id or channel_id`)
  - guild不在 => `404` (`Guild not found`)
  - channel不在 => `404` (`Channel not found`)
  - 非音声 => `400` (`Only voice and stage voice channels are supported`)
  - 正常 => `200` (`Joined voice channel`)
  - 接続タイムアウト => `503` (`Voice channel connection timed out...`)
- CORS ヘッダ確認:
  - `Origin: https://discord-music-app.vercel.app` => ACAO あり
  - `Origin: https://pr-123.discord-music-app.vercel.app` => ACAO あり

## 次アクション
- 変更後のコードを push 済みの運用ブランチに反映し、サービス再起動後にフロント側UIから同条件を再試行する。
