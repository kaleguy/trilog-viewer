import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type Conn_ } from '../db/queries';
import { ACTIVITY_COLORS, ENERGY_COLORS, MOOD_COLORS, type ActivityEntry, type DayEntryRow } from '../db/types';
import { aggregateActivities, type ActivityTotals } from './activityAggregation';
import './Charts.css';

interface Props {
  conn: Conn_;
}

// ---- Constants -------------------------------------------------------------

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

// Stack order: bottom→top is upset → anxious → sad → neutral → happy.
// "Good mood" reads as taller green at the top of the bar.
const MOOD_KEYS = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;

const ENERGY_LINE_COLOR = '#FFCC44';

// Sleep quality 1..5 → red → green palette (same as iPhone WeekView).
const QUALITY_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#8BC34A', '#34C759'];

const ACTIVITY_STACK_ORDER = [
  'sleep',
  'morning routine',
  'transit',
  'work',
  'school',
  'exercise',
  'leisure',
  'socialize',
  'recovery',
  'other',
] as const;
const ACTIVITY_LABELS: Record<string, string> = {
  'morning routine': 'Morning',
  sleep: 'Sleep',
  work: 'Work',
  school: 'School',
  exercise: 'Exercise',
  leisure: 'Leisure',
  socialize: 'Social',
  transit: 'Transit',
  recovery: 'Recovery',
  other: 'Other',
};
const ACTIVITY_Y_MAX = 24;
const SLEEP_Y_MAX = 10;

// ---- Helpers ---------------------------------------------------------------

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

// ---- Data types ------------------------------------------------------------

interface DayRow {
  dateKey: string;
  moodValues: string | null;
  energy: number | null;
  sleepQuality: number | null;
  sleepDurationHours: number | null;
  sleepDurationMinutes: number | null;
  hkSleepDuration: number | null;
}

interface MoodBar {
  dateKey: string;
  ts: number;
  counts: number[]; // [upset, anxious, sad, neutral, happy]
  total: number;
}
interface SleepBar {
  dateKey: string;
  hours: number;
  quality: number | null;
}

// ---- Main Charts component -------------------------------------------------

export function Charts({ conn }: Props) {
  // Source data — fetched ONCE on mount.
  const [dayRows, setDayRows] = useState<DayRow[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state.
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));
  const [windowWeeks, setWindowWeeks] = useState<number>(DEFAULT_WEEKS);
  const [showMood, setShowMood] = useState(true);
  const [showEnergy, setShowEnergy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // DIAGNOSTIC step 2: add sleep columns. Still no activity_entries
    // fetch — activity strip stays empty for now.
    conn.select<DayRow[]>(
      `SELECT dateKey, moodValues, energy, sleepQuality,
              sleepDurationHours, sleepDurationMinutes, hkSleepDuration
       FROM day_entries
       ORDER BY dateKey ASC`,
    )
      .then((rows) => {
        if (cancelled) return;
        setDayRows(rows);
        setActivities([]);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conn]);

  // Pre-aggregations (run ONCE when source data lands).
  const moodBarsByDate = useMemo(() => {
    const m = new Map<string, MoodBar>();
    for (const r of dayRows) {
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
      m.set(r.dateKey, { dateKey: r.dateKey, ts: parseDateKey(r.dateKey), counts, total });
    }
    return m;
  }, [dayRows]);

  const energyByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dayRows) {
      if (r.energy != null && r.energy >= 1 && r.energy <= 5) m.set(r.dateKey, r.energy);
    }
    return m;
  }, [dayRows]);

  const sleepByDate = useMemo(() => {
    const m = new Map<string, SleepBar>();
    for (const r of dayRows) {
      let hours: number | null = null;
      if (r.hkSleepDuration != null && r.hkSleepDuration > 0) {
        hours = r.hkSleepDuration / 60;
      } else if (r.sleepDurationHours != null && r.sleepDurationHours > 0) {
        hours = r.sleepDurationHours + (r.sleepDurationMinutes ?? 0) / 60;
      }
      if (hours == null) continue;
      m.set(r.dateKey, { dateKey: r.dateKey, hours, quality: r.sleepQuality ?? null });
    }
    return m;
  }, [dayRows]);

  const activityTotals = useMemo<Map<string, ActivityTotals>>(() => {
    if (!activities.length) return new Map();
    return aggregateActivities(activities);
  }, [activities]);

  // Visible window.
  const days = useMemo(() => {
    const n = windowWeeks * 7;
    const list: Date[] = [];
    for (let i = n - 1; i >= 0; i--) {
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

  const todayIdx = useMemo(() => {
    const t = startOfLocalDay(new Date()).getTime();
    return days.findIndex((d) => startOfLocalDay(d).getTime() === t);
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

  // Total visible-day count for the toolbar status.
  const visibleMoodDays = useMemo(() => {
    let n = 0;
    for (const d of days) if (moodBarsByDate.has(dateKey(d))) n++;
    return n;
  }, [days, moodBarsByDate]);

  return (
    <div className="charts-page">
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
        <div style={{ flex: 1 }} />
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
        <span style={{ marginLeft: 12, fontSize: 11, color: '#888' }}>
          {loading && 'Loading…'}
          {error && `Error: ${error}`}
          {!loading && !error && `${visibleMoodDays}/${moodBarsByDate.size} days`}
        </span>
      </div>

      <div className="charts-strips">
        <MoodMixStrip
          days={days}
          monthTicks={monthTicks}
          todayIdx={todayIdx}
          moodBarsByDate={moodBarsByDate}
          energyByDate={energyByDate}
          showMood={showMood}
          showEnergy={showEnergy}
          onToggleMood={() => setShowMood((v) => !v)}
          onToggleEnergy={() => setShowEnergy((v) => !v)}
        />
        <SleepStrip
          days={days}
          monthTicks={monthTicks}
          todayIdx={todayIdx}
          sleepByDate={sleepByDate}
        />
        <ActivityStrip
          days={days}
          monthTicks={monthTicks}
          todayIdx={todayIdx}
          activityTotals={activityTotals}
        />
      </div>
    </div>
  );
}

// ---- ChartStrip — shared layout shell --------------------------------------

interface ChartStripProps {
  title: string;
  legend?: ReactNode;
  children: (layout: {
    w: number;
    h: number;
    plotW: number;
    plotH: number;
    colW: number;
    barGap: number;
    barW: number;
  }) => ReactNode;
  days: Date[];
  monthTicks: { idx: number; label: string }[];
  todayIdx: number;
}
function ChartStrip({ title, legend, children, days, monthTicks, todayIdx }: ChartStripProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 240 });
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
  const colW = plotW / Math.max(1, days.length);
  const barGap = Math.min(2, colW * 0.18);
  const barW = Math.max(1, colW - barGap);

  return (
    <section className="chart-card">
      <header className="chart-card-head">
        <h3 className="chart-card-title">{title}</h3>
        {legend && <div className="chart-card-legend">{legend}</div>}
      </header>
      <div ref={plotRef} className="chart-card-plot">
        <svg width={w} height={h} style={{ display: 'block', pointerEvents: 'none' }}>
          {/* Month tick lines + labels */}
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
          {children({ w, h, plotW, plotH, colW, barGap, barW })}
        </svg>
      </div>
    </section>
  );
}

// ---- Strip: Mood Mix + Energy ----------------------------------------------

interface MoodMixStripProps {
  days: Date[];
  monthTicks: { idx: number; label: string }[];
  todayIdx: number;
  moodBarsByDate: Map<string, MoodBar>;
  energyByDate: Map<string, number>;
  showMood: boolean;
  showEnergy: boolean;
  onToggleMood: () => void;
  onToggleEnergy: () => void;
}
function MoodMixStrip({
  days, monthTicks, todayIdx,
  moodBarsByDate, energyByDate,
  showMood, showEnergy,
  onToggleMood, onToggleEnergy,
}: MoodMixStripProps) {
  const visibleBars = useMemo(() => {
    const out: { i: number; bar: MoodBar }[] = [];
    for (let i = 0; i < days.length; i++) {
      const bar = moodBarsByDate.get(dateKey(days[i]));
      if (bar) out.push({ i, bar });
    }
    return out;
  }, [days, moodBarsByDate]);
  const visibleEnergy = useMemo(() => {
    const out: { i: number; level: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const e = energyByDate.get(dateKey(days[i]));
      if (e != null) out.push({ i, level: e });
    }
    return out;
  }, [days, energyByDate]);

  const legend = (
    <>
      <button
        type="button"
        className={`chart-legend-toggle${showMood ? '' : ' off'}`}
        aria-pressed={showMood}
        onClick={onToggleMood}
        title={showMood ? 'Hide mood' : 'Show mood'}
      >
        <span className="chart-legend-mood-swatches">
          {MOOD_KEYS.map((k) => <span key={k} style={{ background: MOOD_COLORS[k] }} />)}
        </span>
        Mood
      </button>
      <button
        type="button"
        className={`chart-legend-toggle${showEnergy ? '' : ' off'}`}
        aria-pressed={showEnergy}
        onClick={onToggleEnergy}
        title={showEnergy ? 'Hide energy' : 'Show energy'}
      >
        <span style={{
          width: 16, height: 3, background: ENERGY_LINE_COLOR,
          display: 'inline-block', borderRadius: 1.5,
          boxShadow: '0 0 4px rgba(255,204,68,0.5)',
        }} />
        Energy
      </button>
    </>
  );

  return (
    <ChartStrip
      title="Mood · Energy"
      legend={legend}
      days={days}
      monthTicks={monthTicks}
      todayIdx={todayIdx}
    >
      {({ plotH, colW, barGap, barW }) => {
        const xForCol = (i: number) => PAD_LEFT + colW * (i + 0.5);
        const yForEnergy = (level: number) => {
          const t = (level - 1) / 4;
          return PAD_TOP + (1 - t) * plotH;
        };
        const energyPath = visibleEnergy.length
          ? visibleEnergy
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForCol(p.i).toFixed(2)} ${yForEnergy(p.level).toFixed(2)}`)
              .join(' ')
          : '';
        return (
          <>
            {/* Stacked mood bars */}
            {showMood && visibleBars.map(({ i, bar }) => {
              const x = PAD_LEFT + colW * i + barGap / 2;
              let yCursor = PAD_TOP + plotH;
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
                        opacity={showEnergy ? 0.82 : 1}
                      />
                    );
                  })}
                </g>
              );
            })}
            {/* Energy line with dark backdrop */}
            {showEnergy && energyPath && (
              <>
                <path d={energyPath} fill="none" stroke="#000" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
                <path d={energyPath} fill="none" stroke={ENERGY_LINE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
            {showEnergy && visibleEnergy.map((p) => (
              <g key={`e-${p.i}`}>
                <circle cx={xForCol(p.i)} cy={yForEnergy(p.level)} r={3.5} fill="#000" opacity={0.7} />
                <circle cx={xForCol(p.i)} cy={yForEnergy(p.level)} r={2.4} fill={ENERGY_COLORS[p.level] ?? ENERGY_LINE_COLOR} />
              </g>
            ))}
          </>
        );
      }}
    </ChartStrip>
  );
}

// ---- Strip: Sleep ----------------------------------------------------------

interface SleepStripProps {
  days: Date[];
  monthTicks: { idx: number; label: string }[];
  todayIdx: number;
  sleepByDate: Map<string, SleepBar>;
}
function SleepStrip({ days, monthTicks, todayIdx, sleepByDate }: SleepStripProps) {
  const visibleBars = useMemo(() => {
    const out: { i: number; bar: SleepBar }[] = [];
    for (let i = 0; i < days.length; i++) {
      const b = sleepByDate.get(dateKey(days[i]));
      if (b) out.push({ i, bar: b });
    }
    return out;
  }, [days, sleepByDate]);

  const legend = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#aaa' }}>
      <span style={{ color: '#888' }}>Quality</span>
      {[1, 2, 3, 4, 5].map((q) => (
        <span key={q} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: QUALITY_COLORS[q - 1], display: 'inline-block' }} />
          {q}
        </span>
      ))}
    </span>
  );

  return (
    <ChartStrip
      title="Sleep"
      legend={legend}
      days={days}
      monthTicks={monthTicks}
      todayIdx={todayIdx}
    >
      {({ plotH, colW, barGap, barW, w }) => {
        const yForHours = (hours: number) => {
          const clamped = Math.min(hours, SLEEP_Y_MAX);
          return PAD_TOP + plotH * (1 - clamped / SLEEP_Y_MAX);
        };
        const heightForHours = (hours: number) => {
          const clamped = Math.min(hours, SLEEP_Y_MAX);
          return plotH * (clamped / SLEEP_Y_MAX);
        };
        return (
          <>
            {/* Y-axis tick at typical hours (4, 6, 8) */}
            {[4, 6, 8].map((h) => (
              <g key={h}>
                <line
                  x1={PAD_LEFT}
                  x2={w - PAD_RIGHT}
                  y1={yForHours(h)}
                  y2={yForHours(h)}
                  stroke="rgba(255,255,255,0.04)"
                  strokeDasharray="3 4"
                />
                <text x={PAD_LEFT + 2} y={yForHours(h) - 2} fill="#666" fontSize={9}>{h}h</text>
              </g>
            ))}
            {visibleBars.map(({ i, bar }) => {
              const x = PAD_LEFT + colW * i + barGap / 2;
              const y = yForHours(bar.hours);
              const height = heightForHours(bar.hours);
              const color = bar.quality != null && bar.quality >= 1 && bar.quality <= 5
                ? QUALITY_COLORS[bar.quality - 1]
                : '#6B7280';
              return (
                <rect
                  key={bar.dateKey}
                  x={x}
                  y={y}
                  width={barW}
                  height={height}
                  fill={color}
                  rx={1}
                />
              );
            })}
          </>
        );
      }}
    </ChartStrip>
  );
}

// ---- Strip: Activity Mix ---------------------------------------------------

interface ActivityStripProps {
  days: Date[];
  monthTicks: { idx: number; label: string }[];
  todayIdx: number;
  activityTotals: Map<string, ActivityTotals>;
}
function ActivityStrip({ days, monthTicks, todayIdx, activityTotals }: ActivityStripProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visibleTypes = useMemo(
    () => ACTIVITY_STACK_ORDER.filter((t) => !hidden.has(t)),
    [hidden],
  );

  const stacksByCol = useMemo(() => {
    const out: { i: number; segments: { type: string; baseHours: number; hours: number }[] }[] = [];
    for (let i = 0; i < days.length; i++) {
      const totals = activityTotals.get(dateKey(days[i]));
      if (!totals) continue;
      const segs: { type: string; baseHours: number; hours: number }[] = [];
      let running = 0;
      for (const t of visibleTypes) {
        const hrs = totals.byType.get(t);
        if (!hrs || hrs <= 0) continue;
        const cap = Math.min(ACTIVITY_Y_MAX, running + hrs);
        segs.push({ type: t, baseHours: running, hours: cap - running });
        running = cap;
        if (running >= ACTIVITY_Y_MAX) break;
      }
      if (segs.length) out.push({ i, segments: segs });
    }
    return out;
  }, [days, activityTotals, visibleTypes]);

  const legend = (
    <div className="chart-card-legend-row">
      {ACTIVITY_STACK_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          className={`chart-legend-toggle small${hidden.has(t) ? ' off' : ''}`}
          aria-pressed={!hidden.has(t)}
          onClick={() => {
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(t)) next.delete(t); else next.add(t);
              return next;
            });
          }}
        >
          <span style={{
            width: 9, height: 9, borderRadius: 2,
            background: ACTIVITY_COLORS[t] ?? '#767676', display: 'inline-block',
          }} />
          {ACTIVITY_LABELS[t] ?? t}
        </button>
      ))}
    </div>
  );

  return (
    <ChartStrip
      title="Activity Mix"
      legend={legend}
      days={days}
      monthTicks={monthTicks}
      todayIdx={todayIdx}
    >
      {({ plotH, colW, barGap, barW, w }) => {
        const yForHours = (hours: number) => {
          const clamped = Math.min(hours, ACTIVITY_Y_MAX);
          return PAD_TOP + plotH * (1 - clamped / ACTIVITY_Y_MAX);
        };
        return (
          <>
            {/* Y-axis ticks every 6 hours */}
            {[6, 12, 18, 24].map((h) => (
              <g key={h}>
                <line
                  x1={PAD_LEFT}
                  x2={w - PAD_RIGHT}
                  y1={yForHours(h)}
                  y2={yForHours(h)}
                  stroke="rgba(255,255,255,0.04)"
                  strokeDasharray="3 4"
                />
                <text x={PAD_LEFT + 2} y={yForHours(h) - 2} fill="#666" fontSize={9}>{h}h</text>
              </g>
            ))}
            {stacksByCol.map((day) => {
              const x = PAD_LEFT + colW * day.i + barGap / 2;
              return (
                <g key={day.i}>
                  {day.segments.map((seg, j) => {
                    const top = yForHours(seg.baseHours + seg.hours);
                    const bottom = yForHours(seg.baseHours);
                    return (
                      <rect
                        key={j}
                        x={x}
                        y={top}
                        width={barW}
                        height={bottom - top}
                        fill={ACTIVITY_COLORS[seg.type] ?? ACTIVITY_COLORS.other ?? '#767676'}
                      />
                    );
                  })}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartStrip>
  );
}

// keep DayEntryRow import alive even if we don't directly reference it
void (null as unknown as DayEntryRow);
