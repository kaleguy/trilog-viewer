import { useEffect, useMemo, useState } from 'react';
import { type Conn_ } from '../db/queries';
import './Charts.css';

interface Props {
  conn: Conn_;
}

interface ActivityRow {
  timestamp: number;
  type: string;
  fillGaps: number;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Diagnostic: just fetch activity_entries and show as a table.
 * No chart. Tests whether the fetch itself / displaying ~4,344 rows
 * is what causes the freeze, vs. the chart's SVG rendering.
 */
export function Charts({ conn }: Props) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    conn.select<ActivityRow[]>(
      `SELECT timestamp, type, fillGaps FROM activity_entries ORDER BY timestamp DESC`,
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
    const d = new Date(r.timestamp);
    return {
      key: r.timestamp,
      date: dateKey(d),
      time: TIME_FMT.format(d),
      type: r.type,
      fillGaps: !!r.fillGaps,
    };
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
        Diagnostic table — activity_entries.
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
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', width: 80 }}>Time</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Type</th>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', width: 80 }}>fillGaps</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.date}</td>
                <td style={{ padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.time}</td>
                <td style={{ padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.type}</td>
                <td style={{ padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{r.fillGaps ? 'true' : 'false'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
