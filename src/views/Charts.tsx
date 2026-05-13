import { useEffect, useMemo, useState } from 'react';
import { type Conn_ } from '../db/queries';
import { MOOD_COLORS } from '../db/types';
import './Charts.css';

interface Props {
  conn: Conn_;
}

interface RawRow {
  dateKey: string;
  moodValues: string | null;
}

interface DayPoint {
  dateKey: string;
  ts: number;        // ms — for x-axis positioning
  weighted: number;  // 1..5
}

// SVG viewBox dimensions — proportional, the SVG stretches to fill
// the container.
const VBOX_W = 1000;
const VBOX_H = 200;
const PAD_X = 20;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const Y_MIN = 1;
const Y_MAX = 5;

const MOOD_LINE_COLOR = '#00DD66';
const MOOD_POSITION_NAMES = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;
function moodColorForScore(score: number): string {
  const idx = Math.max(0, Math.min(4, Math.round(score) - 1));
  return MOOD_COLORS[MOOD_POSITION_NAMES[idx]];
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(k: string): number {
  const [y, m, d] = k.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d).getTime();
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });

/**
 * Fetch day_entries.moodValues for every day, compute the weighted
 * mood score per day, and draw a single line chart. No date
 * navigation — the chart shows the entire history at once.
 */
export function Charts({ conn }: Props) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    conn.select<RawRow[]>(
      `SELECT dateKey, moodValues FROM day_entries ORDER BY dateKey ASC`,
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

  const points: DayPoint[] = useMemo(() => {
    const out: DayPoint[] = [];
    for (const r of rows) {
      if (!r.moodValues) continue;
      let arr: number[] | null = null;
      try {
        const parsed = JSON.parse(r.moodValues);
        if (Array.isArray(parsed) && parsed.length === 5) arr = parsed as number[];
      } catch { continue; }
      if (!arr) continue;
      let num = 0;
      let denom = 0;
      for (let i = 0; i < 5; i++) {
        const v = arr[i];
        if (typeof v === 'number' && v > 0) {
          num += (i + 1) * v;
          denom += v;
        }
      }
      if (denom === 0) continue;
      const score = Math.max(1, Math.min(5, num / denom));
      out.push({ dateKey: r.dateKey, ts: parseDateKey(r.dateKey), weighted: score });
    }
    return out;
  }, [rows]);

  const tsMin = points.length ? points[0].ts : 0;
  const tsMax = points.length ? points[points.length - 1].ts : 1;
  const tsRange = Math.max(1, tsMax - tsMin);
  const plotW = VBOX_W - 2 * PAD_X;
  const plotH = VBOX_H - PAD_TOP - PAD_BOTTOM;

  function xFor(ts: number): number {
    return PAD_X + ((ts - tsMin) / tsRange) * plotW;
  }
  function yFor(level: number): number {
    const t = (level - Y_MIN) / (Y_MAX - Y_MIN);
    return PAD_TOP + (1 - t) * plotH;
  }

  // Month tick marks — first of each month inside the range.
  const monthTicks = useMemo(() => {
    if (!points.length) return [];
    const out: { ts: number; label: string }[] = [];
    const first = new Date(tsMin);
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    if (cursor.getTime() < tsMin) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor.getTime() <= tsMax) {
      out.push({ ts: cursor.getTime(), label: MONTH_FMT.format(cursor) });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return out;
  }, [tsMin, tsMax, points.length]);

  // Path d for the line — straight segments between consecutive
  // points, no smoothing.
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.ts).toFixed(2)} ${yFor(p.weighted).toFixed(2)}`).join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, tsMin, tsMax]);

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
        Diagnostic mood chart — day_entries weighted mood for every recorded day.
        {loading && ' Loading…'}
        {error && ` Error: ${error}`}
        {!loading && !error && ` ${points.length} days, ${dateKey(new Date(tsMin))} → ${dateKey(new Date(tsMax))}.`}
      </div>
      <div style={{
        flex: 1,
        minHeight: 0,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: 12,
        background: '#050505',
      }}>
        <svg
          viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ display: 'block', pointerEvents: 'none' }}
        >
          {/* Horizontal gridlines at integer mood levels */}
          {[1, 2, 3, 4, 5].map((lvl) => (
            <line
              key={lvl}
              x1={PAD_X}
              x2={VBOX_W - PAD_X}
              y1={yFor(lvl)}
              y2={yFor(lvl)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.5}
            />
          ))}
          {/* Month dividers + labels */}
          {monthTicks.map((t) => (
            <g key={t.ts}>
              <line
                x1={xFor(t.ts)}
                x2={xFor(t.ts)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth={0.5}
              />
              <text
                x={xFor(t.ts)}
                y={VBOX_H - 6}
                fill="#666"
                fontSize={8}
                textAnchor="middle"
              >
                {t.label}
              </text>
            </g>
          ))}
          {/* Mood line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={MOOD_LINE_COLOR}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Dots colored by mood palette */}
          {points.map((p) => (
            <circle
              key={p.dateKey}
              cx={xFor(p.ts)}
              cy={yFor(p.weighted)}
              r={1.2}
              fill={moodColorForScore(p.weighted)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
