// ============================================================
// Lay. Catch Board - バックグラウンドサービスワーカー
// Chromeのアラーム機能で毎時0分に自動実行
// ============================================================

const SUPABASE_URL = 'https://sapeipppwfuezesoadjg.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhcGVpcHBwd2Z1ZXplc29hZGpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDI2NjAsImV4cCI6MjA5MDExODY2MH0.fusS-pw1thAHOcVxjFlFEAWHeP9zN4Q4BoN4TJ9qfv4'

// インストール時: 毎時0分のアラームを設定
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('updateCatch', {
    delayInMinutes: 1,
    periodInMinutes: 60
  })
  console.log('[Lay. Catch Board] インストール完了。毎時0分に自動実行します。')

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

// アラーム発火時: 更新処理を実行
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
    return true
  }
  if (message.action === 'getStatus') {
    chrome.storage.local.get(['lastResult', 'lastRun', 'nextRunTime', 'nextPredictedCatch'], (result) => {
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
  let generatedCatch = null
  let nextPredictedCatch = null
  let errorMessage = null
  const slotsCache = {} // 日付文字列 → スロット配列（タブ再利用のため共有）

  try {
    const settings = await getSettings()
    if (!settings.isActive) {
      console.log('[Lay. Catch Board] 自動更新が無効になっています')
      return
    }

    const now = new Date()
    console.log('[Lay. Catch Board] 実行開始:', now.toLocaleTimeString('ja-JP'))

    // Step1: 現在時刻基準でキャッチ生成
    const currentResult = await selectBestSlot(now, slotsCache, settings)
    generatedCatch = currentResult.catchText
    status = currentResult.hasSlot ? 'success' : 'no_slots'
    console.log('[Lay. Catch Board] 現在のキャッチ:', generatedCatch)

    // Step2: 次回実行（+1時間）のキャッチを予測（キャッシュ再利用でタブなし）
    const nextRun = new Date(now.getTime() + 60 * 60 * 1000)
    const nextResult = await selectBestSlot(nextRun, slotsCache, settings)
    nextPredictedCatch = nextResult.catchText
    console.log('[Lay. Catch Board] 次回予測キャッチ:', nextPredictedCatch)

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

    // 次回アラーム時刻を取得
    const nextAlarm = await new Promise(resolve => chrome.alarms.get('updateCatch', resolve))
    const nextRunTime = nextAlarm?.scheduledTime
      ? new Date(nextAlarm.scheduledTime).toISOString()
      : null

    // Supabaseにログ保存
    await logToSupabase({
      status,
      available_slots: null,
      generated_catch: generatedCatch,
      error_message: errorMessage,
      duration_ms: durationMs
    })

    // ローカルストレージに最終結果を保存
    chrome.storage.local.set({
      lastResult: { status, generatedCatch, errorMessage, durationMs },
      lastRun: new Date().toISOString(),
      nextRunTime,
      nextPredictedCatch
    })

    console.log(`[Lay. Catch Board] 完了 [${status}] ${durationMs}ms`)
  }
}

// ============================================================
// スロット選択（キャッシュ付き・最大7日先まで探索）
// ============================================================
async function selectBestSlot(referenceTime, slotsCache, settings) {
  const hour = referenceTime.getHours()
  const refMinutes = hour * 60 + referenceTime.getMinutes()
  const MIN_GAP = 120 // 2時間
  const startDayOffset = hour >= 19 ? 1 : 0 // 19時以降は翌日から

  for (let dayOffset = startDayOffset; dayOffset <= 7; dayOffset++) {
    const targetDate = new Date(referenceTime)
    targetDate.setDate(targetDate.getDate() + dayOffset)

    // 日付キー（例: "20260328"）
    const y = targetDate.getFullYear()
    const mo = String(targetDate.getMonth() + 1).padStart(2, '0')
    const d = String(targetDate.getDate()).padStart(2, '0')
    const dateKey = `${y}${mo}${d}`

    // キャッシュになければフェッチ（タブ開く）、あれば再利用
    if (slotsCache[dateKey] === undefined) {
      slotsCache[dateKey] = await getAvailableSlots(targetDate)
      console.log(`[Lay. Catch Board] フェッチ ${dateKey}:`, slotsCache[dateKey])
    } else {
      console.log(`[Lay. Catch Board] キャッシュ使用 ${dateKey}`)
    }

    const slots = slotsCache[dateKey]

    // 当日のみ2時間制限を適用
    let validSlots = slots
    if (dayOffset === 0) {
      validSlots = slots.filter(slot => {
        const [h, m] = slot.split(':').map(Number)
        return (h * 60 + m) - refMinutes >= MIN_GAP
      })
    }

    if (validSlots.length > 0) {
      const selectedSlot = validSlots[0]

      // プレフィックス（本日 / 明日 / 月/日）
      let catchPrefix
      if (dayOffset === 0) catchPrefix = '本日'
      else if (dayOffset === 1) catchPrefix = '明日'
      else catchPrefix = `${targetDate.getMonth() + 1}/${targetDate.getDate()}`

      // キャッチ生成
      const [h, m] = selectedSlot.split(':').map(Number)
      const timeLabel = m === 0 ? `${h}時` : `${h}時${m}分`
      let catchText = settings.template.replace('本日', catchPrefix).replace('{TIME}', timeLabel)
      if (countChars(catchText) > 50) {
        catchText = settings.template.replace('本日', catchPrefix).replace('{TIME}', `${h}時`)
      }

      return { catchText, hasSlot: true, slot: selectedSlot, prefix: catchPrefix }
    }
  }

  // 7日先まで空きなし
  return { catchText: settings.fallback, hasSlot: false, slot: null, prefix: null }
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
async function getAvailableSlots(date = new Date()) {
  // JST日付文字列を生成（ローカル時刻ベース）
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const dateStr = `${y}${mo}${d}`
  const url = `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=${dateStr}`

  const tab = await chrome.tabs.create({ url, active: false })

  try {
    await waitForTabLoad(tab.id)

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const slots = []

        try {
          const table = document.querySelector('table')
          if (!table) return []

          const rows = table.querySelectorAll('tr')
          let timeHeaders = []
          let availableRow = null

          for (const row of rows) {
            const cells = row.querySelectorAll('th, td')
            const firstCell = cells[0]?.textContent?.trim() || ''

            if (firstCell === '' && cells.length > 2) {
              const possibleTimes = Array.from(cells).map(c => c.textContent.trim())
              if (possibleTimes.some(t => /^\d{1,2}:\d{2}$/.test(t))) {
                timeHeaders = possibleTimes
              }
            }

            if (firstCell.includes('残り受付可能数') || firstCell.includes('受付可能')) {
              availableRow = row
            }
          }

          if (availableRow && timeHeaders.length > 0) {
            const cells = availableRow.querySelectorAll('td')
            cells.forEach((cell, idx) => {
              const val = parseInt(cell.textContent.trim())
              const time = timeHeaders[idx + 1]
              if (!isNaN(val) && val > 0 && time && /^\d{1,2}:\d{2}$/.test(time)) {
                slots.push(time)
              }
            })
          }

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
        let catchInput = document.getElementById('idSalonTopCatch')

        if (!catchInput) {
          catchInput = document.querySelector('input[name*="catch"], input[name*="Catch"], input[name*="CATCH"]')
        }

        if (!catchInput) {
          const inputs = document.querySelectorAll('input[type="text"]')
          for (const input of inputs) {
            if (input.value?.includes('空きあり') || input.value?.includes('空き') || input.value?.includes('予約')) {
              catchInput = input
              break
            }
          }
        }

        if (!catchInput) return { success: false, error: 'キャッチフィールドが見つかりません' }

        catchInput.focus()
        catchInput.select()
        catchInput.value = text
        catchInput.dispatchEvent(new Event('input', { bubbles: true }))
        catchInput.dispatchEvent(new Event('change', { bubbles: true }))

        if (typeof doRegister === 'function') {
          doRegister(new Event('click'))
          return { success: true, catchText: text, method: 'doRegister()' }
        }

        const registerLink = document.querySelector('a[onclick*="doRegister"]')
        if (registerLink) {
          registerLink.click()
          return { success: true, catchText: text, method: 'a[doRegister].click()' }
        }

        const torokuImg = document.querySelector('img[src*="toroku"]')
        if (torokuImg) {
          torokuImg.closest('a')?.click() || torokuImg.click()
          return { success: true, catchText: text, method: 'toroku img click' }
        }

        const form = catchInput.closest('form')
        if (form) {
          form.submit()
          return { success: true, catchText: text, method: 'form.submit()' }
        }

        return { success: false, error: '登録ボタンが見つかりません' }
      },
      args: [catchText]
    })

    if (!result[0]?.result?.success) {
      throw new Error(result[0]?.result?.error || 'キャッチ更新失敗')
    }

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
        const rows = document.querySelectorAll('tr')

        for (const row of rows) {
          const rowText = row.textContent || ''
          if (rowText.includes('スタイル掲載情報') && !rowText.includes('スタイリスト')) {
            const btns = row.querySelectorAll('input[type="submit"], button, a')
            for (const btn of btns) {
              const label = btn.value || btn.textContent || ''
              if (!btn.disabled && label.includes('反映申請')) {
                btn.click()
                return { clicked: true, row: 'スタイル掲載情報' }
              }
            }
          }
        }

        const allLinks = document.querySelectorAll('input[type="submit"], button, a')
        for (const btn of allLinks) {
          const label = btn.value || btn.textContent || ''
          if (!btn.disabled && label.includes('反映申請')) {
            btn.click()
            return { clicked: true, row: 'fallback' }
          }
        }

        return { clicked: false }
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
async function waitForTabLoad(tabId, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab) throw new Error('タブが見つかりません')
    if (tab.status === 'complete') {
      await sleep(1500)
      return
    }
    await sleep(500)
  }
  throw new Error('タブ読み込みタイムアウト')
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
