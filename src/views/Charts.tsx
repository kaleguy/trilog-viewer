import { useEffect, useMemo, useState } from 'react';
import { type Conn_ } from '../db/queries';
import './Charts.css';

interface Props {
  conn: Conn_;
}

interface RawRow {
  dateKey: string;
  moodValues: string | null;
}

/**
 * Diagnostic table view of day_entries. Two columns:
 *   - date
 *   - the moodValues array (the 5-tuple the iPhone "day end" mood
 *     dialog stamps onto each day: [upset, anxious, sad, neutral, happy])
 *
 * Single fetch at mount, then pure scroll. If day_entries is fine
 * to query in a single shot for ~2 years and the table scrolls
 * smoothly, the freeze we were seeing before lives in the
 * per-navigation re-query loop, not in day_entries itself.
 */
export function Charts({ conn }: Props) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Trimmed: only the two columns we actually display. No WHERE.
    conn.select<RawRow[]>(
      `SELECT dateKey, moodValues FROM day_entries ORDER BY dateKey DESC`,
    )
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conn]);

  const display = useMemo(() => rows.map((r) => {
    let arr: number[] | null = null;
    if (r.moodValues) {
      try {
        const parsed = JSON.parse(r.moodValues);
        if (Array.isArray(parsed)) arr = parsed as number[];
      } catch { /* ignore */ }
    }
    // Weighted score: each slot's index 0..4 maps to position 1..5
    // (upset=1, anxious=2, sad=3, neutral=4, happy=5). Score is the
    // count-weighted mean of those positions — what the mood line
    // on the chart plots.
    let weighted: number | null = null;
    if (arr && arr.length === 5) {
      let num = 0;
      let denom = 0;
      for (let i = 0; i < 5; i++) {
        const v = arr[i];
        if (typeof v === 'number' && v > 0) {
          num += (i + 1) * v;
          denom += v;
        }
      }
      if (denom > 0) weighted = Math.max(1, Math.min(5, num / denom));
    }
    return { dateKey: r.dateKey, arr, weighted };
  }), [rows]);

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
        Diagnostic table — day_entries.moodValues for every day.
        {loading && ' Loading…'}
        {error && ` Error: ${error}`}
        {!loading && !error && ` ${rows.length} rows.`}
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
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', width: 140 }}>Date</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', width: 300 }}>[upset, anxious, sad, neutral, happy]</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'right' }}>Weighted</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r) => (
              <tr key={r.dateKey}>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {r.dateKey}
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {r.arr ? `[${r.arr.join(', ')}]` : '—'}
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'right' }}>
                  {r.weighted != null ? r.weighted.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
