# app_logging.py
"""
ログシステム管理モジュール

アプリケーション全体の構造化ログシステムを提供します。
"""

import logging
import logging.handlers
import json
import sys
from typing import Optional, Dict, Any
from pathlib import Path
from datetime import datetime

from .config import get_settings

# 設定を取得
settings = get_settings()

class JsonFormatter(logging.Formatter):
    """JSON形式でログを出力するフォーマッター"""
    
    def format(self, record: logging.LogRecord) -> str:
        """ログレコードをJSON形式にフォーマット"""
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        # 例外情報がある場合は追加
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        
        # 追加の属性があれば含める
        if hasattr(record, 'extra_fields'):
            log_entry.update(record.extra_fields)
        
        return json.dumps(log_entry, ensure_ascii=False)

class ColoredFormatter(logging.Formatter):
    """コンソール出力用のカラーフォーマッター"""
    
    # ANSI カラーコード
    COLORS = {
        'DEBUG': '\033[36m',    # シアン
        'INFO': '\033[32m',     # 緑
        'WARNING': '\033[33m',  # 黄
        'ERROR': '\033[31m',    # 赤
        'CRITICAL': '\033[35m', # マゼンタ
        'RESET': '\033[0m'      # リセット
    }
    
    def format(self, record: logging.LogRecord) -> str:
        """カラー付きでログをフォーマット"""
        color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']
        
        # レベル名にカラーを適用
        record.levelname = f"{color}{record.levelname}{reset}"
        
        return super().format(record)

def setup_logger(
    name: str,
    level: Optional[str] = None,
    extra_fields: Optional[Dict[str, Any]] = None
) -> logging.Logger:
    """
    ロガーをセットアップする
    
    Args:
        name: ロガー名
        level: ログレベル（設定値を上書きする場合）
        extra_fields: ログに常に含める追加フィールド
    
    Returns:
        設定済みのロガー
    """
    logger = logging.getLogger(name)
    
    # 既にハンドラが設定されている場合はスキップ
    if logger.handlers:
        return logger
    
    # ログレベルを設定
    log_level = level or settings.logging.level
    logger.setLevel(getattr(logging, log_level.upper()))
    
    # ファイルハンドラの設定
    if settings.logging.file_enabled:
        # ディレクトリが存在しない場合は作成
        log_file_path = Path(settings.logging.file_path)
        log_file_path.parent.mkdir(parents=True, exist_ok=True)
        
        file_handler = logging.handlers.RotatingFileHandler(
            filename=settings.logging.file_path,
            maxBytes=settings.logging.file_max_size,
            backupCount=settings.logging.file_backup_count,
            encoding='utf-8'
        )
        
        # フォーマッターを設定
        if settings.logging.json_format:
            file_formatter = JsonFormatter()
        else:
            file_formatter = logging.Formatter(settings.logging.format)
        
        file_handler.setFormatter(file_formatter)
        file_handler.setLevel(getattr(logging, log_level.upper()))
        logger.addHandler(file_handler)
    
    # コンソールハンドラの設定
    if settings.logging.console_enabled:
        console_handler = logging.StreamHandler(sys.stdout)
        
        # 開発環境ではカラー出力、本番環境では通常出力
        if settings.debug:
            console_formatter = ColoredFormatter(settings.logging.format)
        else:
            console_formatter = logging.Formatter(settings.logging.format)
        
        console_handler.setFormatter(console_formatter)
        console_handler.setLevel(getattr(logging, log_level.upper()))
        logger.addHandler(console_handler)
    
    # 追加フィールドがある場合は設定
    if extra_fields:
        logger = LoggerAdapter(logger, extra_fields)
    
    return logger

class LoggerAdapter(logging.LoggerAdapter):
    """追加フィールドを持つロガーアダプター"""
    
    def process(self, msg, kwargs):
        """ログメッセージに追加フィールドを含める"""
        if 'extra' not in kwargs:
            kwargs['extra'] = {}
        kwargs['extra']['extra_fields'] = self.extra
        return msg, kwargs

def setup_third_party_loggers():
    """サードパーティライブラリのログレベルを設定"""
    
    # Discord.pyのログレベル
    discord_logger = logging.getLogger('discord')
    discord_logger.setLevel(getattr(logging, settings.logging.discord_level.upper()))
    
    # yt-dlpのログレベル
    ytdl_logger = logging.getLogger('yt_dlp')
    ytdl_logger.setLevel(getattr(logging, settings.logging.ytdl_level.upper()))
    
    # その他のライブラリのログレベル設定
    noisy_loggers = [
        'urllib3.connectionpool',
        'asyncio',
        'aiohttp.access',
    ]
    
    for logger_name in noisy_loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.WARNING)

def init_logging():
    """
    ログシステムを初期化する
    
    アプリケーション起動時に一度だけ呼び出す
    """
    # ルートロガーの設定をクリア
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # サードパーティライブラリのログ設定
    setup_third_party_loggers()
    
    # メインアプリケーションロガーを作成
    app_logger = setup_logger('app')
    
    # 初期化完了ログ
    app_logger.info(
        "ログシステムが初期化されました",
        extra={
            'log_level': settings.logging.level,
            'file_enabled': settings.logging.file_enabled,
            'console_enabled': settings.logging.console_enabled,
            'json_format': settings.logging.json_format
        }
    )
    
    return app_logger

def get_logger(name: str) -> logging.Logger:
    """
    指定された名前のロガーを取得する
    
    Args:
        name: ロガー名（通常は __name__ を使用）
    
    Returns:
        設定済みのロガー
    """
    return setup_logger(name)

# 便利な関数
def log_function_call(logger: logging.Logger):
    """関数呼び出しをログに記録するデコレータ"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            logger.debug(f"関数 {func.__name__} が呼び出されました", extra={
                'function': func.__name__,
                'args_count': len(args),
                'kwargs_keys': list(kwargs.keys())
            })
            try:
                result = func(*args, **kwargs)
                logger.debug(f"関数 {func.__name__} が正常に完了しました")
                return result
            except Exception as e:
                logger.error(f"関数 {func.__name__} でエラーが発生しました: {e}", exc_info=True)
                raise
        return wrapper
    return decorator

def log_performance(logger: logging.Logger, operation: str):
    """処理時間を測定してログに記録するコンテキストマネージャ"""
    import time
    
    class PerformanceLogger:
        def __init__(self, logger, operation):
            self.logger = logger
            self.operation = operation
            self.start_time = None
        
        def __enter__(self):
            self.start_time = time.time()
            self.logger.debug(f"{self.operation} を開始しました")
            return self
        
        def __exit__(self, exc_type, exc_val, exc_tb):
            duration = time.time() - self.start_time
            if exc_type is None:
                self.logger.info(f"{self.operation} が完了しました", extra={
                    'operation': self.operation,
                    'duration_seconds': round(duration, 3)
                })
            else:
                self.logger.error(f"{self.operation} でエラーが発生しました", extra={
                    'operation': self.operation,
                    'duration_seconds': round(duration, 3),
                    'error_type': exc_type.__name__
                })
    
    return PerformanceLogger(logger, operation)

# アプリケーション起動時にログシステムを初期化
if __name__ != "__main__":
    # モジュールがインポートされた時点では初期化しない
    # 代わりに明示的にinit_logging()を呼び出す
    pass

if __name__ == "__main__":
    # テスト実行
    app_logger = init_logging()
    test_logger = get_logger(__name__)
    
    test_logger.debug("これはデバッグメッセージです")
    test_logger.info("これは情報メッセージです")
    test_logger.warning("これは警告メッセージです")
    test_logger.error("これはエラーメッセージです")
    
    print("ログテストが完了しました")
