# Dockerfile for Discord Music App Backend
FROM python:3.12-slim

# システム依存関係のインストール
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# uvのインストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 作業ディレクトリの設定
WORKDIR /app

# Python依存関係ファイルをコピー
COPY pyproject.toml uv.lock ./

# 依存関係のインストール
RUN uv sync --frozen

# アプリケーションコードをコピー
COPY . .

# ポートの公開
EXPOSE 8000

# アプリケーションの起動
CMD ["uv", "run", "python", "api.py"]