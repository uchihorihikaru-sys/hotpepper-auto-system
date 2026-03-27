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
