# simple_logger.py
"""
シンプルなログシステム
"""

import logging
import sys
from pathlib import Path

def setup_simple_logger(name: str, level: str = "INFO") -> logging.Logger:
    """シンプルなロガーをセットアップする"""
    logger = logging.getLogger(name)
    
    if logger.handlers:
        return logger
    
    # コンソールハンドラ
    console_handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    logger.setLevel(getattr(logging, level.upper()))
    
    return logger

def get_logger(name: str) -> logging.Logger:
    """ロガーを取得する"""
    return setup_simple_logger(name)
