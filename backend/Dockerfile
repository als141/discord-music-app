# Dockerfile for Discord Music App Backend
# Cloud Run用に最適化

# ========================================
# Stage 1: Builder
# ========================================
FROM python:3.12-slim AS builder

# uvのインストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# 依存関係ファイルをコピー
COPY pyproject.toml uv.lock ./

# 仮想環境を作成し、依存関係をインストール
# --frozen: uv.lockを使用してバージョンを固定
# --no-dev: 開発依存関係を除外
# --compile-bytecode: Pythonファイルを事前コンパイルして起動を高速化
RUN uv sync --frozen --no-dev --compile-bytecode

# ========================================
# Stage 2: Runtime
# ========================================
FROM python:3.12-slim AS runtime

# システム依存関係のインストール
# - ffmpeg: 音声処理（discord.py FFmpegPCMAudio）に必須
# - libopus0: discord.pyの音声エンコード/デコードに必要
# - libsodium23: PyNaCl（暗号化ライブラリ）に必要
# - libffi8: ctypesなどの外部関数インターフェースに必要
# - ca-certificates: HTTPS通信用の証明書
# - curl, unzip: denoのインストールに必要
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopus0 \
    libsodium23 \
    libffi8 \
    ca-certificates \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# deno のインストール（yt-dlpのYouTube署名解読を高速化）
# yt-dlpはJavaScriptランタイムを使用してYouTubeの署名を解読する
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && chmod +x /usr/local/bin/deno

# セキュリティ: 非rootユーザーで実行
RUN useradd --create-home --shell /bin/bash appuser

# 作業ディレクトリの設定
WORKDIR /app

# uvをコピー
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# ビルドステージから仮想環境をコピー
COPY --from=builder /app/.venv /app/.venv

# アプリケーションコードをコピー
COPY --chown=appuser:appuser app/ ./app/
COPY --chown=appuser:appuser pyproject.toml uv.lock ./

# 必要なディレクトリを作成（アプリ起動時に必要）
RUN mkdir -p music uploaded_music saved_images logs \
    && chown -R appuser:appuser /app

# 非rootユーザーに切り替え
USER appuser

# 環境変数の設定
# - PATH: uvの仮想環境のbinディレクトリを含める
# - PYTHONUNBUFFERED: ログをリアルタイムで出力
# - PYTHONDONTWRITEBYTECODE: .pycファイルを作成しない（コンテナ向け最適化）
# - UV_PROJECT_ENVIRONMENT: uvが仮想環境を認識できるように
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT="/app/.venv"

# Cloud Runのポート設定（デフォルト8080、環境変数で上書き可能）
ENV PORT=8080
EXPOSE ${PORT}

# ヘルスチェック（Cloud Runはこれを使用）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/')" || exit 1

# アプリケーションの起動
# uvicornを直接使用してFastAPIアプリを起動
# - --host 0.0.0.0: 全てのネットワークインターフェースでリッスン
# - --port: Cloud RunのPORT環境変数を使用
# - --workers 1: Cloud Runでは1 workerが推奨
# - --timeout-keep-alive 30: コネクションタイムアウト
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 30"]
