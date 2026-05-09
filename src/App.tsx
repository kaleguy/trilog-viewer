import { useState } from 'react';
import Database from '@tauri-apps/plugin-sql';
import { open } from '@tauri-apps/plugin-dialog';
import { MoodChart } from './views/MoodChart';
import { Placeholder } from './views/Placeholder';
import './App.css';

type Tab = 'mood' | 'metrics' | 'habits' | 'trackers';

interface DbState {
  path: string;
  conn: Awaited<ReturnType<typeof Database.load>>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'mood', label: 'Mood Chart' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'habits', label: 'Habits' },
  { id: 'trackers', label: 'Trackers' },
];

function App() {
  const [db, setDb] = useState<DbState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('mood');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openDb = async () => {
    setError(null);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
    });
    if (!selected || typeof selected !== 'string') return;

    setLoading(true);
    try {
      const conn = await Database.load(`sqlite:${selected}`);
      setDb({ path: selected, conn });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const closeDb = async () => {
    if (db) {
      try { await db.conn.close(); } catch { /* ignore */ }
    }
    setDb(null);
  };

  if (!db) {
    return (
      <main className="container">
        <h1>TriLog Viewer</h1>
        <div className="card">
          <p>Open a <code>journal.db</code> exported from TriLog.</p>
          <button type="button" onClick={openDb} disabled={loading}>
            {loading ? 'Loading…' : 'Open Database…'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TriLog Viewer</h1>
        <nav className="app-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button className="close-db" type="button" onClick={closeDb}>Close</button>
      </header>

      <main className="app-content">
        {activeTab === 'mood' && <MoodChart conn={db.conn} />}
        {activeTab === 'metrics' && <Placeholder title="Metrics" />}
        {activeTab === 'habits' && <Placeholder title="Habits" />}
        {activeTab === 'trackers' && <Placeholder title="Trackers" />}
      </main>
    </div>
  );
}

export default App;
