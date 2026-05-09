import { useState } from 'react';
import Database from '@tauri-apps/plugin-sql';
import { open } from '@tauri-apps/plugin-dialog';
import './App.css';

interface EntryCount {
  total: number;
  withJournal: number;
  withPhoto: number;
}

interface DbState {
  path: string;
  counts: EntryCount;
}

function App() {
  const [db, setDb] = useState<DbState | null>(null);
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
      const totalRows = await conn.select<{ n: number }[]>(
        'SELECT COUNT(*) AS n FROM day_entries'
      );
      const journalRows = await conn.select<{ n: number }[]>(
        "SELECT COUNT(*) AS n FROM day_entries WHERE journalEntry IS NOT NULL AND TRIM(journalEntry) != ''"
      );
      const photoRows = await conn.select<{ n: number }[]>(
        'SELECT COUNT(*) AS n FROM day_entries WHERE photoUri IS NOT NULL OR photoAssetId IS NOT NULL'
      );
      setDb({
        path: selected,
        counts: {
          total: totalRows[0]?.n ?? 0,
          withJournal: journalRows[0]?.n ?? 0,
          withPhoto: photoRows[0]?.n ?? 0,
        },
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <h1>TriLog Viewer</h1>

      {!db && !loading && (
        <div className="card">
          <p>Open a <code>journal.db</code> exported from TriLog.</p>
          <button type="button" onClick={openDb}>Open Database…</button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {loading && (
        <div className="card">
          <p>Loading…</p>
        </div>
      )}

      {db && (
        <div className="card">
          <p className="path">{db.path}</p>
          <ul className="stats">
            <li><strong>{db.counts.total}</strong> entries total</li>
            <li><strong>{db.counts.withJournal}</strong> with journal text</li>
            <li><strong>{db.counts.withPhoto}</strong> with photo reference</li>
          </ul>
          <button type="button" onClick={() => setDb(null)}>Open another</button>
        </div>
      )}
    </main>
  );
}

export default App;
