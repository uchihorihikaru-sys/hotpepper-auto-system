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

    // ============================================================
    // Step1: 実行時間帯に応じたスロット選択ロジック
    // ・7時〜18時 → 当日優先（2時間以上先のみ有効）→ なければ翌日以降
    // ・19時〜24時 → 翌日優先 → なければ翌々日以降
    // ・空きがなければ最大7日先まで検索 → 「○月○日 ○時」で表示
    // ============================================================
    const now = new Date()
    const hour = now.getHours()
    const nowMinutes = hour * 60 + now.getMinutes()
    const MIN_GAP_MINUTES = 120 // 2時間前まで反映

    let selectedSlot = null
    let catchPrefix = '本日'
    let startDayOffset = 0 // 何日後から探し始めるか

    if (hour >= 19) {
      // 19時〜24時 → 翌日から探す
      startDayOffset = 1
    }

    // 最大7日先まで空き枠を探す
    for (let dayOffset = startDayOffset; dayOffset <= 7; dayOffset++) {
      const targetDate = new Date(now)
      targetDate.setDate(targetDate.getDate() + dayOffset)

      const slots = await getAvailableSlots(targetDate)
      console.log(`[Lay. Catch Board] ${dayOffset}日後スロット:`, slots)

      let validSlots = slots

      // 当日（dayOffset=0）のみ2時間制限を適用
      if (dayOffset === 0) {
        validSlots = slots.filter(slot => {
          const [h, m] = slot.split(':').map(Number)
          return (h * 60 + m) - nowMinutes >= MIN_GAP_MINUTES
        })
      }

      if (validSlots.length > 0) {
        selectedSlot = validSlots[0]
        availableSlots = validSlots

        // プレフィックス決定
        if (dayOffset === 0) {
          catchPrefix = '本日'
        } else if (dayOffset === 1) {
          catchPrefix = '明日'
        } else {
          // 翌々日以降 → 「○月○日」形式
          const mo = targetDate.getMonth() + 1
          const d = targetDate.getDate()
          catchPrefix = `${mo}/${d}`
        }

        console.log(`[Lay. Catch Board] 選択スロット: ${catchPrefix} ${selectedSlot}`)
        break
      }
    }

    // Step2: キャッチコピー生成
    if (selectedSlot) {
      const [h, m] = selectedSlot.split(':').map(Number)
      const timeLabel = m === 0 ? `${h}時` : `${h}時${m}分`

      // 「本日」部分をcatchPrefixに置き換え
      generatedCatch = settings.template
        .replace('本日', catchPrefix)
        .replace('{TIME}', timeLabel)

      // 文字数チェック（50文字以内）
      if (countChars(generatedCatch) > 50) {
        generatedCatch = settings.template
          .replace('本日', catchPrefix)
          .replace('{TIME}', `${h}時`)
      }
      status = 'success'
    } else {
      // 7日先まで探して空きなし → フォールバック
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
        // キャッチフィールドを探す（id優先）
        let catchInput = document.getElementById('idSalonTopCatch')

        if (!catchInput) {
          // フォールバック: name属性にcatchを含む
          catchInput = document.querySelector('input[name*="catch"], input[name*="Catch"], input[name*="CATCH"]')
        }

        if (!catchInput) {
          // フォールバック: 既存値から探す
          const inputs = document.querySelectorAll('input[type="text"]')
          for (const input of inputs) {
            if (input.value?.includes('空きあり') || input.value?.includes('空き') || input.value?.includes('予約')) {
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

        // 登録ボタン: サロンボードは <a onclick="doRegister(event)"> + 画像
        // パターン1: doRegister関数を直接呼び出す（最確実）
        if (typeof doRegister === 'function') {
          doRegister(new Event('click'))
          return { success: true, catchText: text, method: 'doRegister()' }
        }

        // パターン2: onclick="doRegister" の <a> タグをクリック
        const registerLink = document.querySelector('a[onclick*="doRegister"]')
        if (registerLink) {
          registerLink.click()
          return { success: true, catchText: text, method: 'a[doRegister].click()' }
        }

        // パターン3: 登録画像ボタン（toroku）を探す
        const torokuImg = document.querySelector('img[src*="toroku"]')
        if (torokuImg) {
          torokuImg.closest('a')?.click() || torokuImg.click()
          return { success: true, catchText: text, method: 'toroku img click' }
        }

        // パターン4: フォームをsubmit
        const form = catchInput.closest('form')
        if (form) {
          form.submit()
          return { success: true, catchText: text, method: 'form.submit()' }
        }

        return { success: false, error: '登録ボタンが見つかりません（doRegister/toroku/form いずれも未発見）' }
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
        // サロンボードの反映申請ボタンを探してクリック
        // ※ 仕様: スタイル掲載情報行の「反映申請」ボタンがお店全体を一括反映する
        const rows = document.querySelectorAll('tr')

        // 優先1: スタイル掲載情報行（お店全体の一括反映ボタン）
        for (const row of rows) {
          const firstCell = row.querySelector('td, th')?.textContent?.trim() || ''
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

        // 優先2: ページ内で有効な反映申請ボタンを順に試す
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
      await sleep(1500) // DOMが安定するまで追加待機
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
