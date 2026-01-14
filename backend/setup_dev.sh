#!/bin/bash
# 開発環境セットアップスクリプト

set -e

echo "Setting up Discord Music App development environment..."

# システム依存関係のチェックとインストール指示
echo "1. Checking system dependencies..."

if ! command -v ffmpeg &> /dev/null; then
    echo "FFmpeg is not installed. Please install it:"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "  sudo apt update && sudo apt install ffmpeg"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  brew install ffmpeg"
    fi
    exit 1
fi

echo "✓ FFmpeg found"

# Python依存関係のインストール
echo "2. Installing Python dependencies..."
uv sync

echo "3. Checking dependencies..."
python check_dependencies.py

echo "✓ Development environment setup complete!"
echo "Run: python api.py"