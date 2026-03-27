#!/bin/bash
# Mac cronセットアップスクリプト
# 実行: bash scripts/setup-cron.sh

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_SCRIPT="$SCRIPT_DIR/scripts/run-local.sh"

# .envファイルが存在するか確認
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "❌ .envファイルがありません。作成してください:"
  echo "   cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
  echo "   そして .env の中身を設定してください"
  exit 1
fi

# 実行権限を付与
chmod +x "$RUN_SCRIPT"

# 現在のcron設定を取得
CURRENT_CRON=$(crontab -l 2>/dev/null)

# すでに登録されているか確認
if echo "$CURRENT_CRON" | grep -q "hotpepper-auto-system"; then
  echo "⚠️  cronはすでに登録済みです:"
  echo "$CURRENT_CRON" | grep "hotpepper-auto-system"
  echo ""
  echo "再登録しますか？ (y/N)"
  read -r answer
  if [ "$answer" != "y" ]; then
    echo "キャンセルしました"
    exit 0
  fi
  # 既存のエントリを削除
  CURRENT_CRON=$(echo "$CURRENT_CRON" | grep -v "hotpepper-auto-system")
fi

# cronに追加（毎時0分に実行）
NEW_CRON="${CURRENT_CRON}
# ホットペッパー キャッチコピー自動更新（毎時0分）
0 * * * * $RUN_SCRIPT"

echo "$NEW_CRON" | crontab -

echo "✅ cronを設定しました！"
echo ""
echo "設定内容:"
crontab -l | grep -A1 "ホットペッパー"
echo ""
echo "今すぐテスト実行する場合:"
echo "  bash $RUN_SCRIPT"
echo ""
echo "cronを削除する場合:"
echo "  bash $SCRIPT_DIR/scripts/remove-cron.sh"
