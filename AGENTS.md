# hotpepper-auto-system — Codex 作業ガイド

ホットペッパービューティ関連の自動運用（キャッチコピー更新等）。React アプリ + ブラウザ拡張。

## 技術 / 起動
- React + TypeScript + **Vite**、`@supabase/supabase-js`、react-router-dom、lucide-react。
- セットアップ: `npm install`
- scripts:
  - `npm run dev` — Vite 開発サーバー
  - `npm run build` — `tsc -b && vite build`
  - `npm run lint` / `npm run preview`
  - `npm run update-catch` — `node scripts/update-catch.js`（キャッチコピー更新バッチ）
- 付随: `chrome-extension/`（ブラウザ拡張）、`supabase/`、Playwright（E2E/自動化）、libsodium-wrappers（暗号）、sharp（画像）。

## デプロイ / リポジトリ
- 本番: https://hotpepper-auto-system.vercel.app（framework: vite、output: `dist`、SPA rewrite）
- GitHub: `uchihorihikaru-sys/hotpepper-auto-system`
- ⚠️ remote URL に GitHub PAT 直書きあり → 再発行 + SSH 化を推奨

## 移管メモ
- `node_modules` / `dist` はクローン後に `npm install` で再生成。
- Supabase の URL/キーや拡張機能の認証情報は環境変数 / ローカル設定で管理（git に入れない）。
