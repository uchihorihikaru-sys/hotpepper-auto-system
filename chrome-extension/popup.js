// ポップアップの状態を読み込み
chrome.storage.local.get(['lastResult', 'lastRun', 'isActive'], (data) => {
  // 最終実行時刻
  if (data.lastRun) {
    const d = new Date(data.lastRun)
    document.getElementById('lastRun').textContent =
      d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // 最終結果
  if (data.lastResult) {
    const { status, generatedCatch } = data.lastResult
    const statusEl = document.getElementById('lastStatus')
    const labels = { success: '成功', error: 'エラー', no_slots: '空きなし' }
    const classes = { success: 'badge-success', error: 'badge-error', no_slots: 'badge-no_slots' }
    statusEl.innerHTML = `<span class="badge ${classes[status] || ''}">${labels[status] || status}</span>`

    if (generatedCatch) {
      const catchEl = document.getElementById('lastCatch')
      catchEl.textContent = generatedCatch
      catchEl.style.display = 'block'
    }
  }

  // 自動更新トグル
  document.getElementById('isActive').checked = data.isActive !== false
})

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

  chrome.runtime.sendMessage({ action: 'runNow' }, (res) => {
    btn.disabled = false
    btn.textContent = '今すぐ実行'
    msg.textContent = '実行完了！ログを確認してください。'
    setTimeout(() => { msg.textContent = '' }, 3000)

    // 状態を再読み込み
    setTimeout(() => {
      chrome.storage.local.get(['lastResult', 'lastRun'], (data) => {
        if (data.lastRun) {
          const d = new Date(data.lastRun)
          document.getElementById('lastRun').textContent =
            d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        }
        if (data.lastResult?.generatedCatch) {
          const catchEl = document.getElementById('lastCatch')
          catchEl.textContent = data.lastResult.generatedCatch
          catchEl.style.display = 'block'
        }
      })
    }, 2000)
  })
})

// 管理画面を開く
document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://hotpepper-auto-system.vercel.app' })
})
