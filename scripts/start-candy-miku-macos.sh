#!/bin/bash
# Install / refresh Candy Miku into Codex QQ Skin theme library, then launch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
THEME_PACK="$REPO_ROOT/theme"
THEME_ID="preset-candy-miku"
STATE_ROOT="${CODEX_QQ_SKIN_STATE:-$HOME/Library/Application Support/CodexQQSkin}"
DEST="$STATE_ROOT/themes/$THEME_ID"

alert() {
  if command -v osascript >/dev/null 2>&1; then
    /usr/bin/osascript -e "display alert \"Candy Miku\" message \"$1\" as warning" >/dev/null 2>&1 || true
  fi
  printf 'Candy Miku: %s\n' "$1" >&2
}

notify() {
  if command -v osascript >/dev/null 2>&1; then
    /usr/bin/osascript -e "display notification \"$1\" with title \"Candy Miku\"" >/dev/null 2>&1 || true
  fi
  printf '%s\n' "$1"
}

[ -f "$THEME_PACK/theme.json" ] || { alert "theme/theme.json missing in $REPO_ROOT"; exit 1; }

# Prefer the working tree that already contains Candy Miku / miku mode support.
CANDIDATES=(
  "${CODEX_QQ_SKIN_ROOT:-}"
  "$HOME/Documents/coding_project/codex-project/Codex-QQ-Skin"
  "$HOME/Documents/Codex-QQ-Skin"
  "$HOME/Downloads/Codex-QQ-Skin"
  "$HOME/.codex/codex-qq-skin-studio"
)

QQ_ROOT=""
for cand in "${CANDIDATES[@]}"; do
  [ -n "$cand" ] || continue
  if [ -x "$cand/scripts/switch-theme-macos.sh" ]; then
    QQ_ROOT="$cand"
    break
  fi
done

if [ -z "$QQ_ROOT" ]; then
  alert "未找到 Codex QQ Skin。请先安装 https://github.com/zhulin025/Codex-QQ-Skin ，或设置 CODEX_QQ_SKIN_ROOT。"
  exit 1
fi

SWITCH="$QQ_ROOT/scripts/switch-theme-macos.sh"
[ -x "$SWITCH" ] || { alert "缺少 switch-theme-macos.sh"; exit 1; }

copy_theme_files() {
  local dest="$1"
  /bin/mkdir -p "$dest"
  /bin/chmod 700 "$dest" 2>/dev/null || true
  local entry
  for entry in "$THEME_PACK"/*; do
    [ -f "$entry" ] || continue
    /bin/cp -f "$entry" "$dest/"
  done
  /bin/chmod 600 "$dest"/* 2>/dev/null || true
}

notify "正在安装主题到皮肤库…"
copy_theme_files "$DEST"

# Also seed into QQ Skin presets/ (flat layout required by Codex QQ Skin).
PRESET_DEST="$QQ_ROOT/presets/$THEME_ID"
if [ -d "$QQ_ROOT/presets" ]; then
  copy_theme_files "$PRESET_DEST"
  if [ -d "$REPO_ROOT/sources" ]; then
    /bin/rm -rf "$PRESET_DEST/sources"
    /bin/cp -R "$REPO_ROOT/sources" "$PRESET_DEST/sources"
  fi
  /bin/mkdir -p "$PRESET_DEST/scripts"
  /bin/cp -f "$REPO_ROOT/scripts/make-live2d-layers.py" "$PRESET_DEST/scripts/" 2>/dev/null || true
fi

notify "正在启动 Candy Miku…"
cd "$QQ_ROOT"
if "$SWITCH" --id "$THEME_ID"; then
  notify "Candy Miku 已就绪"
  exit 0
fi

alert "启动失败。请确认 Codex 已安装，并可用「Codex QQ Skin」正常启动。"
exit 1
