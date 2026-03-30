// ============================================================
// Lay. Catch Board - バックグラウンドサービスワーカー
// Chromeのアラーム機能で毎時0分に自動実行
// ============================================================

const SUPABASE_URL = 'https://sapeipppwfuezesoadjg.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhcGVpcHBwd2Z1ZXplc29hZGpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDI2NjAsImV4cCI6MjA5MDExODY2MH0.fusS-pw1thAHOcVxjFlFEAWHeP9zN4Q4BoN4TJ9qfv4'

// 通知メール送信先（固定）
const NOTIFY_EMAIL = 'hika_hika19@yahoo.co.jp'

// インストール時: 毎時0分のアラームを設定
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('updateCatch', {
    delayInMinutes: 1,
    periodInMinutes: 60
  })
  console.log('[Lay. Catch Board] インストール完了。毎時0分に自動実行します。')

  chrome.storage.local.get(['template', 'fallback', 'isActive', 'emailjsUserId'], (result) => {
    const defaults = {}
    if (!result.template) {
      defaults.template = '【本日{TIME}空きあり】《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎'
      defaults.fallback = '《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪'
      defaults.isActive = true
    }
    // EmailJS設定（未設定の場合のみ初期値をセット）
    if (!result.emailjsUserId) {
      defaults.emailjsUserId = 'KFVrXmIEuOdqivuIj'
      defaults.emailjsServiceId = 'service_bxoa9nm'
      defaults.emailjsTemplateId = 'template_imay9e8'
    }
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults)
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
  if (message.action === 'testLoginFailure') {
    // 1時間dedup解除してからテスト送信
    chrome.storage.local.remove('lastLoginFailureNotify', () => {
      notifyLoginFailure().then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }))
    })
    return true
  }
})

// Service Worker起動時にEmailJS設定を確認・補完
chrome.storage.local.get(['emailjsUserId'], (result) => {
  if (!result.emailjsUserId) {
    chrome.storage.local.set({
      emailjsUserId: 'KFVrXmIEuOdqivuIj',
      emailjsServiceId: 'service_bxoa9nm',
      emailjsTemplateId: 'template_imay9e8'
    })
    console.log('[Lay. Catch Board] EmailJS設定を自動セットしました')
  }
})

// ============================================================
// サロンボード 自動ログイン
// ============================================================
async function tryAutoLogin(tabId, loginId, password) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (id, pw) => {
        const idInput = document.querySelector('input[name="LOGIN_ID"], input[type="text"][name*="id"], input[type="text"][name*="ID"], #LOGIN_ID')
        const pwInput = document.querySelector('input[type="password"]')
        if (!idInput || !pwInput) return { success: false, error: 'ログインフォームが見つかりません' }

        idInput.value = id
        idInput.dispatchEvent(new Event('input', { bubbles: true }))
        pwInput.value = pw
        pwInput.dispatchEvent(new Event('input', { bubbles: true }))

        const submitBtn = document.querySelector('input[type="submit"], button[type="submit"], a[onclick*="login"], a[onclick*="Login"]')
        if (submitBtn) {
          submitBtn.click()
          return { success: true }
        }
        const form = idInput.closest('form')
        if (form) { form.submit(); return { success: true } }
        return { success: false, error: '送信ボタンが見つかりません' }
      },
      args: [loginId, password]
    })

    if (!result[0]?.result?.success) return false

    // ページ遷移を待つ（最大10秒）
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      try {
        const info = await chrome.tabs.get(tabId)
        const url = info.url || ''
        if (url.includes('salonboard.com/CNB/') && !url.includes('/login') && !url.includes('/Login')) return true
        // エラーページならあきらめる
        if (url.startsWith('chrome-error://') || url === '') break
        // ログインエラーページ（IDかPWが違う）→ 即失敗
        if (url.includes('login') || url.includes('Login')) {
          try {
            const html = await chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: () => document.body?.innerText || ''
            })
            const text = html[0]?.result || ''
            if (text.includes('パスワード') || text.includes('エラー') || text.includes('違い')) return false
          } catch (_) { /* executeScriptエラーは無視 */ }
        }
      } catch (_) {
        break // タブが消えた or エラーページ → ループ終了
      }
    }
    return false
  } catch (e) {
    console.error('[Lay. Catch Board] 自動ログインエラー:', e)
    return false
  }
}

// 通知クリック → メール作成画面を開く
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'loginFailed') {
    const subject = encodeURIComponent('【Lay. Catch Board】サロンボードのログイン情報を更新してください')
    const body = encodeURIComponent(
      'サロンボードへのログインに失敗しました。\n\n' +
      'IDまたはパスワードが変更されている可能性があります。\n' +
      'Chrome拡張機能の設定からログイン情報を更新してください。\n\n' +
      '送信時刻: ' + new Date().toLocaleString('ja-JP')
    )
    chrome.tabs.create({ url: `mailto:${NOTIFY_EMAIL}?subject=${subject}&body=${body}` })
    chrome.notifications.clear('loginFailed')
  }
})

// ============================================================
// ログイン失敗を検知してメール通知（1時間に1回まで）
// ============================================================
async function notifyLoginFailure() {
  // 1時間以内に通知済みならスキップ
  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['lastLoginFailureNotify'], resolve)
  )
  const lastNotify = stored.lastLoginFailureNotify || 0
  const now = Date.now()
  if (now - lastNotify < 60 * 60 * 1000) {
    console.log('[Lay. Catch Board] ログイン失敗通知: 1時間以内に送信済みのためスキップ')
    return
  }

  // 最終通知時刻を保存
  await chrome.storage.local.set({ lastLoginFailureNotify: now })

  const timeStr = new Date().toLocaleString('ja-JP')
  console.log('[Lay. Catch Board] ログイン失敗通知を送信します')

  // ① Chromeデスクトップ通知
  chrome.notifications.create('loginFailed', {
    type: 'basic',
    iconUrl: 'icon48.png',
    title: '⚠️ サロンボード ログインエラー',
    message: 'ログインできません。IDとパスワードの更新が必要です。クリックしてメールを作成。',
    priority: 2
  })

  // ② EmailJS経由で自動メール送信（設定済みの場合）
  const emailSettings = await new Promise(resolve =>
    chrome.storage.local.get(['emailjsUserId', 'emailjsServiceId', 'emailjsTemplateId'], resolve)
  )

  if (emailSettings.emailjsUserId && emailSettings.emailjsServiceId && emailSettings.emailjsTemplateId) {
    try {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: emailSettings.emailjsServiceId,
          template_id: emailSettings.emailjsTemplateId,
          user_id: emailSettings.emailjsUserId,
          template_params: {
            to_email: NOTIFY_EMAIL,
            error_time: timeStr,
            message: 'サロンボードへのログインに失敗しました。IDとパスワードを更新してください。'
          }
        })
      })
      console.log('[Lay. Catch Board] ログイン失敗メール送信完了')
    } catch (e) {
      console.error('[Lay. Catch Board] メール送信エラー:', e)
    }
  }

  // SupabaseにもログINできないことをlLogin_failedとして記録
  await logToSupabase({
    status: 'error',
    available_slots: null,
    generated_catch: null,
    error_message: `ログイン失敗: ${timeStr} / ${NOTIFY_EMAIL}に通知済み`,
    duration_ms: 0
  })
}

// ============================================================
// メイン処理
// ============================================================
async function runUpdate() {
  const startTime = Date.now()
  let status = 'error'
  let generatedCatch = null
  let nextPredictedCatch = null
  let errorMessage = null
  let variantIndex = 0
  let foundSlots = null // ログ保存用（実際に取得したスロット）
  let targetDateLabel = null // ログ保存用（本日/明日/3月31日など）
  let savedBaseCatch = null // 比較用（バリアント前の純粋なキャッチ）
  const slotsCache = {} // 毎回リセット → 常に最新データを取得

  try {
    const settings = await getSettings()
    if (!settings.isActive) {
      console.log('[Lay. Catch Board] 自動更新が無効になっています')
      return
    }

    const now = new Date()
    console.log('[Lay. Catch Board] 実行開始:', now.toLocaleTimeString('ja-JP'))

    // Step1: 現在時刻基準でキャッチ生成（常に最新スロットをフェッチ）
    const currentResult = await selectBestSlot(now, slotsCache, settings)
    // フェッチした全スロットをログ用に収集
    foundSlots = Object.values(slotsCache).flat()
    targetDateLabel = currentResult.prefix || null // ログ保存用に退避
    const baseCatch = currentResult.catchText
    savedBaseCatch = baseCatch // finallyで参照できるよう外側変数に退避
    status = currentResult.hasSlot ? 'success' : 'no_slots'
    console.log('[Lay. Catch Board] ベースキャッチ:', baseCatch)

    // Step2: 前回と同一テキストの場合は1文字変えて強制更新
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(['lastBaseCatch', 'catchVariantIndex'], resolve)
    )
    const lastBaseCatch = stored.lastBaseCatch || ''
    variantIndex = stored.catchVariantIndex || 0

    if (baseCatch === lastBaseCatch) {
      variantIndex = (variantIndex % 4) + 1  // 1→2→3→4→1... と循環
      generatedCatch = applyVariation(baseCatch, variantIndex)
      console.log('[Lay. Catch Board] 同一キャッチのため語尾変更 (variant', variantIndex, '):', generatedCatch)
    } else {
      variantIndex = 0
      generatedCatch = baseCatch
    }

    // Step3: 次回実行（+1時間）のキャッチを予測（キャッシュ再利用でタブなし）
    const nextRun = new Date(now.getTime() + 60 * 60 * 1000)
    const nextResult = await selectBestSlot(nextRun, slotsCache, settings)
    nextPredictedCatch = nextResult.catchText
    console.log('[Lay. Catch Board] 次回予測キャッチ:', nextPredictedCatch)

    // Step4: サロンボードのキャッチを更新
    await updateCatchOnSalonBoard(generatedCatch)

    // Step5: 反映申請
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

    // Supabaseにログ保存（available_slots に実際のスロットデータを記録）
    await logToSupabase({
      status,
      available_slots: foundSlots && foundSlots.length > 0 ? foundSlots : null,
      generated_catch: generatedCatch,
      error_message: errorMessage,
      duration_ms: durationMs,
      target_date_label: targetDateLabel
    })

    // ローカルストレージに最終結果を保存（バリアント情報も含む）
    await chrome.storage.local.set({
      lastResult: { status, generatedCatch, errorMessage, durationMs },
      lastRun: new Date().toISOString(),
      nextRunTime,
      nextPredictedCatch,
      lastBaseCatch: savedBaseCatch,  // バリアント前の純粋なキャッチを保存（比較用）
      catchVariantIndex: variantIndex
    })

    console.log(`[Lay. Catch Board] 完了 [${status}] ${durationMs}ms`)
  }
}

// ============================================================
// スロット選択（キャッシュ付き・最大7日先まで探索）
// ルール:
//   - 7:00〜18:59 → 当日の空き / 19:00〜 → 翌日の空き
//   - 実行時刻 + 2時間 以降の枠のみ反映
//   - 表示は整時（XX:00）のみ。半端な枠は除外
// ============================================================
async function selectBestSlot(referenceTime, slotsCache, settings) {
  const hour = referenceTime.getHours()
  const refMinutes = hour * 60 + referenceTime.getMinutes()
  const startDayOffset = hour >= 19 ? 1 : 0 // 19時以降は翌日から

  // 実行時刻 + 2時間 以降の枠のみ反映
  // 例: 10:00実行 → cutoff=12:00 / 10:30実行 → cutoff=12:30
  const cutoffHour = refMinutes + 120 // 分単位（cutoff以降の枠を対象）

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
      try {
        slotsCache[dateKey] = await getAvailableSlots(targetDate)
      } catch (e) {
        // 1日の取得失敗は致命的エラーにしない → 空配列として次の日付を試す
        console.warn(`[Lay. Catch Board] ${dateKey} スロット取得失敗（スキップ）:`, e.message)
        slotsCache[dateKey] = []
      }
      console.log(`[Lay. Catch Board] フェッチ ${dateKey}:`, slotsCache[dateKey])
    } else {
      console.log(`[Lay. Catch Board] キャッシュ使用 ${dateKey}`)
    }

    const slots = slotsCache[dateKey]

    // 当日: cutoffHour(分) 以降に限定（翌日以降は全枠対象）
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

    const timeFiltered = dayOffset === 0
      ? slots.filter(s => toMin(s) >= cutoffHour)
      : [...slots]

    // 連続した空き時間が60分以上ある枠のみを抽出
    // 例: [12:00, 12:30, 13:00] → 12:00は連続90分 → OK
    //     [12:30] のみ → 30分のみ → NG
    const validSlots = filterContinuousHour(timeFiltered)

    if (validSlots.length > 0) {
      const selectedSlot = validSlots[0]

      // プレフィックス（本日 / 明日 / 月/日）
      let catchPrefix
      if (dayOffset === 0) catchPrefix = '本日'
      else if (dayOffset === 1) catchPrefix = '明日'
      else catchPrefix = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`

      // キャッチ生成（50文字制限に合わせて段階的に短縮）
      const [h, m] = selectedSlot.split(':').map(Number)
      const timeLabel = m === 0 ? `${h}時` : `${h}時${m}分`
      let catchText = fitToLimit(settings.template, catchPrefix, timeLabel, h)

      return { catchText, hasSlot: true, slot: selectedSlot, prefix: catchPrefix }
    }
  }

  // 7日先まで空きなし
  const fallback = settings.fallback.slice(0, 50)
  return { catchText: fallback, hasSlot: false, slot: null, prefix: null }
}

// ============================================================
// 文字数制限（50文字）に収まるよう段階的に装飾文字を削除
// 削除順: ①絵文字・記号 → ②《》 → ③【】 → ④[] → ⑤強制カット
// 時間ラベル（例: 本日10時）は必ず保持
// ============================================================
function fitToLimit(template, prefix, timeLabel) {
  const LIMIT = 50
  let text = template.replace('本日', prefix).replace('{TIME}', timeLabel)
  if (text.length <= LIMIT) return text

  const steps = [
    // ① 末尾の装飾記号を削除（◎♪★☆♡ など）
    t => t.replace(/[◎◯○●★☆♪♡♥✨💫⭐🌟]/g, ''),
    // ② 《》を外して中身だけ残す
    t => t.replace(/《(.*?)》/g, '$1'),
    // ③ 【】を外して中身だけ残す
    t => t.replace(/【(.*?)】/g, '$1'),
    // ④ []・［］を外して中身だけ残す
    t => t.replace(/[\[［](.*?)[\]］]/g, '$1'),
    // ⑤ 連続スペースを1つに整理
    t => t.replace(/\s+/g, ' ').trim(),
  ]

  for (const step of steps) {
    text = step(text)
    if (text.length <= LIMIT) return text
  }

  // 最終手段：50文字で強制カット
  return text.slice(0, LIMIT)
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

    // ログインページへのリダイレクトを検知（セッション切れ対策）
    const tabInfo = await chrome.tabs.get(tab.id).catch(() => null)
    const actualUrl = tabInfo?.url || ''
    if (actualUrl.includes('/login') || actualUrl.includes('/Login') || actualUrl.includes('login.do')) {
      console.warn(`[Lay. Catch Board] ${dateStr}: ログインページにリダイレクトされました（セッション切れ）`)
      return []
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        try {
          const rows = document.querySelectorAll('tr')
          let timeSlots = []
          let availCounts = []

          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('th, td'))
            const firstText = (cells[0]?.textContent || '').trim()

            // 時間ヘッダー行を探す（"予約を隠す" が最初のセル）
            if (firstText.includes('予約を隠す') && timeSlots.length === 0) {
              for (let i = 1; i < cells.length - 1; i++) {
                const t = cells[i].textContent.trim()
                const colspan = parseInt(cells[i].getAttribute('colspan') || '1')
                if (/^\d{1,2}:\d{2}$/.test(t)) {
                  const [h, m] = t.split(':').map(Number)
                  timeSlots.push(`${h}:${String(m).padStart(2,'0')}`)
                  if (colspan >= 2 && m === 0) {
                    // colspan=2 かつ XX:00 の場合のみ :30 を追加（XX:30 の重複防止）
                    timeSlots.push(`${h}:30`)
                  }
                }
              }
            }

            // 空き数行: "残り受付数" を含む行（スタッフ個別行は除外）
            if (firstText.includes('残り受付数') && !firstText.includes('受付可能数：') && availCounts.length === 0) {
              for (let i = 1; i < cells.length - 1; i++) {
                const val = parseInt(cells[i].textContent.trim())
                if (!isNaN(val)) availCounts.push(val)
              }
            }
          }

          // 時間スロットと空き数をマッピング
          const slots = []
          for (let i = 0; i < Math.min(timeSlots.length, availCounts.length); i++) {
            if (availCounts[i] > 0) slots.push(timeSlots[i])
          }

          return {
            slots: [...new Set(slots)].sort(),
            _debug: { timeSlots, availCounts, url: window.location.href }
          }
        } catch (e) {
          return { slots: [], _debug: { error: e.message } }
        }
      }
    })

    const res = results[0]?.result
    // デバッグ情報をService Workerのコンソールに出力
    if (res?._debug) {
      const d = res._debug
      console.log(`[Lay. Catch Board] ${dateStr} DOM解析: timeSlots=${d.timeSlots?.length ?? '?'} availCounts=${d.availCounts?.length ?? '?'} 空き=${res.slots?.length ?? 0}`, res.slots)
      if (d.error) console.warn(`[Lay. Catch Board] ${dateStr} DOM解析エラー:`, d.error)
    }

    return res?.slots || []

  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

// ============================================================
// サロンボードのキャッチを更新
// ============================================================
async function updateCatchOnSalonBoard(catchText) {
  const EDIT_URL = 'https://salonboard.com/CNB/draft/salonEdit/'

  // salonboard.com上の全タブを検索して既存タブを探す
  const allTabs = await chrome.tabs.query({ url: 'https://salonboard.com/*' })
  const editTab = allTabs.find(t => t.url && t.url.includes('/CNB/draft/salonEdit'))
  let tab = null
  let isNewTab = false

  if (editTab) {
    // 既存タブはリロードせずそのまま使用
    console.log('[Lay. Catch Board] 既存タブをそのまま使用:', editTab.id)
    tab = editTab
  } else {
    console.log('[Lay. Catch Board] 新規タブを作成（フォアグラウンド）')
    tab = await chrome.tabs.create({ url: EDIT_URL, active: true })
    isNewTab = true
    await waitForTabLoad(tab.id)
    await sleep(4000)
  }

  // URLを確認してログイン状態をチェック
  const tabInfo = await chrome.tabs.get(tab.id)
  const actualUrl = tabInfo.url || ''
  if (!actualUrl.includes('salonboard.com/CNB/draft/salonEdit')) {
    const isLoginPage = actualUrl.includes('/login') || actualUrl.includes('/Login') || actualUrl.includes('login.do') || actualUrl.includes('Login.do')
    if (isLoginPage) {
      // 保存済みID/PWで自動再ログイン試みる
      const creds = await new Promise(resolve => chrome.storage.local.get(['sbLoginId', 'sbPassword'], resolve))
      if (creds.sbLoginId && creds.sbPassword) {
        console.log('[Lay. Catch Board] 自動再ログイン試みます')
        const loginSuccess = await tryAutoLogin(tab.id, creds.sbLoginId, creds.sbPassword)
        if (loginSuccess) {
          // ログイン成功 → 編集ページへ移動
          await chrome.tabs.update(tab.id, { url: EDIT_URL })
          await waitForTabLoad(tab.id)
          await sleep(2000)
          isNewTab = true // ログイン後タブは処理後に閉じる
        } else {
          // ログイン失敗 → パスワードが変わった
          if (isNewTab) await chrome.tabs.remove(tab.id).catch(() => {})
          await notifyLoginFailure()
          throw new Error('サロンボードのログインに失敗しました。ID/パスワードを更新してください。')
        }
      } else {
        // ID/PW未設定 → メール通知のみ
        if (isNewTab) await chrome.tabs.remove(tab.id).catch(() => {})
        await notifyLoginFailure()
        throw new Error('サロンボードのセッションが切れています。ログインしてください。')
      }
    } else {
      if (isNewTab) await chrome.tabs.remove(tab.id).catch(() => {})
      throw new Error(`ページが正しく読み込まれませんでした: ${actualUrl}`)
    }
  }

  try {

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (text) => {
        // デバッグ情報
        const debugInfo = {
          url: window.location.href,
          title: document.title,
          inputCount: document.querySelectorAll('input').length
        }
        console.log('[Lay. Catch Board] executeScript実行中:', JSON.stringify(debugInfo))

        let catchInput = document.getElementById('idSalonTopCatch')

        if (!catchInput) {
          catchInput = document.querySelector('input[name*="catch"], input[name*="Catch"], input[name*="CATCH"]')
        }

        // maxlength=50 のinput（キャッチフィールドの特徴）
        if (!catchInput) {
          catchInput = document.querySelector('input[maxlength="50"]')
        }

        // textarea版（まれにtextareaの場合）
        if (!catchInput) {
          catchInput = document.querySelector('textarea[maxlength="50"]')
        }

        // ラベル「キャッチ」に近いinput
        if (!catchInput) {
          const labels = document.querySelectorAll('label, th, td')
          for (const label of labels) {
            if (label.textContent?.includes('キャッチ')) {
              const row = label.closest('tr')
              if (row) {
                catchInput = row.querySelector('input[type="text"], textarea')
                if (catchInput) break
              }
            }
          }
        }

        // 既存の値でマッチ（空きあり・営業中・予約など）
        if (!catchInput) {
          const inputs = document.querySelectorAll('input[type="text"], textarea')
          for (const input of inputs) {
            const v = input.value || ''
            if (v.includes('空きあり') || v.includes('営業中') || v.includes('予約がお得')) {
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
    // 新規作成したタブのみ閉じる（既存タブはそのまま）
    if (isNewTab) {
      await chrome.tabs.remove(tab.id).catch(() => {})
    }
  }
}

// ============================================================
// 反映申請ボタンをクリック
// ============================================================
async function clickReflectButton() {
  const REFLECT_URL = 'https://salonboard.com/CNB/reflect/reflectTop/'

  const allTabs = await chrome.tabs.query({ url: 'https://salonboard.com/CNB/reflect/reflectTop/*' })
  let tab = allTabs[0] || null
  let isNewTab = false

  if (tab) {
    await chrome.tabs.reload(tab.id)
    await waitForTabLoad(tab.id)
  } else {
    tab = await chrome.tabs.create({ url: REFLECT_URL, active: true })
    isNewTab = true
    await waitForTabLoad(tab.id)
  }

  try {
    await sleep(1500)

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
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
    if (isNewTab) {
      await chrome.tabs.remove(tab.id).catch(() => {})
    }
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
      // chrome-error:// はサーバー接続失敗のエラーページ → executeScript が失敗するため早期検知
      if (tab.url && tab.url.startsWith('chrome-error://')) {
        throw new Error('サーバーに接続できませんでした（ネットワークエラー）')
      }
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
  return text.length
}

// 50文字制限に収まるよう段階的に短縮
// 時間は正確に保ちつつ、装飾文字から順に削除
function fitToLimit(template, prefix, timeLabel, h) {
  const LIMIT = 50

  // ① まずフルの時刻で試す
  let text = template.replace('本日', prefix).replace('{TIME}', timeLabel)
  if (text.length <= LIMIT) return text

  // ② 装飾文字を段階的に削除（意味への影響が少ない順）
  const steps = [
    // 絵文字・記号類（◎○◯★☆♪♡♥✨💫⭐🌟など）
    t => t.replace(/[◎◯○●★☆♪♡♥✨💫⭐🌟🎵🎶❤️💕🙆‍♀️👍✅🔥💖]/g, ''),
    // 《》を削除（中身は残す）
    t => t.replace(/《([^》]*)》/g, '$1'),
    // 【】を削除（中身は残す）
    t => t.replace(/【([^】]*)】/g, '$1'),
    // ［］[]を削除（中身は残す）
    t => t.replace(/[［\[]([^］\]]*)[］\]]/g, '$1'),
    // 連続スペースを整理
    t => t.replace(/\s+/g, ' ').trim(),
  ]

  for (const step of steps) {
    text = step(text)
    if (text.length <= LIMIT) return text
  }

  // ③ 最終手段：50文字で切り捨て
  return text.slice(0, LIMIT)
}

// 連続した空き時間が60分以上ある枠の「開始時刻」リストを返す
// slots: ソート済み時刻文字列配列 ["10:00","10:30","11:00","14:00"]
// ルール:
//   - SalonBoardは30分刻みスロット
//   - 連続2枠以上（60分以上）のブロックのみ有効
//   - 各ブロックの「最初の時間」だけを返す
// 例: [13:00, 13:30, 14:00, 15:00] → ブロック1=[13:00〜14:30]→13:00, ブロック2=[15:00]→30分のみNG
//     [17:00] 単独 → 30分のみ → スキップ
function filterContinuousHour(slots) {
  if (slots.length === 0) return []
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const sorted = [...slots].sort()
  const mins = sorted.map(toMin)
  const SLOT = 30    // SalonBoardは30分刻み
  const MIN_BLOCK = 60 // 最低1時間（30分スロット×2以上）

  const result = []
  let i = 0

  while (i < sorted.length) {
    // 現在位置から連続するブロックを見つける
    let j = i
    while (j + 1 < mins.length && mins[j + 1] - mins[j] === SLOT) {
      j++
    }

    // ブロック長（分）= スロット数 × 30分
    const blockDuration = (j - i + 1) * SLOT

    if (blockDuration >= MIN_BLOCK) {
      // ブロックの最初の時間だけ追加
      result.push(sorted[i])
    }

    i = j + 1 // 次のブロックへ
  }

  return result
}

// 同一キャッチの場合に1文字だけ変えてサロンボードに「更新」と認識させる
// variant 1: ◎→〇  variant 2: 〇→◎ + ♪→♩  variant 3: ♩→♪ + ◎→〇
function applyVariation(text, variantIndex) {
  const suffixes = ['☆', '◎', '♩', '！']
  const suffix = suffixes[(variantIndex - 1) % suffixes.length]
  // 末尾に既存のサフィックスがあれば除去してから新しいものを追加
  const base = text.replace(/[☆◎♩！]$/, '')
  const result = base + suffix
  return result.length <= 50 ? result : base
}
