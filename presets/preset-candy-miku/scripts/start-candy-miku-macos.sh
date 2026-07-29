#!/bin/bash
# Install / refresh Candy Miku into Codex QQ Skin theme library, then launch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
THEME_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
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

[ -f "$THEME_ROOT/theme.json" ] || { alert "theme.json missing in $THEME_ROOT"; exit 1; }

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

notify "正在安装主题到皮肤库…"
/bin/mkdir -p "$DEST"
/bin/chmod 700 "$DEST" 2>/dev/null || true

# Runtime assets only (top-level files). Keep docs/sources/scripts out of live theme dir.
for entry in "$THEME_ROOT"/*; do
  [ -f "$entry" ] || continue
  case "$(basename "$entry")" in
    README.md|.DS_Store|*.command) continue ;;
  esac
  /bin/cp -f "$entry" "$DEST/"
done
/bin/chmod 600 "$DEST"/* 2>/dev/null || true

# Also seed into QQ Skin presets/ so hot-apply / bundled seed stay consistent.
PRESET_DEST="$QQ_ROOT/presets/$THEME_ID"
if [ -d "$QQ_ROOT/presets" ]; then
  /bin/mkdir -p "$PRESET_DEST"
  for entry in "$THEME_ROOT"/*; do
    [ -f "$entry" ] || continue
    case "$(basename "$entry")" in
      README.md|.DS_Store|*.command) continue ;;
    esac
    /bin/cp -f "$entry" "$PRESET_DEST/"
  done
  if [ -d "$THEME_ROOT/sources" ]; then
    /bin/rm -rf "$PRESET_DEST/sources"
    /bin/cp -R "$THEME_ROOT/sources" "$PRESET_DEST/sources"
  fi
  if [ -d "$THEME_ROOT/scripts" ]; then
    /bin/mkdir -p "$PRESET_DEST/scripts"
    /bin/cp -f "$THEME_ROOT/scripts/"*.py "$PRESET_DEST/scripts/" 2>/dev/null || true
  fi
fi

notify "正在启动 Candy Miku…"
cd "$QQ_ROOT"
if "$SWITCH" --id "$THEME_ID"; then
  notify "Candy Miku 已就绪"
  exit 0
fi

alert "启动失败。请确认 Codex 已安装，并可用「Codex QQ Skin」正常启动。"
exit 1
