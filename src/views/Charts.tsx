import { useEffect, useMemo, useState } from 'react';
import {
  getEnergyEntries,
  getMoodEntries,
  type Conn_,
} from '../db/queries';
import './Charts.css';

interface Props {
  conn: Conn_;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DayRowData {
  dateKey: string;
  mood: string | null;
  energyAvg: number | null;
}

/**
 * Diagnostic Charts view: drop all SVG rendering and date navigation.
 * Fetch a single small payload once, show as a vertical scrolling
 * table. If THIS freezes when you scroll, the bug is something deep
 * we can't reach from the JS side. If it stays smooth all the way
 * through 365+ rows, the SVG re-render pipeline is the real cost
 * and we can rebuild charts more carefully on top of this baseline.
 */
export function Charts({ conn }: Props) {
  const [moods, setMoods] = useState<{ timestamp: number; type: string }[]>([]);
  const [energies, setEnergies] = useState<{ timestamp: number; level: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const twoYearsAgo = now - 365 * 2 * 24 * 60 * 60 * 1000;
    Promise.all([
      getMoodEntries(conn, twoYearsAgo, now + 24 * 60 * 60 * 1000),
      getEnergyEntries(conn, twoYearsAgo, now + 24 * 60 * 60 * 1000),
    ])
      .then(([m, e]) => {
        if (cancelled) return;
        setMoods(m);
        setEnergies(e);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conn]);

  const rows = useMemo<DayRowData[]>(() => {
    const byDay = new Map<string, { moods: string[]; energies: number[] }>();
    for (const m of moods) {
      const k = dateKey(new Date(m.timestamp));
      let bucket = byDay.get(k);
      if (!bucket) { bucket = { moods: [], energies: [] }; byDay.set(k, bucket); }
      bucket.moods.push(m.type);
    }
    for (const e of energies) {
      const k = dateKey(new Date(e.timestamp));
      let bucket = byDay.get(k);
      if (!bucket) { bucket = { moods: [], energies: [] }; byDay.set(k, bucket); }
      bucket.energies.push(e.level);
    }
    const sortedKeys = [...byDay.keys()].sort().reverse(); // newest first
    return sortedKeys.map((k) => {
      const b = byDay.get(k)!;
      // Most common mood for the day
      const counts: Record<string, number> = {};
      for (const t of b.moods) counts[t] = (counts[t] ?? 0) + 1;
      let dominant: string | null = null;
      let dn = 0;
      for (const [t, n] of Object.entries(counts)) {
        if (n > dn) { dn = n; dominant = t; }
      }
      const energyAvg = b.energies.length
        ? b.energies.reduce((s, x) => s + x, 0) / b.energies.length
        : null;
      return { dateKey: k, mood: dominant, energyAvg };
    });
  }, [moods, energies]);

  return (
    <div style={{
      padding: 16,
      color: '#f0f0f0',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
        Diagnostic table view — full-year mood + energy from mood_entries / energy_entries.
        {loading && ' Loading…'}
        {error && ` Error: ${error}`}
        {!loading && !error && ` ${rows.length} days.`}
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 13,
        }}>
          <thead style={{
            position: 'sticky',
            top: 0,
            background: '#111',
            zIndex: 1,
          }}>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Date</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Mood</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Energy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dateKey}>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {r.dateKey}
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {r.mood ?? '—'}
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                  {r.energyAvg != null ? r.energyAvg.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
