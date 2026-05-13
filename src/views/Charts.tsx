import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

interface DayBars {
  dateKey: string;
  ts: number;
  // 5-tuple of mood counts: [upset, anxious, sad, neutral, happy]
  counts: number[];
  total: number;
}

const WINDOW_OPTIONS: { weeks: number; label: string }[] = [
  { weeks: 4, label: '4w' },
  { weeks: 12, label: '12w' },
  { weeks: 24, label: '24w' },
];
const DEFAULT_WEEKS = 24;

const PAD_LEFT = 16;
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 32;

// Order in the stack from bottom→top: upset → anxious → sad → neutral → happy.
// "Good mood" reads as taller green at the top of the bar.
const MOOD_KEYS = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;
const MOOD_LABELS = ['Upset', 'Anxious', 'Sad', 'Neutral', 'Happy'] as const;

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

export function Charts({ conn }: Props) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Parse moodValues once. We keep the raw 5-tuple counts; the bar
  // stacks normalize per-day, but the absolute counts are also kept
  // in case we want absolute heights later.
  const allBars = useMemo(() => {
    const out: DayBars[] = [];
    for (const r of rows) {
      if (!r.moodValues) continue;
      let arr: number[] | null = null;
      try {
        const parsed = JSON.parse(r.moodValues);
        if (Array.isArray(parsed) && parsed.length === 5) arr = parsed as number[];
      } catch { continue; }
      if (!arr) continue;
      const counts = arr.map((v) => (typeof v === 'number' && v > 0 ? v : 0));
      const total = counts.reduce((s, v) => s + v, 0);
      if (total === 0) continue;
      out.push({ dateKey: r.dateKey, ts: parseDateKey(r.dateKey), counts, total });
    }
    return out;
  }, [rows]);

  const barsByDate = useMemo(() => {
    const m = new Map<string, DayBars>();
    for (const b of allBars) m.set(b.dateKey, b);
    return m;
  }, [allBars]);

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

  const monthTicks = useMemo(() => {
    const out: { idx: number; label: string }[] = [];
    for (let i = 0; i < days.length; i++) {
      if (days[i].getDate() === 1) out.push({ idx: i, label: MONTH_FMT.format(days[i]) });
    }
    return out;
  }, [days]);

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

  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 320 });
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const plotW = w - PAD_LEFT - PAD_RIGHT;
  const plotH = h - PAD_TOP - PAD_BOTTOM;
  const colW = plotW / days.length;
  const barGap = Math.min(2, colW * 0.18); // breathing room between bars
  const barW = Math.max(1, colW - barGap);

  const visibleBars = useMemo(() => {
    const out: { i: number; bar: DayBars }[] = [];
    for (let i = 0; i < days.length; i++) {
      const bar = barsByDate.get(dateKey(days[i]));
      if (bar) out.push({ i, bar });
    }
    return out;
  }, [days, barsByDate]);

  const todayIdx = useMemo(() => {
    const t = startOfLocalDay(new Date()).getTime();
    return days.findIndex((d) => startOfLocalDay(d).getTime() === t);
  }, [days]);

  const visibleDays = visibleBars.length;

  return (
    <div style={{
      padding: 16,
      color: '#f0f0f0',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      gap: 12,
    }}>
      <div className="charts-toolbar">
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
          {!loading && !error && `${visibleDays} of ${allBars.length} days`}
        </span>
      </div>

      <section style={{
        height: 340,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        background: 'linear-gradient(180deg, #0c0c0c, #060606)',
        padding: '14px 18px 14px',
      }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          gap: 12,
        }}>
          <h3 style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#ccc',
          }}>Mood Mix</h3>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 11,
            color: '#aaa',
          }}>
            {MOOD_KEYS.map((k, i) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: MOOD_COLORS[k],
                  display: 'inline-block',
                }} />
                {MOOD_LABELS[i]}
              </span>
            ))}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <button className="chart-nav-btn" type="button" onClick={stepBack} aria-label="Previous month">‹</button>
            <span style={{
              fontSize: 12,
              color: '#aaa',
              minWidth: 180,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatRange(days[0], days[days.length - 1])}
            </span>
            <button className="chart-nav-btn" type="button" onClick={stepForward} aria-label="Next month">›</button>
          </div>
        </header>
        <div ref={plotRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <svg
            width={w}
            height={h}
            style={{ display: 'block', pointerEvents: 'none' }}
          >
            {/* Horizontal gridlines at quarters */}
            {[0.25, 0.5, 0.75].map((frac) => (
              <line
                key={frac}
                x1={PAD_LEFT}
                x2={w - PAD_RIGHT}
                y1={PAD_TOP + plotH * frac}
                y2={PAD_TOP + plotH * frac}
                stroke="rgba(255,255,255,0.04)"
                strokeDasharray="3 4"
              />
            ))}
            {/* Month tick marks + labels */}
            {monthTicks.map((t) => {
              const x = PAD_LEFT + colW * t.idx;
              return (
                <g key={t.label + t.idx}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PAD_TOP}
                    y2={PAD_TOP + plotH}
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <text
                    x={x}
                    y={h - 10}
                    fill="#999"
                    fontSize={10}
                    fontWeight={600}
                    textAnchor="middle"
                    style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}
            {/* Today marker */}
            {todayIdx >= 0 && (
              <line
                x1={PAD_LEFT + colW * (todayIdx + 0.5)}
                x2={PAD_LEFT + colW * (todayIdx + 0.5)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke="#00cc55"
                strokeWidth={1}
                opacity={0.5}
                strokeDasharray="2 3"
              />
            )}
            {/* Stacked bars — each day's 5 mood counts normalized
                to a full bar height. Order bottom→top:
                upset, anxious, sad, neutral, happy. */}
            {visibleBars.map(({ i, bar }) => {
              const x = PAD_LEFT + colW * i + barGap / 2;
              let yCursor = PAD_TOP + plotH; // bottom of the bar
              return (
                <g key={bar.dateKey}>
                  {MOOD_KEYS.map((k, j) => {
                    const count = bar.counts[j];
                    if (count <= 0) return null;
                    const segH = (count / bar.total) * plotH;
                    yCursor -= segH;
                    return (
                      <rect
                        key={k}
                        x={x}
                        y={yCursor}
                        width={barW}
                        height={segH}
                        fill={MOOD_COLORS[k]}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </section>
    </div>
  );
}
