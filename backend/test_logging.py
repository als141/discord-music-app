# test_logging.py
"""
ログシステムの簡単なテスト
"""

import logging

# 基本的なログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger('test')

logger.info("ログテストを開始します")
logger.debug("これはデバッグメッセージです")
logger.info("これは情報メッセージです")
logger.warning("これは警告メッセージです")
logger.error("これはエラーメッセージです")

print("基本ログテストが完了しました")
