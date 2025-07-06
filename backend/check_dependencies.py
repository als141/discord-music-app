#!/usr/bin/env python3
"""
システム依存関係チェックスクリプト
"""

import subprocess
import sys
from pathlib import Path

def check_ffmpeg():
    """FFmpegの存在をチェック"""
    try:
        result = subprocess.run(['ffmpeg', '-version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print("✓ FFmpeg found")
            return True
        else:
            print("✗ FFmpeg not working properly")
            return False
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print("✗ FFmpeg not found")
        print("  Please install FFmpeg:")
        print("  Ubuntu/Debian: sudo apt install ffmpeg")
        print("  macOS: brew install ffmpeg")
        return False

def check_python_dependencies():
    """Python依存関係をチェック"""
    try:
        import yt_dlp
        import discord
        import fastapi
        print("✓ Python dependencies found")
        return True
    except ImportError as e:
        print(f"✗ Missing Python dependency: {e}")
        print("  Run: uv sync")
        return False

def main():
    """依存関係チェックのメイン関数"""
    print("Checking system dependencies...")
    
    all_good = True
    
    # FFmpegチェック
    if not check_ffmpeg():
        all_good = False
    
    # Python依存関係チェック
    if not check_python_dependencies():
        all_good = False
    
    if all_good:
        print("\n✓ All dependencies are satisfied!")
        sys.exit(0)
    else:
        print("\n✗ Some dependencies are missing. Please install them before running the application.")
        sys.exit(1)

if __name__ == "__main__":
    main()