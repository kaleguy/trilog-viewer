import { useState } from 'react';
import Database from '@tauri-apps/plugin-sql';
import { open } from '@tauri-apps/plugin-dialog';
import { Menu } from 'lucide-react';
import { MoodChart } from './views/MoodChart';
import { Placeholder } from './views/Placeholder';
import { SettingsModal, type ViewerSettings } from './views/SettingsModal';
import { getAppSettings } from './db/queries';
import './App.css';

type Tab = 'mood' | 'metrics' | 'habits' | 'trackers';

interface DbState {
  path: string;
  conn: Awaited<ReturnType<typeof Database.load>>;
  settings: Record<string, string>;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>({
    showCycles: false,
    showWeather: false,
    showMoonPhases: false,
  });

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
      const settings = await getAppSettings(conn);
      setDb({ path: selected, conn, settings });
      // Seed the viewer's settings from the snapshot the iOS app stamped
      // into the bundle. Falls back to false if a key is missing (older
      // bundles or never-set toggles).
      setViewerSettings({
        showCycles: settings.showCycles === 'true',
        showWeather: settings.showWeather === 'true',
        showMoonPhases: settings.showMoonPhases === 'true',
      });
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

  const exportedAt = db.settings.exportedAt
    ? new Date(parseInt(db.settings.exportedAt, 10))
    : null;

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
        {exportedAt && (
          <span
            className="snapshot-info"
            title={`Snapshot from ${exportedAt.toLocaleString()}${
              db.settings.zip ? ` · ZIP ${db.settings.zip}` : ''
            }${
              db.settings.latitude && db.settings.longitude
                ? ` · ${db.settings.latitude}, ${db.settings.longitude}`
                : ''
            }`}
          >
            {exportedAt.toLocaleDateString()}
            {db.settings.zip ? ` · ${db.settings.zip}` : ''}
          </span>
        )}
        <button
          className="icon-btn"
          type="button"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Menu size={18} />
        </button>
        <button className="close-db" type="button" onClick={closeDb}>Close</button>
      </header>

      <main className="app-content">
        {activeTab === 'mood' && (
          <MoodChart
            conn={db.conn}
            settings={db.settings}
            viewerSettings={viewerSettings}
          />
        )}
        {activeTab === 'metrics' && <Placeholder title="Metrics" />}
        {activeTab === 'habits' && <Placeholder title="Habits" />}
        {activeTab === 'trackers' && <Placeholder title="Trackers" />}
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={viewerSettings}
        onChange={setViewerSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
