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

      {/* 実行ルール */}
      <div className="card">
        <div className="card-title">実行ルール</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ① 実行タイミング */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>① 実行タイミング</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              毎時0分に自動実行（Chrome拡張機能）<br />
              ポップアップの「今すぐ実行」で手動実行も可能
            </div>
          </div>

          {/* ② 対象日 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>② 空き時間の取得対象日</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              <span style={{ background: 'var(--brand-pale)', color: 'var(--brand)', padding: '1px 6px', borderRadius: 4, marginRight: 6, fontSize: 12 }}>7:00〜18:59</span>当日の空き時間を反映<br />
              <span style={{ background: 'var(--brand-pale)', color: 'var(--brand)', padding: '1px 6px', borderRadius: 4, marginRight: 6, fontSize: 12 }}>19:00〜24:00</span>翌日の空き時間を反映
            </div>
          </div>

          {/* ③ フィルタリング */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>③ 空き枠フィルタリング</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.9 }}>
              実行時刻 <strong>+2時間以降</strong> の枠のみ対象<br />
              　例）10:00実行 → 12:00以降が対象<br />
              <strong>連続60分以上</strong>の空き枠のみ反映（30分のみの枠はスキップ）<br />
              連続ブロックの<strong>最初の時間</strong>を表示<br />
              　例）13:00〜15:30が連続空き → 「本日13時空きあり」
            </div>
          </div>

          {/* ③-b 日付表示形式 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>③-b 日付の表示形式</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.9 }}>
              当日の空きは <strong>「本日」</strong>、翌日は <strong>「明日」</strong>、それ以降は <strong>「〇月〇日」</strong> 形式で表示<br />
              　例）当日 → 【本日16時空きあり】<br />
              　例）翌日 → 【明日10時空きあり】<br />
              　例）2日以降 → 【3月31日16時空きあり】
            </div>
          </div>

          {/* ④ 空きなし */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>④ 空きなしの場合</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              翌日 → 翌々日 → 最大<strong>7日先</strong>まで自動探索<br />
              7日先まで空きなし → フォールバックテキストを表示
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: '#f5f5f5', padding: '6px 10px', borderRadius: 6, marginTop: 6 }}>
              《平日予約がお得◎》[カットカラー¥8800] 海外レイヤーカットやエクステが大人気◎本日も営業中♪
            </div>
          </div>

          {/* ⑤ 同一キャッチ */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>⑤ 前回と同じキャッチの場合</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              自動で1文字変更して強制更新（例：◎→〇）
            </div>
          </div>

          {/* ⑥ 文字数制限 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>⑥ キャッチの文字数制限（50文字）</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              50文字を超える場合、以下の順で装飾文字を削除して短縮<br />
              <strong>① 絵文字・記号</strong>を削除（◎ ♪ ★ など）<br />
              <strong>② 《》</strong>を外して中身を残す<br />
              <strong>③ 【】</strong>を外して中身を残す<br />
              <strong>④ []</strong>を外して中身を残す<br />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>※ 時間（例: 本日10時）は常に正確に保持</span>
            </div>
          </div>

          {/* ⑦ ログイン失敗 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c62828', marginBottom: 6 }}>⑦ サロンボードにログインできない場合</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
              ログインページへのリダイレクトを自動検知<br />
              <strong>① セッション切れの場合</strong>：保存済みID/PWで自動再ログインして続行<br />
              <strong>② ID/PWが変わった場合</strong>：自動ログイン失敗を検知<br />
              　→ <strong>hika_hika19@yahoo.co.jp</strong> へ通知メールを自動送信<br />
              　→ Chromeデスクトップ通知も同時に表示<br />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>※ 1時間以内の重複通知はスキップ</span>
            </div>
            <div style={{ fontSize: 12, color: '#c62828', background: '#fff3f3', padding: '6px 10px', borderRadius: 6, marginTop: 6, border: '1px solid #ffcdd2' }}>
              対応方法：拡張機能ポップアップの「🔑 サロンボード ログイン設定」で新しいID/パスワードを更新して「保存」
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
