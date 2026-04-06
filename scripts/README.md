# Playwright Debug Helper

`scripts/open-vercel-browser.sh` で、Vercel側ログ確認と合わせてブラウザを実画面で開けるようにします。

## 使い方

```
./scripts/open-vercel-browser.sh [URL] [browser]
```

- `URL`（任意）: 開く先。省略時は `https://discord-music-app.vercel.app`
- `browser`（任意）: `chromium`（既定）, `chrome`, `firefox`, `webkit`

例:

```
./scripts/open-vercel-browser.sh
./scripts/open-vercel-browser.sh https://discord-music-app.vercel.app chromium
```

## WSL2でウィンドウを出すための前提

- WSL2側で `DISPLAY` が未設定でも、VcXsrvやWslg接続時の環境であれば自動で
  `$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf):0` を試します。
- もし起動しない場合、Windows側で `VcXsrv`（または同等のXサーバー）を起動し、
  下記を `.bashrc` などに入れてセッションを再読み込みしてください。

```
export DISPLAY="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf):0"
```

※IPv6の nameserver の場合は、必要に応じて `[]` が自動追加される環境変数を使ってください。

必要なら、`xhost +local:` などで権限制限を確認してください（セキュリティ注意）。

## 注意

- ここで起動するのはブラウザUIです。サービスの詳細なDOM/コンソールを長時間監視する場合は
  このリポジトリの Playwright MCP (`mcp__playwright__*`) と併用すると再現性が上がります。
