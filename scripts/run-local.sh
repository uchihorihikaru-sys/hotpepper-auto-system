#!/bin/bash
# サロンボード キャッチコピー自動更新 - Mac実行スクリプト
# launchd / cron から呼び出される

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/cron.log"

mkdir -p "$SCRIPT_DIR/logs"

echo "$(date '+%Y-%m-%d %H:%M:%S') 実行開始" >> "$LOG_FILE"

# .envから環境変数を読み込む
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Node.jsのパスを通す（nvm使用の場合も対応）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$SCRIPT_DIR"

# スクリプト実行
node scripts/update-catch.js >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') 終了 (exit: $EXIT_CODE)" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

exit $EXIT_CODE
