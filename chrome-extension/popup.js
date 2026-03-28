// ストレージから状態を読み込んで表示
function loadAndDisplay() {
  chrome.storage.local.get(['lastResult', 'lastRun', 'isActive', 'nextRunTime', 'nextPredictedCatch'], (data) => {

    // ── 最新実行キャッチ ──
    const catchEl = document.getElementById('lastCatch')
    const statusEl = document.getElementById('lastStatus')
    const runEl = document.getElementById('lastRun')

    if (data.lastResult?.generatedCatch) {
      catchEl.textContent = data.lastResult.generatedCatch
    }

    if (data.lastResult?.status) {
      const labels = { success: '成功', error: 'エラー', no_slots: '空きなし' }
      const classes = { success: 'badge-success', error: 'badge-error', no_slots: 'badge-no_slots' }
      const s = data.lastResult.status
      statusEl.innerHTML = `<span class="badge ${classes[s] || ''}">${labels[s] || s}</span>`
    }

    if (data.lastRun) {
      const d = new Date(data.lastRun)
      runEl.textContent = d.toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }) + ' 実行'
    }

    // ── 次回予測キャッチ ──
    const nextCatchEl = document.getElementById('nextCatch')
    const nextTimeEl = document.getElementById('nextRunTime')

    if (data.nextPredictedCatch) {
      nextCatchEl.textContent = data.nextPredictedCatch
    }

    if (data.nextRunTime) {
      const next = new Date(data.nextRunTime)
      nextTimeEl.textContent = '次回実行: ' + next.toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    }

    // ── 自動更新トグル ──
    document.getElementById('isActive').checked = data.isActive !== false
  })
}

// 初回読み込み
loadAndDisplay()

// 自動更新トグル変更
document.getElementById('isActive').addEventListener('change', (e) => {
  chrome.storage.local.set({ isActive: e.target.checked })
})

// 今すぐ実行ボタン
document.getElementById('runNow').addEventListener('click', () => {
  const btn = document.getElementById('runNow')
  const msg = document.getElementById('msg')
  btn.disabled = true
  btn.textContent = '実行中...'
  msg.textContent = ''

  chrome.runtime.sendMessage({ action: 'runNow' }, () => {
    btn.disabled = false
    btn.textContent = '今すぐ実行'
    msg.textContent = '実行完了！'
    setTimeout(() => { msg.textContent = '' }, 3000)

    // 2秒後に表示を更新
    setTimeout(loadAndDisplay, 2000)
  })
})

// 管理画面を開く
document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hotpepper-auto-system.vercel.app' })
})

// ── EmailJS設定 ──────────────────────────────
// 折りたたみトグル
document.getElementById('emailjsToggle').addEventListener('click', () => {
  const toggle = document.getElementById('emailjsToggle')
  const panel = document.getElementById('emailjsPanel')
  toggle.classList.toggle('open')
  panel.classList.toggle('open')
})

// 保存済み値を読み込む
chrome.storage.local.get(['emailjsUserId', 'emailjsServiceId', 'emailjsTemplateId'], (data) => {
  if (data.emailjsUserId) document.getElementById('emailjsUserId').value = data.emailjsUserId
  if (data.emailjsServiceId) document.getElementById('emailjsServiceId').value = data.emailjsServiceId
  if (data.emailjsTemplateId) document.getElementById('emailjsTemplateId').value = data.emailjsTemplateId
  // 設定済みならパネルを開く
  if (data.emailjsUserId || data.emailjsServiceId || data.emailjsTemplateId) {
    document.getElementById('emailjsToggle').classList.add('open')
    document.getElementById('emailjsPanel').classList.add('open')
  }
})

// テスト送信ボタン（ポップアップから直接EmailJS APIを呼び出す）
document.getElementById('testEmailjs').addEventListener('click', async () => {
  const btn = document.getElementById('testEmailjs')
  const msg = document.getElementById('emailjsTestMsg')
  btn.disabled = true
  btn.textContent = '送信中...'
  msg.style.display = 'none'

  try {
    const userId    = document.getElementById('emailjsUserId').value.trim()
    const serviceId = document.getElementById('emailjsServiceId').value.trim()
    const templateId = document.getElementById('emailjsTemplateId').value.trim()

    if (!userId || !serviceId || !templateId) {
      throw new Error('User ID / Service ID / Template ID を入力してください')
    }

    const timeStr = new Date().toLocaleString('ja-JP')
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: userId,
        template_params: {
          to_email: 'hika_hika19@yahoo.co.jp',
          error_time: timeStr,
          message: '【テスト】サロンボードへのログインに失敗しました。IDとパスワードを更新してください。'
        }
      })
    })

    if (res.ok) {
      msg.textContent = '✓ テストメールを送信しました！'
      msg.style.color = '#2e7d32'
    } else {
      const text = await res.text()
      throw new Error(`EmailJS エラー(${res.status}): ${text}`)
    }
  } catch (e) {
    msg.textContent = '⚠ ' + e.message
    msg.style.color = '#c62828'
  } finally {
    btn.disabled = false
    btn.textContent = '📧 テスト送信'
    msg.style.display = 'block'
    setTimeout(() => { msg.style.display = 'none' }, 5000)
  }
})

// 保存ボタン
document.getElementById('saveEmailjs').addEventListener('click', () => {
  const userId = document.getElementById('emailjsUserId').value.trim()
  const serviceId = document.getElementById('emailjsServiceId').value.trim()
  const templateId = document.getElementById('emailjsTemplateId').value.trim()

  chrome.storage.local.set({
    emailjsUserId: userId,
    emailjsServiceId: serviceId,
    emailjsTemplateId: templateId
  }, () => {
    const saveMsg = document.getElementById('emailjsSaveMsg')
    saveMsg.style.display = 'block'
    setTimeout(() => { saveMsg.style.display = 'none' }, 2000)
  })
})
