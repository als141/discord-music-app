# settings.py
"""
アプリケーション設定管理モジュール

全ての環境変数とアプリケーション設定を一元管理します。
"""

import os
from typing import Optional, List
from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings
from pathlib import Path

# .env ファイルの読み込み
load_dotenv()

class DiscordSettings(BaseSettings):
    """Discord関連の設定"""
    token: str = Field(..., env="DISCORD_TOKEN")
    allowed_channels: List[int] = Field(
        default=[1080511818658762755, 1156255909446680676],
        description="チャット機能を許可するチャンネルID"
    )

    model_config = {"env_prefix": "DISCORD_"}

class OpenAISettings(BaseSettings):
    """OpenAI関連の設定"""
    api_key: Optional[str] = Field(None, env="OPENAI_API_KEY")
    model_chat: str = Field("gpt-4o-mini", env="OPENAI_CHAT_MODEL")
    model_image: str = Field("gpt-image-1", env="OPENAI_IMAGE_MODEL")
    model_realtime: str = Field(
        "gpt-4o-mini-realtime-preview-2024-12-17",
        env="OPENAI_REALTIME_MODEL"
    )
    voice: str = Field("sage", env="OPENAI_VOICE")

    model_config = {"env_prefix": "OPENAI_"}

class XAISettings(BaseSettings):
    """X.AI (Grok) 関連の設定"""
    api_key: Optional[str] = Field(None, env="XAI_API_KEY")
    model: str = Field("grok-3-mini-latest", env="XAI_MODEL")
    base_url: str = Field("https://api.x.ai/v1", env="XAI_BASE_URL")

    model_config = {"env_prefix": "XAI_"}

class GeminiSettings(BaseSettings):
    """Gemini関連の設定"""
    api_key: Optional[str] = Field(None, env="GEMINI_API_KEY")

    model_config = {"env_prefix": "GEMINI_"}

class MusicSettings(BaseSettings):
    """音楽関連の設定"""
    directory: str = Field("music", env="MUSIC_DIR")
    oauth2_username: str = Field("oauth2", env="OAUTH2_USERNAME")
    oauth2_password: str = Field("", env="OAUTH2_PASSWORD")
    upload_directory: str = Field("uploaded_music", env="UPLOAD_DIR")
    
    # yt-dlp設定
    ytdl_format: str = Field("bestaudio", env="YTDL_FORMAT")
    ytdl_extract_flat: bool = Field(False, env="YTDL_EXTRACT_FLAT")
    
    model_config = {"env_prefix": "MUSIC_"}

class DatabaseSettings(BaseSettings):
    """データベース関連の設定"""
    name: str = Field("uploaded_songs.db", env="DB_NAME")
    
    model_config = {"env_prefix": "DB_"}

class ServerSettings(BaseSettings):
    """サーバー関連の設定"""
    host: str = Field("0.0.0.0", env="SERVER_HOST")
    port: int = Field(8000, env="SERVER_PORT")
    cors_origins: List[str] = Field(
        default=[
            "http://localhost:3000",
            "https://discord-music-app.vercel.app",
            "http://localhost:8000",
        ],
        env="CORS_ORIGINS"
    )
    
    model_config = {"env_prefix": "SERVER_"}

class CacheSettings(BaseSettings):
    """キャッシュ関連の設定"""
    recommendations_duration_hours: int = Field(3, env="CACHE_RECOMMENDATIONS_HOURS")
    player_cache_duration_minutes: int = Field(5, env="CACHE_PLAYER_MINUTES")
    
    model_config = {"env_prefix": "CACHE_"}

class LoggingSettings(BaseSettings):
    """ログ関連の設定"""
    level: str = Field("INFO", env="LOG_LEVEL")
    format: str = Field(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        env="LOG_FORMAT"
    )
    file_enabled: bool = Field(True, env="LOG_FILE_ENABLED")
    file_path: str = Field("logs/app.log", env="LOG_FILE_PATH")
    file_max_size: int = Field(10 * 1024 * 1024, env="LOG_FILE_MAX_SIZE")  # 10MB
    file_backup_count: int = Field(5, env="LOG_FILE_BACKUP_COUNT")
    console_enabled: bool = Field(True, env="LOG_CONSOLE_ENABLED")
    json_format: bool = Field(False, env="LOG_JSON_FORMAT")
    
    # 特定のロガーのレベル設定
    discord_level: str = Field("WARNING", env="LOG_DISCORD_LEVEL")
    ytdl_level: str = Field("ERROR", env="LOG_YTDL_LEVEL")
    
    model_config = {"env_prefix": "LOG_"}

class AppSettings(BaseSettings):
    """メインアプリケーション設定"""
    # 各種設定をまとめる
    discord: DiscordSettings = DiscordSettings()
    openai: OpenAISettings = OpenAISettings()
    xai: XAISettings = XAISettings()
    gemini: GeminiSettings = GeminiSettings()
    music: MusicSettings = MusicSettings()
    database: DatabaseSettings = DatabaseSettings()
    server: ServerSettings = ServerSettings()
    cache: CacheSettings = CacheSettings()
    logging: LoggingSettings = LoggingSettings()
    
    # アプリケーション共通設定
    debug: bool = Field(False, env="DEBUG")
    log_level: str = Field("INFO", env="LOG_LEVEL")  # 後方互換性のため残す
    
    # システムプロンプト
    system_prompt: Optional[str] = Field(None, env="PROMPT")
    voice_system_prompt: Optional[str] = Field(None, env="VOICE_SYSTEM")
    
    # 画像保存ディレクトリ
    image_directory: str = Field("saved_images", env="IMAGE_DIR")
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # ディレクトリが存在しない場合は作成
        self._ensure_directories()
    
    def _ensure_directories(self):
        """必要なディレクトリを作成"""
        directories = [
            self.music.directory,
            self.music.upload_directory,
            self.image_directory,
            Path(self.logging.file_path).parent,  # ログディレクトリ
        ]
        
        for directory in directories:
            Path(directory).mkdir(exist_ok=True, parents=True)
    
    @property
    def music_dir_path(self) -> Path:
        """音楽ディレクトリのPathオブジェクト"""
        return Path(self.music.directory)
    
    @property
    def upload_dir_path(self) -> Path:
        """アップロードディレクトリのPathオブジェクト"""
        return Path(self.music.upload_directory)
    
    @property
    def image_dir_path(self) -> Path:
        """画像ディレクトリのPathオブジェクト"""
        return Path(self.image_directory)
    
    @property
    def log_dir_path(self) -> Path:
        """ログディレクトリのPathオブジェクト"""
        return Path(self.logging.file_path).parent
    
    @property
    def db_path(self) -> Path:
        """データベースファイルのPath"""
        return Path(self.database.name)

# グローバル設定インスタンス
settings = AppSettings()

# 後方互換性のための定数（既存コードが動作するように）
DISCORD_TOKEN = settings.discord.token
OPENAI_API_KEY = settings.openai.api_key
XAI_API_KEY = settings.xai.api_key
GEMINI_API_KEY = settings.gemini.api_key
MUSIC_DIR = settings.music.directory
UPLOAD_DIR = settings.music.upload_directory
OAUTH2_USERNAME = settings.music.oauth2_username
OAUTH2_PASSWORD = settings.music.oauth2_password
PROMPT = settings.system_prompt
VOICE_SYSTEM = settings.voice_system_prompt
ALLOWED_CHANNELS = settings.discord.allowed_channels
IMAGE_DIR = settings.image_directory
DB_NAME = settings.database.name

def get_settings() -> AppSettings:
    """設定インスタンスを取得"""
    return settings

def validate_required_settings():
    """必須設定の検証"""
    errors = []
    
    if not settings.discord.token:
        errors.append("DISCORD_TOKEN is required")
    
    if not settings.xai.api_key:
        errors.append("XAI_API_KEY is required for chat functionality")
    
    if errors:
        raise ValueError("Missing required settings:\n" + "\n".join(f"- {error}" for error in errors))

def log_settings_summary():
    """設定の概要をログ出力（機密情報は除く）"""
    print("=== Application Settings Summary ===")
    print(f"Debug Mode: {settings.debug}")
    print(f"Log Level: {settings.log_level}")
    print(f"Music Directory: {settings.music.directory}")
    print(f"Upload Directory: {settings.music.upload_directory}")
    print(f"Image Directory: {settings.image_directory}")
    print(f"Database: {settings.database.name}")
    print(f"Server: {settings.server.host}:{settings.server.port}")
    print(f"OpenAI API: {'✓' if settings.openai.api_key else '✗'}")
    print(f"XAI API: {'✓' if settings.xai.api_key else '✗'}")
    print(f"Gemini API: {'✓' if settings.gemini.api_key else '✗'}")
    print("====================================")

# アプリケーション起動時の設定検証
if __name__ == "__main__":
    try:
        validate_required_settings()
        log_settings_summary()
        print("Settings validation passed!")
    except ValueError as e:
        print(f"Settings validation failed: {e}")
