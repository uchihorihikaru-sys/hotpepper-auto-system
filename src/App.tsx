import { useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { Logs } from './components/Logs'
import './App.css'

type Tab = 'dashboard' | 'settings' | 'logs'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">LC</div>
            <div className="logo-titles">
              <span className="logo-name">Lay. Catch Board</span>
              <span className="logo-sub">Lay. / Salon Solution System</span>
            </div>
          </div>
          <nav className="nav">
            <button
              className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              ダッシュボード
            </button>
            <button
              className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              設定
            </button>
            <button
              className={`nav-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              実行ログ
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'settings' && <Settings />}
        {activeTab === 'logs' && <Logs />}
      </main>
    </div>
  )
}

export default App
