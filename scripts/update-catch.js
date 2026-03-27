/**
 * サロンボード キャッチコピー自動更新スクリプト
 * 動作:
 *   1. サロンボードにログイン
 *   2. 本日の予約カレンダーから空き枠を取得
 *   3. Supabaseからキャッチテンプレートを取得
 *   4. キャッチコピーを生成してサロンボードに保存
 *   5. 実行結果をSupabaseに記録
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

// 環境変数
const SALON_ID = process.env.SALON_BOARD_ID
const SALON_PASS = process.env.SALON_BOARD_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY

if (!SALON_ID || !SALON_PASS || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('必要な環境変数が設定されていません')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// 文字数カウント（全角=1, 半角=0.5）
function countChars(text) {
  let count = 0
  for (const ch of text) {
    count += ch.charCodeAt(0) > 255 ? 1 : 0.5
  }
  return count
}

// 時間文字列を分に変換（比較用）
function timeToMinutes(timeStr) {
  const match = timeStr.match(/(\d+):(\d+)/)
  if (!match) return -1
  return parseInt(match[1]) * 60 + parseInt(match[2])
}

// 「16時」形式に変換
function formatTimeSlot(timeStr) {
  const match = timeStr.match(/(\d+):(\d+)/)
  if (!match) return timeStr
  const hour = parseInt(match[1])
  const min = parseInt(match[2])
  if (min === 0) return `${hour}時`
  return `${hour}時${min}分`
}

async function main() {
  const startTime = Date.now()
  let browser = null
  let status = 'error'
  let availableSlots = []
  let generatedCatch = null
  let errorMessage = null

  try {
    // Supabaseから設定取得
    const { data: settings, error: settingsError } = await supabase
      .from('catch_settings')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (settingsError || !settings) {
      throw new Error('設定の取得に失敗しました: ' + (settingsError?.message || '設定が見つかりません'))
    }

    console.log('設定取得完了:', settings.template)

    // ブラウザ起動
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()

    // --- ステップ1: ログイン ---
    console.log('ログイン中...')
    await page.goto('https://salonboard.com/login/', { waitUntil: 'networkidle' })

    await page.fill('input[name="userId"]', SALON_ID)
    await page.fill('input[name="password"]', SALON_PASS)
    await page.click('button[type="submit"], input[type="submit"], .btn-login, a:has-text("ログイン")')
    await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})

    // ログイン確認
    const currentUrl = page.url()
    if (currentUrl.includes('/login/')) {
      throw new Error('ログインに失敗しました')
    }
    console.log('ログイン成功:', currentUrl)

    // --- ステップ2: 本日の予約カレンダーから空き枠取得 ---
    console.log('予約カレンダーに移動中...')

    // 予約管理ページへ移動
    const calendarUrls = [
      'https://salonboard.com/CNB/reserve/calendar/',
      'https://salonboard.com/CNB/reservation/calendar/',
      'https://salonboard.com/CNB/reserveManage/',
    ]

    let calendarLoaded = false
    for (const url of calendarUrls) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
      if (!page.url().includes('/login/')) {
        calendarLoaded = true
        console.log('カレンダー読み込み:', page.url())
        break
      }
    }

    if (calendarLoaded) {
      // ページのテキストと構造から空き枠を推定
      availableSlots = await extractAvailableSlots(page)
      console.log('空き枠:', availableSlots)
    }

    // --- ステップ3: キャッチコピー生成 ---
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    // 現在時刻以降の空き枠を取得
    const futureSlots = availableSlots.filter(slot => {
      const slotMinutes = timeToMinutes(slot)
      return slotMinutes > nowMinutes
    })

    if (futureSlots.length > 0) {
      // 最も早い空き枠を使用
      const earliest = futureSlots[0]
      const timeLabel = formatTimeSlot(earliest)
      generatedCatch = settings.template.replace('{TIME}', timeLabel)

      // 文字数チェック
      if (countChars(generatedCatch) > 50) {
        // 文字数オーバーの場合は時間部分を短縮
        generatedCatch = settings.template.replace('{TIME}', `${new Date().getHours() + 1}時`)
      }

      status = 'success'
      console.log('生成キャッチ:', generatedCatch)
    } else {
      // 空きなし → フォールバック
      generatedCatch = settings.fallback_text
      status = 'no_slots'
      console.log('空き枠なし、フォールバック使用:', generatedCatch)
    }

    // --- ステップ4: サロン掲載情報編集ページでキャッチ更新 ---
    console.log('キャッチコピー更新中...')
    await page.goto('https://salonboard.com/CNB/draft/salonEdit/', { waitUntil: 'networkidle' })

    // キャッチフィールドを特定して更新
    const catchUpdated = await updateCatchField(page, generatedCatch)

    if (!catchUpdated) {
      throw new Error('キャッチフィールドの更新に失敗しました')
    }

    console.log('キャッチコピー更新完了!')

  } catch (err) {
    errorMessage = err.message || String(err)
    console.error('エラー:', errorMessage)
    if (status === 'error') {
      generatedCatch = null
    }
  } finally {
    if (browser) await browser.close()

    // 実行ログをSupabaseに保存
    const durationMs = Date.now() - startTime
    const { error: logError } = await supabase.from('execution_logs').insert({
      status,
      available_slots: availableSlots.length > 0 ? availableSlots : null,
      generated_catch: generatedCatch,
      error_message: errorMessage,
      duration_ms: durationMs,
    })

    if (logError) {
      console.error('ログ保存エラー:', logError.message)
    }

    console.log(`完了 [${status}] ${durationMs}ms`)
    process.exit(status === 'error' ? 1 : 0)
  }
}

/**
 * ページから空き枠を抽出する
 * サロンボードの予約カレンダーの構造に合わせて解析
 */
async function extractAvailableSlots(page) {
  const slots = []

  try {
    // サロンボードのカレンダーから空き枠を取得
    // 「空き」「○」などのマークがついたセルを探す
    const extractedSlots = await page.evaluate(() => {
      const found = []

      // 時間軸を持つテーブルセルを探す
      // 空き = 背景色が白 or 「○」マーク or クリック可能
      const cells = document.querySelectorAll('td, th')
      const timePattern = /^(\d{1,2}):(\d{2})$/

      cells.forEach(cell => {
        const text = cell.textContent?.trim() || ''
        if (timePattern.test(text)) {
          // この時間セルの次のセルが空きかチェック
          const nextSibling = cell.nextElementSibling
          if (nextSibling) {
            const nextText = nextSibling.textContent?.trim()
            const style = window.getComputedStyle(nextSibling)
            const bg = style.backgroundColor

            // 空き枠の判定（白 or 薄い色 = 空き）
            if (nextText === '○' || nextText === '' || nextText === '空き' ||
                bg === 'rgb(255, 255, 255)' || bg === 'rgba(0, 0, 0, 0)') {
              found.push(text)
            }
          }
        }
      })

      // 別パターン: data属性やclass名から空き枠を探す
      const availableElements = document.querySelectorAll(
        '[class*="available"], [class*="empty"], [class*="open"], [data-status="available"]'
      )
      availableElements.forEach(el => {
        const timeText = el.getAttribute('data-time') || el.textContent?.trim()
        if (timeText && timePattern.test(timeText)) {
          found.push(timeText)
        }
      })

      return [...new Set(found)].sort()
    })

    slots.push(...extractedSlots)

    // スクリーンショットでデバッグ（CI環境では省略）
    if (process.env.DEBUG_SCREENSHOT) {
      await page.screenshot({ path: 'debug-calendar.png', fullPage: true })
    }

  } catch (err) {
    console.warn('空き枠抽出でエラー:', err.message)
  }

  return slots
}

/**
 * サロン掲載情報編集ページのキャッチフィールドを更新
 */
async function updateCatchField(page, catchText) {
  try {
    // キャッチフィールドを探す（複数のセレクタを試す）
    const catchSelectors = [
      'input[name="catch"]',
      'input[name="catchCopy"]',
      'input[name="catch_copy"]',
      'textarea[name="catch"]',
      '#catch',
      '#catchCopy',
      // サロンボード固有のセレクタ（実際のページ構造に合わせて調整が必要）
      'input[maxlength="50"]',
    ]

    let catchField = null
    for (const selector of catchSelectors) {
      const el = await page.$(selector)
      if (el) {
        catchField = el
        console.log('キャッチフィールド発見:', selector)
        break
      }
    }

    if (!catchField) {
      // ページのHTMLをデバッグ出力
      console.warn('キャッチフィールドが見つかりません。ページ構造を確認中...')
      const inputs = await page.$$eval('input[type="text"], textarea', els =>
        els.map(el => ({
          name: el.name,
          id: el.id,
          maxLength: el.maxLength,
          placeholder: el.placeholder,
          value: el.value?.substring(0, 50),
        }))
      )
      console.log('フォームフィールド一覧:', JSON.stringify(inputs, null, 2))
      return false
    }

    // フィールドをクリアして新しいテキストを入力
    await catchField.click({ clickCount: 3 })
    await catchField.fill(catchText)

    // 登録ボタンをクリック
    const submitSelectors = [
      'button:has-text("登 録")',
      'button:has-text("登録")',
      'input[value="登録"]',
      'input[value="登 録"]',
      '.btn-submit',
      'button[type="submit"]',
    ]

    let submitted = false
    for (const selector of submitSelectors) {
      const btn = await page.$(selector)
      if (btn) {
        await btn.click()
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {})
        submitted = true
        console.log('登録ボタンクリック:', selector)
        break
      }
    }

    if (!submitted) {
      console.warn('登録ボタンが見つかりませんでした')
      return false
    }

    return true
  } catch (err) {
    console.error('キャッチ更新エラー:', err.message)
    return false
  }
}

main()
