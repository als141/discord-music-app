#!/usr/bin/env bash
set -euo pipefail

URL="${1:-https://discord-music-app.vercel.app}"
BROWSER="${2:-chromium}"

info() {
  printf '[playwright-wsl2] %s\n' "$1"
}

resolve_display() {
  if [[ -n "${DISPLAY:-}" ]]; then
    return 0
  fi

  # WSL2 内で X11 の Unix ソケットが存在する場合はローカル表示を優先する
  if [[ -S /tmp/.X11-unix/X0 ]] || [[ -S /mnt/wslg/.X11-unix/X0 ]]; then
    export DISPLAY=:0
    return 0
  fi

  # WSLg or WSL without system DISPLAY but X socket exists.
  if [[ -S /tmp/.X11-unix/X0 ]] || [[ -S /mnt/wslg/.X11-unix/X0 ]]; then
    local host
    host="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf || true)"
    if [[ -n "${host}" ]]; then
      if [[ "${host}" == *:* ]]; then
        export DISPLAY="[${host}]:0"
      else
        export DISPLAY="${host}:0"
      fi
      return 0
    fi
  fi

  info "DISPLAY が未設定です。必要なら手動で DISPLAY=:0 を付与してください。"

  return 1
}

require_display() {
  if ! resolve_display; then
    info "DISPLAY が見つかりません。WSL2でブラウザウィンドウを出すにはXサーバーが必要です。"
    info "Windows側でVcXsrvなどを起動し、以下を実行して再試行してください:"
    info "  export DISPLAY=\$(awk '/^nameserver/{print \$2; exit}' /etc/resolv.conf):0"
    exit 1
  fi

  info "DISPLAY=${DISPLAY}"
  if command -v xdpyinfo >/dev/null 2>&1; then
    if ! xdpyinfo >/dev/null 2>&1; then
      info "DISPLAY ${DISPLAY} へ接続できません。Xサーバー側でTCP接続やファイアウォールを確認してください。"
      exit 1
    fi
  fi
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    info "node が見つかりません。Playwright CLIを実行できません。"
    exit 1
  fi
}

require_npx() {
  if ! command -v npx >/dev/null 2>&1; then
    info "npx が見つかりません。Node.js/npmを確認してください。"
    exit 1
  fi
}

info "起動先: ${URL}"
info "ブラウザ: ${BROWSER}"

require_node
require_npx
require_display

info "Playwrightのブラウザ起動を開始します（headful）。終了するにはブラウザを閉じてください。"
npx --yes playwright open --browser "$BROWSER" "$URL"
