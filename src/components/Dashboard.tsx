import { useEffect, useState } from 'react'
import { supabase, type ExecutionLog } from '../lib/supabase'

export function Dashboard() {
  const [latestLog, setLatestLog] = useState<ExecutionLog | null>(null)
  const [todayStats, setTodayStats] = useState({ success: 0, error: 0, no_slots: 0 })
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  useEffect(() => {
    fetchData()
    // 30秒ごとに自動更新
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    const today = new Date().toISOString().split('T')[0]

    const { data: logs } = await supabase
      .from('execution_logs')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(50)

    if (logs && logs.length > 0) {
      setLatestLog(logs[0])

      const todayLogs = logs.filter(l =>
        l.executed_at.startsWith(today)
      )
      const stats = { success: 0, error: 0, no_slots: 0 }
      todayLogs.forEach(l => {
        if (l.status === 'success') stats.success++
        else if (l.status === 'error') stats.error++
        else if (l.status === 'no_slots') stats.no_slots++
      })
      setTodayStats(stats)
    }

    setLoading(false)
  }

  async function handleManualTrigger() {
    setTriggering(true)
    setTriggerMsg('GitHub Actionsをトリガー中...')

    try {
      const res = await fetch(
        `https://api.github.com/repos/uchihorihikaru-sys/hotpepper-auto-system/actions/workflows/auto-update.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_GITHUB_TOKEN || ''}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      )

      if (res.status === 204) {
        setTriggerMsg('実行をトリガーしました！数分後にログに反映されます。')
      } else {
        setTriggerMsg('トリガー失敗。GitHubトークンを設定してください。')
      }
    } catch {
      setTriggerMsg('エラーが発生しました。')
    }

    setTriggering(false)
    setTimeout(() => setTriggerMsg(''), 5000)
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function statusBadge(status: string) {
    if (status === 'success') return <span className="badge badge-success">成功</span>
    if (status === 'error') return <span className="badge badge-error">エラー</span>
    if (status === 'no_slots') return <span className="badge badge-warning">空きなし</span>
    return null
  }

  if (loading) return <div className="loading">読み込み中...</div>

  const nextRun = (() => {
    const now = new Date()
    const next = new Date(now)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  })()

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)', marginBottom: 4 }}>
          ダッシュボード
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          キャッチコピー自動更新システムの状況
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value">{todayStats.success}</div>
          <div className="stat-label">本日の成功回数</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--warning)' }}>{todayStats.no_slots}</div>
          <div className="stat-label">空きなし回数</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--error)' }}>{todayStats.error}</div>
          <div className="stat-label">エラー回数</div>
        </div>
      </div>

      {/* 最新実行結果 */}
      <div className="card">
        <div className="card-title">最新の実行結果</div>

        {latestLog ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {formatTime(latestLog.executed_at)}
              </div>
              {statusBadge(latestLog.status)}
            </div>

            {latestLog.generated_catch && (
              <div style={{
                background: 'var(--brand-pale)',
                border: '1px solid var(--brand)',
                borderRadius: 8,
                padding: '12px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--brand)',
                marginBottom: 12,
              }}>
                {latestLog.generated_catch}
              </div>
            )}

            {latestLog.available_slots && latestLog.available_slots.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                取得した空き枠: {latestLog.available_slots.join(', ')}
              </div>
            )}

            {latestLog.error_message && (
              <div style={{ fontSize: 12, color: 'var(--error)', background: '#ffebee', padding: '8px 12px', borderRadius: 6 }}>
                {latestLog.error_message}
              </div>
            )}

            {latestLog.duration_ms && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                処理時間: {(latestLog.duration_ms / 1000).toFixed(1)}秒
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>まだ実行履歴がありません</div>
        )}
      </div>

      {/* 次回実行 + 手動実行 */}
      <div className="card">
        <div className="card-title">スケジュール</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>次回自動実行</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--brand)' }}>{nextRun}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>毎時0分に自動実行</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button
              className="btn btn-primary"
              onClick={handleManualTrigger}
              disabled={triggering}
            >
              {triggering ? '実行中...' : '今すぐ実行'}
            </button>
            {triggerMsg && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {triggerMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
