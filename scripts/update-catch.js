/**
 * Lay. Catch Board - GitHub Actions実行スクリプト
 * Chrome拡張(background.js)と同じロジックをPlaywrightで再現
 *
 * 動作:
 *   1. サロンボードにログイン
 *   2. 本日〜7日先のスケジュールページから空き枠を取得
 *   3. 連続60分以上・実行時刻+2時間以降の枠を抽出
 *   4. キャッチコピー生成（50文字制限・ブラケット交互切り替え）
 *   5. サロンボードのキャッチを更新 → 反映申請
 *   6. 実行結果をSupabaseに記録
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// 設定
// ============================================================
const SALON_ID   = process.env.SALON_BOARD_ID
const SALON_PASS = process.env.SALON_BOARD_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sapeipppwfuezesoadjg.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY

const DEFAULT_TEMPLATE = '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎'
const DEFAULT_FALLBACK  = '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪'

if (!SALON_ID || !SALON_PASS || !SUPABASE_KEY) {
  console.error('[Lay. Catch Board] 必要な環境変数が不足しています')
  console.error('SALON_BOARD_ID, SALON_BOARD_PASSWORD, SUPABASE_KEY を設定してください')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ============================================================
// 文字数制限（50文字）に収まるよう段階的に短縮
// Chrome拡張のfitToLimit()と同じロジック
// ============================================================
function fitToLimit(template, prefix, timeLabel) {
  const LIMIT = 50
  let text = template.replace('本日', prefix).replace('{TIME}', timeLabel)
  // 余計なスペースは常に除去
  text = text.replace(/\s/g, '')
  if (text.length <= LIMIT) return text

  const steps = [
    t => t.replace(/[◎◯○●★☆♪♡♥✨💫⭐🌟]/g, ''),
    t => t.replace(/《(.*?)》/g, '$1'),
    t => t.replace(/【(.*?)】/g, '$1'),
    t => t.replace(/[\[［](.*?)[\]］]/g, '$1').replace(/〈(.*?)〉/g, '$1'),
  ]

  for (const step of steps) {
    text = step(text)
    if (text.length <= LIMIT) return text
  }
  return text.slice(0, LIMIT)
}

// ============================================================
// ブラケット切り替え（[]↔〈〉）
// Chrome拡張のapplyBracketToSettings()と同じロジック
// ============================================================
function applyBracketToSettings(settings, variantIndex) {
  const convert = str => variantIndex % 2 === 1
    ? str.replace(/〈([^〉]*)〉/g, '[$1]')   // 〈〉→[]
    : str.replace(/\[([^\]]*)\]/g, '〈$1〉') // []→〈〉
  return {
    ...settings,
    template: convert(settings.template),
    fallback:  convert(settings.fallback),
  }
}

// ============================================================
// 連続した空き時間が60分以上ある枠の「開始時刻」リストを返す
// Chrome拡張のfilterContinuousHour()と同じロジック
// ============================================================
function filterContinuousHour(slots) {
  if (slots.length === 0) return []
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const sorted = [...slots].sort()
  const mins   = sorted.map(toMin)
  const SLOT      = 30
  const MIN_BLOCK = 60

  const result = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < mins.length && mins[j + 1] - mins[j] === SLOT) j++
    const blockDuration = (j - i + 1) * SLOT
    if (blockDuration >= MIN_BLOCK) result.push(sorted[i])
    i = j + 1
  }
  return result
}

// ============================================================
// Supabaseから前回のvariantIndexを取得
// generated_catchの[]か〈〉を見て次のvariantを決める
// ============================================================
async function getNextVariantIndex() {
  try {
    const { data } = await supabase
      .from('execution_logs')
      .select('generated_catch')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (data?.generated_catch) {
      // 前回が[]を使っていたら今回は〈〉（variant 2）
      // 前回が〈〉を使っていたら今回は[]（variant 1）
      const usedSquare = data.generated_catch.includes('[') || data.generated_catch.includes(']')
      return usedSquare ? 2 : 1
    }
  } catch (e) {
    console.warn('[Lay. Catch Board] variant取得失敗、デフォルト1を使用:', e.message)
  }
  return 1
}

// ============================================================
// スケジュールページから空き枠を取得
// Chrome拡張のgetAvailableSlots()と同じDOMパース
// ============================================================
async function getAvailableSlots(page, date) {
  const y  = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d  = String(date.getDate()).padStart(2, '0')
  const dateStr = `${y}${mo}${d}`
  const url = `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${dateStr}`

  console.log(`[Lay. Catch Board] スケジュール取得: ${dateStr}`)

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

  // ログインページにリダイレクトされたら空配列
  const currentUrl = page.url()
  if (currentUrl.includes('/login') || currentUrl.includes('Login') || currentUrl.includes('login.do')) {
    console.warn(`[Lay. Catch Board] ${dateStr}: セッション切れ（ログインページ）`)
    return []
  }

  const result = await page.evaluate(() => {
    try {
      const rows = document.querySelectorAll('tr')
      let timeSlots   = []
      let availCounts = []

      for (const row of rows) {
        const cells     = Array.from(row.querySelectorAll('th, td'))
        const firstText = (cells[0]?.textContent || '').trim()

        // 時間ヘッダー行を探す（"予約を隠す" or "集計欄を隠す" が最初のセル）
        if ((firstText.includes('予約を隠す') || firstText.includes('集計欄を隠す')) && timeSlots.length === 0) {
          for (let i = 1; i < cells.length - 1; i++) {
            const t       = cells[i].textContent.trim()
            const colspan = parseInt(cells[i].getAttribute('colspan') || '1')
            if (/^\d{1,2}:\d{2}$/.test(t)) {
              const [h, m] = t.split(':').map(Number)
              timeSlots.push(`${h}:${String(m).padStart(2, '0')}`)
              if (colspan >= 2 && m === 0) {
                timeSlots.push(`${h}:30`)
              }
            }
          }
        }

        // 空き数行を探す（"残り受付数" or "残り受付可能数" を含む行）
        if (
          (firstText.includes('残り受付数') || firstText.includes('残り受付可能数')) &&
          !firstText.includes('受付可能数：') &&
          availCounts.length === 0
        ) {
          for (let i = 1; i < cells.length - 1; i++) {
            const val = parseInt(cells[i].textContent.trim())
            if (!isNaN(val)) availCounts.push(val)
          }
        }
      }

      const slots = []
      for (let i = 0; i < Math.min(timeSlots.length, availCounts.length); i++) {
        if (availCounts[i] > 0) slots.push(timeSlots[i])
      }

      return {
        slots: [...new Set(slots)].sort(),
        _debug: { timeSlots: timeSlots.length, availCounts: availCounts.length, url: window.location.href }
      }
    } catch (e) {
      return { slots: [], _debug: { error: e.message } }
    }
  })

  console.log(`[Lay. Catch Board] ${dateStr} DOM解析: timeSlots=${result._debug.timeSlots} availCounts=${result._debug.availCounts} 空き=${result.slots.length}`, result.slots)
  if (result._debug.error) console.warn(`[Lay. Catch Board] DOM解析エラー:`, result._debug.error)

  return result.slots || []
}

// ============================================================
// 最適な空き枠を選択してキャッチを生成
// Chrome拡張のselectBestSlot()と同じロジック
// ============================================================
async function selectBestSlot(page, now, settings) {
  const hour         = now.getHours()
  const refMinutes   = hour * 60 + now.getMinutes()
  const startDayOffset = hour >= 19 ? 1 : 0   // 19時以降は翌日から
  const cutoffHour   = refMinutes + 120         // +2時間（分単位）

  for (let dayOffset = startDayOffset; dayOffset <= 7; dayOffset++) {
    const targetDate = new Date(now)
    targetDate.setDate(targetDate.getDate() + dayOffset)

    let slots
    try {
      slots = await getAvailableSlots(page, targetDate)
    } catch (e) {
      console.warn(`[Lay. Catch Board] ${dayOffset}日後のスロット取得失敗:`, e.message)
      slots = []
    }

    // 当日は+2時間フィルター、翌日以降は全枠対象
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const timeFiltered = dayOffset === 0
      ? slots.filter(s => toMin(s) >= cutoffHour)
      : [...slots]

    const validSlots = filterContinuousHour(timeFiltered)

    if (validSlots.length > 0) {
      const selectedSlot = validSlots[0]

      let catchPrefix
      if      (dayOffset === 0) catchPrefix = '本日'
      else if (dayOffset === 1) catchPrefix = '明日'
      else catchPrefix = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`

      const [h, m] = selectedSlot.split(':').map(Number)
      const timeLabel = m === 0 ? `${h}時` : `${h}時${m}分`
      const catchText = fitToLimit(settings.template, catchPrefix, timeLabel)

      return { catchText, hasSlot: true, slot: selectedSlot, prefix: catchPrefix }
    }
  }

  // 7日先まで空きなし → フォールバック
  const fallback = settings.fallback.slice(0, 50)
  return { catchText: fallback, hasSlot: false, slot: null, prefix: null }
}

// ============================================================
// サロンボードのキャッチを更新して反映申請
// Chrome拡張のupdateCatchOnSalonBoard()と同じ流れ
// ============================================================
async function updateCatchOnSalonBoard(page, catchText) {
  const EDIT_URL = 'https://salonboard.com/CNB/draft/salonEdit/'
  console.log('[Lay. Catch Board] キャッチ更新ページへ移動...')

  await page.goto(EDIT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)

  // ログインページにリダイレクトされたらエラー
  if (page.url().includes('/login') || page.url().includes('Login')) {
    throw new Error('キャッチ更新ページへのアクセス中にセッション切れ')
  }

  // キャッチフィールドを探す（maxlength=50 or name="catch"系）
  const catchSelectors = [
    'input[name="catch"]',
    'input[name="catchCopy"]',
    'input[name="catch_copy"]',
    'input[maxlength="50"]',
    '#catch',
    '#catchCopy',
  ]

  let catchField = null
  for (const selector of catchSelectors) {
    const el = await page.$(selector)
    if (el) {
      catchField = el
      console.log(`[Lay. Catch Board] キャッチフィールド発見: ${selector}`)
      break
    }
  }

  if (!catchField) {
    // デバッグ用: 全inputを出力
    const inputs = await page.$$eval('input[type="text"], textarea', els =>
      els.map(el => ({ name: el.name, id: el.id, maxLength: el.maxLength, value: el.value?.slice(0, 30) }))
    )
    console.warn('[Lay. Catch Board] フォームフィールド一覧:', JSON.stringify(inputs))
    throw new Error('キャッチフィールドが見つかりません')
  }

  // フィールドを更新
  await catchField.click({ clickCount: 3 })
  await catchField.fill(catchText)
  console.log(`[Lay. Catch Board] キャッチ入力完了: ${catchText}`)

  // 登録ボタンをクリック
  const submitSelectors = [
    'button:has-text("登 録")',
    'button:has-text("登録")',
    'input[value="登録"]',
    'input[value="登 録"]',
    'button[type="submit"]',
  ]

  for (const selector of submitSelectors) {
    const btn = await page.$(selector)
    if (btn) {
      await btn.click()
      await page.waitForTimeout(3000)
      console.log(`[Lay. Catch Board] 登録ボタンクリック: ${selector}`)
      break
    }
  }

  // 反映申請
  console.log('[Lay. Catch Board] 反映申請ページへ移動...')
  await page.goto('https://salonboard.com/CNB/reflect/reflectTop/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(2000)

  const reflectBtns = await page.$$('input[value="反映申請"], button:has-text("反映申請")')
  console.log(`[Lay. Catch Board] 反映申請ボタン数: ${reflectBtns.length}`)

  for (const btn of reflectBtns) {
    const isDisabled = await btn.evaluate(el => el.disabled)
    if (isDisabled) continue

    const rowText = await btn.evaluate(el => el.closest('tr')?.textContent || '')
    if (
      rowText.includes('サロン掲載情報') &&
      !rowText.includes('スタイリスト掲載情報') &&
      !rowText.includes('メニュー掲載情報') &&
      !rowText.includes('スタイル掲載情報') &&
      !rowText.includes('こだわり掲載情報') &&
      !rowText.includes('クーポン掲載情報')
    ) {
      await btn.click()
      await page.waitForTimeout(3000)
      console.log('[Lay. Catch Board] 反映申請完了')
      return
    }
  }

  console.warn('[Lay. Catch Board] 反映申請ボタンが見つかりませんでした（既に申請済みの可能性）')
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  const startTime = Date.now()
  let browser     = null
  let status      = 'error'
  let foundSlots  = []
  let generatedCatch   = null
  let errorMessage     = null
  let targetDateLabel  = null

  try {
    // ① variantIndex を Supabase から取得
    const variantIndex = await getNextVariantIndex()
    console.log(`[Lay. Catch Board] ブラケット variant: ${variantIndex}`)

    const baseSettings = {
      template: DEFAULT_TEMPLATE,
      fallback:  DEFAULT_FALLBACK,
    }
    const settings = applyBracketToSettings(baseSettings, variantIndex)

    // ② ブラウザ起動（ボット検知対策）
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--lang=ja-JP',
      ],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport:    { width: 1280, height: 900 },
      locale:      'ja-JP',
      timezoneId:  'Asia/Tokyo',
      extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8' },
    })

    // webdriverプロパティを隠す
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()

    // ③ サロンボードにログイン
    console.log('[Lay. Catch Board] ログイン中...')
    await page.goto('https://salonboard.com/', { waitUntil: 'commit', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1000)

    await page.goto('https://salonboard.com/login/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('input[name="LOGIN_ID"], input[type="text"]', { timeout: 15000 })

    // IDフィールド（サロンボードは LOGIN_ID）
    const idField = await page.$('input[name="LOGIN_ID"]') || await page.$('input[type="text"]')
    const pwField = await page.$('input[type="password"]')
    if (!idField || !pwField) throw new Error('ログインフォームが見つかりません')

    await idField.fill(SALON_ID)
    await pwField.fill(SALON_PASS)
    await page.waitForTimeout(500)

    const submitBtn = await page.$('input[type="submit"], button[type="submit"], a[onclick*="login"], a[onclick*="Login"]')
    if (!submitBtn) throw new Error('ログインボタンが見つかりません')
    await submitBtn.click()

    await page.waitForURL(url => !url.includes('/login/') && !url.includes('login.do'), { timeout: 20000 }).catch(() => {})

    if (page.url().includes('/login')) throw new Error('ログインに失敗しました（ID/PW確認）')
    console.log('[Lay. Catch Board] ログイン成功:', page.url())

    // ④ 空き枠探索 → キャッチ生成
    const now = new Date()
    const currentResult = await selectBestSlot(page, now, settings)

    foundSlots       = currentResult.slot ? [currentResult.slot] : []
    targetDateLabel  = currentResult.prefix || null
    generatedCatch   = currentResult.catchText
    status           = currentResult.hasSlot ? 'success' : 'no_slots'

    console.log(`[Lay. Catch Board] 結果: ${status} / ${generatedCatch}`)

    // ⑤ キャッチ更新 & 反映申請
    await updateCatchOnSalonBoard(page, generatedCatch)

  } catch (err) {
    errorMessage = err.message || String(err)
    console.error('[Lay. Catch Board] エラー:', errorMessage)
  } finally {
    if (browser) await browser.close()

    // ⑥ Supabaseにログ保存
    const durationMs = Date.now() - startTime
    const { error: logError } = await supabase.from('execution_logs').insert({
      status,
      available_slots:  foundSlots.length > 0 ? foundSlots : null,
      generated_catch:  generatedCatch,
      error_message:    errorMessage,
      duration_ms:      durationMs,
      target_date_label: targetDateLabel,
    })

    if (logError) console.error('[Lay. Catch Board] ログ保存エラー:', logError.message)

    console.log(`[Lay. Catch Board] 完了 [${status}] ${durationMs}ms`)
    process.exit(status === 'error' ? 1 : 0)
  }
}

main()
