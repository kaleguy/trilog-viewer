import { useEffect, useRef, useState } from 'react';
import Database from '@tauri-apps/plugin-sql';
import { open } from '@tauri-apps/plugin-dialog';
import { Menu } from 'lucide-react';
import { MoodChart } from './views/MoodChart';
import { Metrics } from './views/Metrics';
import { Habits } from './views/Habits';
import { Trackers } from './views/Trackers';
import { Charts } from './views/Charts';
import { LifeCalendar } from './views/LifeCalendar';
import { SettingsModal, type ViewerSettings } from './views/SettingsModal';
import { AboutModal } from './views/AboutModal';
import { ErrorBoundary } from './views/ErrorBoundary';
import { getAppSettings } from './db/queries';
import './App.css';

type Tab = 'mood' | 'metrics' | 'habits' | 'trackers' | 'charts' | 'life';

interface DbState {
  path: string;
  conn: Awaited<ReturnType<typeof Database.load>>;
  settings: Record<string, string>;
}

const ALL_TABS: { id: Tab; label: string }[] = [
  { id: 'mood', label: 'Mood Chart' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'habits', label: 'Habits' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'charts', label: 'Charts' },
  { id: 'life', label: 'Life' },
];

function App() {
  const [db, setDb] = useState<DbState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('mood');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>(() => {
    // Boot the appearance toggles + birthdate + horizon from localStorage so
    // they survive across DB opens / app restarts. Mood-chart toggles get
    // reseeded from the bundle's app_settings on each open.
    let stored: Partial<ViewerSettings> = {};
    try {
      const raw = localStorage.getItem('trilog.viewer.settings');
      if (raw) stored = JSON.parse(raw);
    } catch {
      // ignore — use defaults
    }
    // Honor the older standalone birthdate key from the empty-state form
    // so existing users don't have to re-enter it.
    const legacyBirthdate = localStorage.getItem('trilog.viewer.birthdate') || '';
    return {
      showCycles: false,
      showWeather: false,
      showMoonPhases: false,
      showLifeCalendar: stored.showLifeCalendar ?? false,
      birthdate: stored.birthdate ?? legacyBirthdate,
      lifeFocusHorizonYears: stored.lifeFocusHorizonYears ?? null,
    };
  });

  // Persist the settings the viewer manages itself (everything except
  // the mood-chart toggles, which seed from the bundle each open).
  useEffect(() => {
    try {
      localStorage.setItem(
        'trilog.viewer.settings',
        JSON.stringify({
          showLifeCalendar: viewerSettings.showLifeCalendar,
          birthdate: viewerSettings.birthdate,
          lifeFocusHorizonYears: viewerSettings.lifeFocusHorizonYears,
        })
      );
    } catch {
      // ignore quota/serialization errors — non-critical
    }
  }, [
    viewerSettings.showLifeCalendar,
    viewerSettings.birthdate,
    viewerSettings.lifeFocusHorizonYears,
  ]);

  // Click anywhere outside the hamburger menu (or press Escape) closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
      setViewerSettings((prev) => ({
        showCycles: settings.showCycles === 'true',
        showWeather: settings.showWeather === 'true',
        showMoonPhases: settings.showMoonPhases === 'true',
        // Appearance / Life Calendar settings are viewer-local; keep
        // whatever the user already configured.
        showLifeCalendar: prev.showLifeCalendar,
        birthdate: prev.birthdate,
        lifeFocusHorizonYears: prev.lifeFocusHorizonYears,
      }));
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
        <h1>TriLog Viewer <span style={{ opacity: 0.5, fontSize: '0.7em', fontWeight: 400 }}>build perf-7</span></h1>
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

  // Filter the tab list by appearance toggles, then redirect away from a
  // hidden active tab.
  const visibleTabs = ALL_TABS.filter((t) =>
    t.id === 'life' ? viewerSettings.showLifeCalendar : true
  );
  if (!visibleTabs.some((t) => t.id === activeTab)) {
    // If the user disables the active tab while it's selected, fall back
    // to the first visible one (always present since 'mood' is always on).
    queueMicrotask(() => setActiveTab(visibleTabs[0].id));
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TriLog Viewer <span style={{ opacity: 0.5, fontSize: '0.7em', fontWeight: 400 }}>build perf-7</span></h1>
        <nav className="app-tabs">
          {visibleTabs.map((t) => (
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
        <div className="header-menu" ref={menuRef}>
          <button
            className="icon-btn"
            type="button"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Menu size={18} />
          </button>
          {menuOpen && (
            <div className="header-menu-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
              >
                Settings
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setAboutOpen(true); setMenuOpen(false); }}
              >
                About
              </button>
            </div>
          )}
        </div>
        <button className="close-db" type="button" onClick={closeDb}>Close</button>
      </header>

      <main className="app-content">
        <ErrorBoundary key={activeTab}>
          {activeTab === 'mood' && (
            <MoodChart
              conn={db.conn}
              settings={db.settings}
              viewerSettings={viewerSettings}
            />
          )}
          {activeTab === 'metrics' && <Metrics conn={db.conn} settings={db.settings} />}
          {activeTab === 'habits' && <Habits conn={db.conn} />}
          {activeTab === 'trackers' && <Trackers conn={db.conn} />}
          {activeTab === 'charts' && <Charts conn={db.conn} />}
          {activeTab === 'life' && (
            <LifeCalendar
              birthdate={viewerSettings.birthdate}
              focusHorizonYears={viewerSettings.lifeFocusHorizonYears}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </ErrorBoundary>
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={viewerSettings}
        onChange={setViewerSettings}
        onClose={() => setSettingsOpen(false)}
      />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

export default App;
