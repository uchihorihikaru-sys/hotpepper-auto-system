import { useEffect, useState } from 'react'
import { supabase, type ExecutionLog } from '../lib/supabase'

export function Logs() {
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchLogs() {
    const { data } = await supabase
      .from('execution_logs')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(100)

    if (data) setLogs(data)
    setLoading(false)
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function statusBadge(status: string) {
    if (status === 'success') return <span className="badge badge-success">成功</span>
    if (status === 'error') return <span className="badge badge-error">エラー</span>
    if (status === 'no_slots') return <span className="badge badge-warning">空きなし</span>
    return null
  }

  if (loading) return <div className="loading">読み込み中...</div>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)', marginBottom: 4 }}>
          実行ログ
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          過去100件の実行履歴（30秒ごとに自動更新）
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          まだ実行履歴がありません
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--brand-pale)' }}>
                <th style={thStyle}>実行日時</th>
                <th style={thStyle}>結果</th>
                <th style={thStyle}>対象日</th>
                <th style={thStyle}>生成キャッチ</th>
                <th style={thStyle}>空き枠</th>
                <th style={thStyle}>処理時間</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={tdStyle}>{formatTime(log.executed_at)}</td>
                  <td style={tdStyle}>{statusBadge(log.status)}</td>
                  <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {log.target_date_label
                      ? <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{log.target_date_label}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>-</span>
                    }
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 300, fontSize: 12 }}>
                    {log.generated_catch || (
                      log.error_message
                        ? <span style={{ color: 'var(--error)' }}>{log.error_message}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {log.available_slots && log.available_slots.length > 0
                      ? log.available_slots.join(', ')
                      : <span style={{ color: 'var(--text-muted)' }}>-</span>
                    }
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {log.duration_ms
                      ? `${(log.duration_ms / 1000).toFixed(1)}s`
                      : '-'
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--brand)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: 13,
  borderTop: '1px solid var(--border)',
  verticalAlign: 'middle',
}
