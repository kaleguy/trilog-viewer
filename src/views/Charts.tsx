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
  ts: number;
  weighted: number;
}

const WINDOW_OPTIONS: { weeks: number; label: string }[] = [
  { weeks: 4, label: '4w' },
  { weeks: 12, label: '12w' },
  { weeks: 24, label: '24w' },
];
const DEFAULT_WEEKS = 24;

// SVG viewBox dimensions — proportional, stretched to fit container.
const VBOX_W = 1000;
const VBOX_H = 220;
const PAD_LEFT = 56;   // room for y-axis labels
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const Y_MIN = 1;
const Y_MAX = 5;

const MOOD_LINE_COLOR = '#00DD66';
const MOOD_POSITION_NAMES = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;
const MOOD_LABELS = ['Upset', 'Anxious', 'Sad', 'Neutral', 'Happy'] as const;
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
function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function thisOrNextSaturday(date: Date): Date {
  const r = startOfLocalDay(date);
  const offset = (6 - r.getDay() + 7) % 7;
  if (offset > 0) r.setDate(r.getDate() + offset);
  return r;
}
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short' });
const RANGE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const RANGE_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function formatRange(start: Date, end: Date): string {
  if (start.getFullYear() === end.getFullYear()) {
    return `${RANGE_FMT.format(start)} – ${RANGE_FMT.format(end)}, ${end.getFullYear()}`;
  }
  return `${RANGE_YEAR_FMT.format(start)} – ${RANGE_YEAR_FMT.format(end)}`;
}

/**
 * Fetch the full day_entries.moodValues history ONCE on mount, then
 * compute the weighted mood per day in memory. Date navigation just
 * picks a different slice of the same pre-computed points — no SQL
 * fires after the initial load.
 */
export function Charts({ conn }: Props) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Navigation state — endDate + windowWeeks define the visible
  // window. These are pure UI state; changing them never queries SQL.
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));
  const [windowWeeks, setWindowWeeks] = useState<number>(DEFAULT_WEEKS);

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

  // Pre-compute every day's weighted score once. This Map is the
  // single source of truth — windowing is pure slicing.
  const allPoints: DayPoint[] = useMemo(() => {
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

  const pointsByDate = useMemo(() => {
    const m = new Map<string, DayPoint>();
    for (const p of allPoints) m.set(p.dateKey, p);
    return m;
  }, [allPoints]);

  // Visible window — N weeks ending on `endDate` (a Saturday).
  const days = useMemo(() => {
    const dayCount = windowWeeks * 7;
    const list: Date[] = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      list.push(d);
    }
    return list;
  }, [endDate, windowWeeks]);

  const windowStartMs = days[0].getTime();
  const windowEndMs = days[days.length - 1].getTime();
  const windowRangeMs = Math.max(1, windowEndMs - windowStartMs);
  const plotW = VBOX_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VBOX_H - PAD_TOP - PAD_BOTTOM;

  function xFor(ts: number): number {
    return PAD_LEFT + ((ts - windowStartMs) / windowRangeMs) * plotW;
  }
  function yFor(level: number): number {
    const t = (level - Y_MIN) / (Y_MAX - Y_MIN);
    return PAD_TOP + (1 - t) * plotH;
  }

  // Slice points to those falling inside the visible window. Pure
  // filter on the pre-computed Map — no SQL.
  const visiblePoints = useMemo(() => {
    const out: DayPoint[] = [];
    for (const d of days) {
      const p = pointsByDate.get(dateKey(d));
      if (p) out.push(p);
    }
    return out;
  }, [days, pointsByDate]);

  const linePath = useMemo(() => {
    if (visiblePoints.length === 0) return '';
    return visiblePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.ts).toFixed(2)} ${yFor(p.weighted).toFixed(2)}`).join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePoints, windowStartMs, windowEndMs]);

  // First-of-month tick marks within the visible window.
  const monthTicks = useMemo(() => {
    const out: { ts: number; label: string }[] = [];
    for (const d of days) {
      if (d.getDate() === 1) {
        out.push({ ts: d.getTime(), label: MONTH_FMT.format(d) });
      }
    }
    return out;
  }, [days]);

  // Step the window by a calendar month so each click moves a
  // meaningful chunk — the previous one-week step felt fiddly across
  // a 24-week view.
  const stepBack = () => {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() - 1);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() + 1);
    const cap = thisOrNextSaturday(new Date());
    setEndDate(d > cap ? cap : d);
  };

  const todayMs = startOfLocalDay(new Date()).getTime();
  const todayInWindow = todayMs >= windowStartMs && todayMs <= windowEndMs;

  return (
    <div style={{
      padding: 16,
      color: '#f0f0f0',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      <div className="charts-toolbar" style={{ marginBottom: 12 }}>
        <span className="charts-toolbar-label">Window</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.weeks}
            type="button"
            className={`charts-window-btn${windowWeeks === opt.weeks ? ' active' : ''}`}
            aria-pressed={windowWeeks === opt.weeks}
            onClick={() => setWindowWeeks(opt.weeks)}
          >
            {opt.label}
          </button>
        ))}
        <span style={{ marginLeft: 16, fontSize: 12, color: '#888' }}>
          {loading && 'Loading…'}
          {error && `Error: ${error}`}
          {!loading && !error && `${visiblePoints.length} of ${allPoints.length} days`}
        </span>
      </div>

      <section style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        background: 'linear-gradient(180deg, #0a0a0a, #050505)',
        padding: '14px 18px 18px',
      }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#ccc',
          }}>Mood</h3>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <button className="chart-nav-btn" type="button" onClick={stepBack} aria-label="Previous month">‹</button>
            <span style={{
              fontSize: 13,
              color: '#aaa',
              minWidth: 160,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatRange(days[0], days[days.length - 1])}
            </span>
            <button className="chart-nav-btn" type="button" onClick={stepForward} aria-label="Next month">›</button>
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            style={{ display: 'block', pointerEvents: 'none' }}
          >
            {/* Y-axis labels and gridlines */}
            {[1, 2, 3, 4, 5].map((lvl) => (
              <g key={lvl}>
                <line
                  x1={PAD_LEFT}
                  x2={VBOX_W - PAD_RIGHT}
                  y1={yFor(lvl)}
                  y2={yFor(lvl)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={0.5}
                  strokeDasharray={lvl === 3 ? '0' : '2 3'}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yFor(lvl) + 3}
                  fill="#777"
                  fontSize={8}
                  textAnchor="end"
                  fontWeight={lvl === 1 || lvl === 5 ? 600 : 400}
                >
                  {MOOD_LABELS[lvl - 1]}
                </text>
              </g>
            ))}
            {/* Month tick marks + labels */}
            {monthTicks.map((t) => (
              <g key={t.ts}>
                <line
                  x1={xFor(t.ts)}
                  x2={xFor(t.ts)}
                  y1={PAD_TOP}
                  y2={PAD_TOP + plotH}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth={0.5}
                />
                <text
                  x={xFor(t.ts)}
                  y={VBOX_H - 8}
                  fill="#888"
                  fontSize={8}
                  fontWeight={600}
                  letterSpacing={0.5}
                  textAnchor="middle"
                  style={{ textTransform: 'uppercase' }}
                >
                  {t.label}
                </text>
              </g>
            ))}
            {/* Today marker */}
            {todayInWindow && (
              <line
                x1={xFor(todayMs)}
                x2={xFor(todayMs)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke="#00cc55"
                strokeWidth={0.8}
                opacity={0.4}
              />
            )}
            {/* Subtle area fill under the mood line for visual weight */}
            {linePath && visiblePoints.length > 1 && (
              <path
                d={`${linePath} L${xFor(visiblePoints[visiblePoints.length - 1].ts).toFixed(2)} ${(PAD_TOP + plotH).toFixed(2)} L${xFor(visiblePoints[0].ts).toFixed(2)} ${(PAD_TOP + plotH).toFixed(2)} Z`}
                fill={MOOD_LINE_COLOR}
                opacity={0.08}
              />
            )}
            {/* Mood line */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke={MOOD_LINE_COLOR}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Dots — each one halo'd by a darker outline for contrast */}
            {visiblePoints.map((p) => (
              <g key={p.dateKey}>
                <circle
                  cx={xFor(p.ts)}
                  cy={yFor(p.weighted)}
                  r={2.4}
                  fill="#050505"
                />
                <circle
                  cx={xFor(p.ts)}
                  cy={yFor(p.weighted)}
                  r={1.8}
                  fill={moodColorForScore(p.weighted)}
                />
              </g>
            ))}
          </svg>
        </div>
      </section>
    </div>
  );
}
