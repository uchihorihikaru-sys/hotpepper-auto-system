// ============================================================
// Lay. Catch Board - バックグラウンドサービスワーカー
// Chromeのアラーム機能で毎時0分に自動実行
// ============================================================

const SUPABASE_URL = 'https://sapeipppwfuezesoadjg.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhcGVpcHBwd2Z1ZXplc29hZGpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDI2NjAsImV4cCI6MjA5MDExODY2MH0.fusS-pw1thAHOcVxjFlFEAWHeP9zN4Q4BoN4TJ9qfv4'

// インストール時: 毎時0分のアラームを設定
chrome.runtime.onInstalled.addListener(() => {
  // 毎時0分に実行（60分ごと）
  chrome.alarms.create('updateCatch', {
    delayInMinutes: 1,
    periodInMinutes: 60
  })
  console.log('[Lay. Catch Board] インストール完了。毎時0分に自動実行します。')

  // デフォルト設定を保存
  chrome.storage.local.get(['template', 'fallback', 'isActive'], (result) => {
    if (!result.template) {
      chrome.storage.local.set({
        template: '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎',
        fallback: '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪',
        isActive: true
      })
    }
  })
})

// アラート発火時: 更新処理を実行
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'updateCatch') {
    console.log('[Lay. Catch Board] 定時実行開始')
    await runUpdate()
  }
})

// 手動実行用メッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runNow') {
    runUpdate().then(() => sendResponse({ success: true }))
    return true // 非同期レスポンスのため
  }
  if (message.action === 'getStatus') {
    chrome.storage.local.get(['lastResult', 'lastRun'], (result) => {
      sendResponse(result)
    })
    return true
  }
})

// ============================================================
// メイン処理
// ============================================================
async function runUpdate() {
  const startTime = Date.now()
  let status = 'error'
  let availableSlots = []
  let generatedCatch = null
  let errorMessage = null

  try {
    // 設定取得
    const settings = await getSettings()
    if (!settings.isActive) {
      console.log('[Lay. Catch Board] 自動更新が無効になっています')
      return
    }

    console.log('[Lay. Catch Board] 設定取得:', settings.template)

    // Step1: スケジュールページから空き枠取得
    availableSlots = await getAvailableSlots()
    console.log('[Lay. Catch Board] 空き枠:', availableSlots)

    // Step2: キャッチコピー生成
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const futureSlots = availableSlots.filter(slot => {
      const [h, m] = slot.split(':').map(Number)
      return (h * 60 + m) > nowMinutes
    })

    if (futureSlots.length > 0) {
      const earliest = futureSlots[0]
      const [h, m] = earliest.split(':').map(Number)
      const timeLabel = m === 0 ? `${h}時` : `${h}時${m}分`
      generatedCatch = settings.template.replace('{TIME}', timeLabel)

      // 文字数チェック（50文字以内）
      if (countChars(generatedCatch) > 50) {
        generatedCatch = settings.template.replace('{TIME}', `${now.getHours() + 1}時`)
      }
      status = 'success'
    } else {
      generatedCatch = settings.fallback
      status = 'no_slots'
    }

    console.log('[Lay. Catch Board] 生成キャッチ:', generatedCatch)

    // Step3: サロンボードのキャッチを更新
    await updateCatchOnSalonBoard(generatedCatch)

    // Step4: 反映申請
    await clickReflectButton()

    console.log('[Lay. Catch Board] 更新完了！')

  } catch (err) {
    errorMessage = err.message || String(err)
    console.error('[Lay. Catch Board] エラー:', errorMessage)
  } finally {
    const durationMs = Date.now() - startTime

    // Supabaseにログ保存
    await logToSupabase({
      status,
      available_slots: availableSlots.length > 0 ? availableSlots : null,
      generated_catch: generatedCatch,
      error_message: errorMessage,
      duration_ms: durationMs
    })

    // ローカルストレージに最終結果を保存
    chrome.storage.local.set({
      lastResult: { status, generatedCatch, errorMessage, durationMs },
      lastRun: new Date().toISOString()
    })

    console.log(`[Lay. Catch Board] 完了 [${status}] ${durationMs}ms`)
  }
}

// ============================================================
// 設定取得
// ============================================================
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['template', 'fallback', 'isActive'], (result) => {
      resolve({
        template: result.template || '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎',
        fallback: result.fallback || '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪',
        isActive: result.isActive !== false
      })
    })
  })
}

// ============================================================
// スケジュールページから空き枠を取得
// ============================================================
async function getAvailableSlots() {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const url = `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${dateStr}`

  const tab = await chrome.tabs.create({ url, active: false })

  try {
    await waitForTabLoad(tab.id)

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 「残り受付可能数」の行から空き枠を取得
        const slots = []

        try {
          // テーブルヘッダーから時間を取得
          const table = document.querySelector('table')
          if (!table) return []

          const rows = table.querySelectorAll('tr')
          let timeHeaders = []
          let availableRow = null

          for (const row of rows) {
            const cells = row.querySelectorAll('th, td')
            const firstCell = cells[0]?.textContent?.trim() || ''

            // 時間ヘッダー行を探す
            if (firstCell === '' && cells.length > 2) {
              const possibleTimes = Array.from(cells).map(c => c.textContent.trim())
              if (possibleTimes.some(t => /^\d{1,2}:\d{2}$/.test(t))) {
                timeHeaders = possibleTimes
              }
            }

            // 残り受付可能数の行を探す
            if (firstCell.includes('残り受付可能数') || firstCell.includes('受付可能')) {
              availableRow = row
            }
          }

          if (availableRow && timeHeaders.length > 0) {
            const cells = availableRow.querySelectorAll('td')
            cells.forEach((cell, idx) => {
              const val = parseInt(cell.textContent.trim())
              const time = timeHeaders[idx + 1] // +1 でラベル列をスキップ
              if (!isNaN(val) && val > 0 && time && /^\d{1,2}:\d{2}$/.test(time)) {
                slots.push(time)
              }
            })
          }

          // 別の方法: data属性から取得
          if (slots.length === 0) {
            const availableCells = document.querySelectorAll('[data-available="1"], .available, .slot-available')
            availableCells.forEach(cell => {
              const time = cell.getAttribute('data-time') || cell.textContent.trim()
              if (/^\d{1,2}:\d{2}$/.test(time)) {
                slots.push(time)
              }
            })
          }

        } catch (e) {
          console.error('空き枠取得エラー:', e)
        }

        return [...new Set(slots)].sort()
      }
    })

    return results[0]?.result || []

  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

// ============================================================
// サロンボードのキャッチを更新
// ============================================================
async function updateCatchOnSalonBoard(catchText) {
  const tab = await chrome.tabs.create({
    url: 'https://salonboard.com/CNB/draft/salonEdit/',
    active: false
  })

  try {
    await waitForTabLoad(tab.id)

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => {
        // キャッチフィールドを探す（maxlength=50 のinput）
        const inputs = document.querySelectorAll('input[type="text"]')
        let catchInput = null

        for (const input of inputs) {
          if (input.maxLength === 50 ||
              input.name === 'catch' ||
              input.name === 'catchCopy' ||
              input.name?.toLowerCase().includes('catch')) {
            catchInput = input
            break
          }
        }

        if (!catchInput) {
          // フォールバック: 値を確認して探す
          for (const input of inputs) {
            if (input.value?.includes('空きあり') || input.value?.includes('空き') ||
                input.value?.includes('予約')) {
              catchInput = input
              break
            }
          }
        }

        if (!catchInput) return { success: false, error: 'キャッチフィールドが見つかりません' }

        // 値を設定
        catchInput.focus()
        catchInput.select()
        catchInput.value = text
        catchInput.dispatchEvent(new Event('input', { bubbles: true }))
        catchInput.dispatchEvent(new Event('change', { bubbles: true }))

        // 登録ボタンを探してクリック
        const buttons = document.querySelectorAll('input[type="submit"], button[type="submit"], button')
        let submitBtn = null
        for (const btn of buttons) {
          const val = btn.value || btn.textContent || ''
          if (val.includes('登録') || val.includes('登 録') || val.includes('保存')) {
            submitBtn = btn
            break
          }
        }

        if (!submitBtn) return { success: false, error: '登録ボタンが見つかりません' }

        submitBtn.click()
        return { success: true, catchText: text }
      },
      args: [catchText]
    })

    if (!result[0]?.result?.success) {
      throw new Error(result[0]?.result?.error || 'キャッチ更新失敗')
    }

    // ページ遷移を少し待つ
    await sleep(3000)

  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

// ============================================================
// 反映申請ボタンをクリック
// ============================================================
async function clickReflectButton() {
  const tab = await chrome.tabs.create({
    url: 'https://salonboard.com/CNB/reflect/reflectTop/',
    active: false
  })

  try {
    await waitForTabLoad(tab.id)

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 「サロン掲載情報」行の「反映申請」ボタンを探す
        const rows = document.querySelectorAll('tr')

        for (const row of rows) {
          const rowText = row.textContent || ''
          if (rowText.includes('サロン掲載情報') &&
              !rowText.includes('スタイリスト') &&
              !rowText.includes('メニュー') &&
              !rowText.includes('スタイル') &&
              !rowText.includes('クーポン') &&
              !rowText.includes('こだわり') &&
              !rowText.includes('特集')) {

            const btns = row.querySelectorAll('input[type="submit"], button')
            for (const btn of btns) {
              if (!btn.disabled && (btn.value?.includes('反映申請') || btn.textContent?.includes('反映申請'))) {
                btn.click()
                return true
              }
            }
          }
        }

        // フォールバック: ページ内の最初の有効な反映申請ボタン
        const allBtns = document.querySelectorAll('input[value="反映申請"], button')
        for (const btn of allBtns) {
          if (!btn.disabled && (btn.value?.includes('反映申請') || btn.textContent?.includes('反映申請'))) {
            btn.click()
            return true
          }
        }
        return false
      }
    })

    await sleep(2000)

  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

// ============================================================
// Supabaseにログを保存
// ============================================================
async function logToSupabase(data) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/execution_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    })
  } catch (err) {
    console.error('[Lay. Catch Board] Supabaseログ保存失敗:', err.message)
  }
}

// ============================================================
// ユーティリティ
// ============================================================
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('タブ読み込みタイムアウト')), timeout)

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 1000) // 追加で1秒待機
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function countChars(text) {
  let count = 0
  for (const ch of text) {
    count += ch.charCodeAt(0) > 255 ? 1 : 0.5
  }
  return count
}
