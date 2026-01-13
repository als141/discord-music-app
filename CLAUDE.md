# Claude Code Memory - Discord Music App

## Project Overview
Discord音楽ボットアプリケーション。フロントエンド（Next.js）とバックエンド（FastAPI/Discord.py）で構成。

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

## Project Structure
```
discord-music-app/
├── frontend/          # Next.js フロントエンド
│   ├── src/
│   │   ├── components/
│   │   ├── store/     # Zustand stores
│   │   ├── utils/     # API client, WebSocket
│   │   └── lib/       # Feature flags
│   └── package.json
├── backend/           # FastAPI バックエンド
│   ├── app/
│   │   ├── main.py
│   │   ├── services/  # Music player, etc.
│   │   └── config.py
│   └── pyproject.toml
└── CLAUDE.md
```

## Key Technical Notes

### State Management
- **Frontend**: Zustand for state management
- **WebSocket**: Real-time state sync with version-based conflict resolution
- **Optimistic Updates**: All player operations use optimistic updates with rollback

### Feature Flags
- `src/lib/features.ts` - Feature toggles (e.g., VOICE_CHAT_ENABLED)

### API Endpoints
- `/bot-guilds` - Get servers where bot is installed
- `/voice-channels/{guild_id}` - Get voice channels for a server
- `/bot-voice-status/{guild_id}` - Get bot's current voice channel
- `/join-voice-channel/{guild_id}/{channel_id}` - Join voice channel
- `/disconnect-voice-channel/{guild_id}` - Disconnect from voice channel
- `/ws/{guild_id}` - WebSocket for real-time updates

## Important Reminders
- フロントエンドのビルドは必ず `bun` を使用すること
- バックエンドのパッケージ管理は必ず `uv` を使用すること
- `npm` や `pip` は使用しないこと
