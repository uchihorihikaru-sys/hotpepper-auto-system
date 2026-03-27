#!/bin/bash
# cron削除スクリプト
CURRENT_CRON=$(crontab -l 2>/dev/null)
NEW_CRON=$(echo "$CURRENT_CRON" | grep -v "hotpepper-auto-system" | grep -v "ホットペッパー")
echo "$NEW_CRON" | crontab -
echo "✅ cronを削除しました"
