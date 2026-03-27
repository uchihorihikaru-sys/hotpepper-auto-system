import { useEffect, useState } from 'react'
import { supabase, type CatchSetting } from '../lib/supabase'

export function Settings() {
  const [setting, setSetting] = useState<CatchSetting | null>(null)
  const [template, setTemplate] = useState('')
  const [fallback, setFallback] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    const { data } = await supabase
      .from('catch_settings')
      .select('*')
      .limit(1)
      .single()

    if (data) {
      setSetting(data)
      setTemplate(data.template)
      setFallback(data.fallback_text)
      setIsActive(data.is_active)
    }
    setLoading(false)
  }

  // テンプレートの文字数カウント（全角=1, 半角=0.5）
  function countChars(text: string) {
    let count = 0
    for (const ch of text) {
      count += ch.charCodeAt(0) > 255 ? 1 : 0.5
    }
    return count
  }

  // プレビュー生成
  function getPreview(tmpl: string) {
    return tmpl.replace('{TIME}', '16時')
  }

  async function handleSave() {
    setSaving(true)

    const payload = {
      template,
      fallback_text: fallback,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    }

    let result
    if (setting?.id) {
      result = await supabase
        .from('catch_settings')
        .update(payload)
        .eq('id', setting.id)
    } else {
      result = await supabase
        .from('catch_settings')
        .insert(payload)
    }

    if (!result.error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      fetchSettings()
    }

    setSaving(false)
  }

  if (loading) return <div className="loading">読み込み中...</div>

  const previewText = getPreview(template)
  const charCount = countChars(previewText)

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)', marginBottom: 4 }}>
          設定
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          キャッチコピーのテンプレートと動作設定
        </p>
      </div>

      <div className="card">
        <div className="card-title">キャッチコピーテンプレート</div>

        <div className="form-group">
          <label className="form-label">テンプレート</label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            空き時間が入る部分を <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{'{TIME}'}</code> と書いてください（例：16時）
          </p>
          <textarea
            className="form-input form-textarea"
            value={template}
            onChange={e => setTemplate(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {'{TIME}'} が実際の空き時間（例：16時）に置き換えられます
            </span>
            <span style={{
              fontSize: 11,
              color: charCount > 50 ? 'var(--error)' : 'var(--text-muted)',
              fontWeight: charCount > 50 ? 700 : 400,
            }}>
              プレビュー文字数: {charCount}/50
            </span>
          </div>
        </div>

        {/* プレビュー */}
        <div style={{
          background: 'var(--brand-pale)',
          border: '1px solid var(--brand)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600, marginBottom: 6 }}>
            プレビュー（16時の場合）
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {previewText}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">空きなし時のフォールバック文</label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            本日の空き枠が見つからない場合に使用されるキャッチコピー
          </p>
          <textarea
            className="form-input form-textarea"
            value={fallback}
            onChange={e => setFallback(e.target.value)}
            rows={2}
          />
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              文字数: {countChars(fallback)}/50
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">動作設定</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--brand)' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>自動更新を有効にする</span>
          </label>
          <span className={`badge ${isActive ? 'badge-success' : 'badge-error'}`}>
            {isActive ? '有効' : '停止中'}
          </span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          無効にすると、毎時の自動実行がスキップされます
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        {saved && (
          <span className="badge badge-success" style={{ padding: '8px 16px' }}>
            保存しました！
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || charCount > 50}
        >
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  )
}
