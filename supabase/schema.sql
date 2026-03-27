-- キャッチコピー設定テーブル
CREATE TABLE IF NOT EXISTS catch_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template TEXT NOT NULL DEFAULT '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎',
  fallback_text TEXT NOT NULL DEFAULT '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 実行ログテーブル
CREATE TABLE IF NOT EXISTS execution_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'no_slots')),
  available_slots TEXT[],
  generated_catch TEXT,
  error_message TEXT,
  duration_ms INTEGER
);

-- RLS有効化
ALTER TABLE catch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

-- 匿名アクセス許可（管理画面・GitHub Actionsから使用）
CREATE POLICY "allow_all_catch_settings" ON catch_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_execution_logs" ON execution_logs FOR ALL USING (true) WITH CHECK (true);

-- デフォルト設定を挿入
INSERT INTO catch_settings (template, fallback_text, is_active)
VALUES (
  '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎',
  '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪',
  true
);
