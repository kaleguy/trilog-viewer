import { useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import {
  getActivityEntries,
  getCycleNotes,
  getDayEntriesRange,
  getHistoricalWeatherRange,
  getPomodoroCountsRange,
  type Conn_,
} from '../db/queries';
import {
  cycleColor,
  ENERGY_COLORS,
  MOOD_COLORS,
  type AirQualityDay,
  type ActivityEntry,
  type DayEntryRow,
  type HistoricalWeather,
  type NoteEntry,
  type PollenDay,
  type PressureData,
  type UvDay,
} from '../db/types';
import { MetricsCustomize } from './MetricsCustomize';
import './Metrics.css';

interface Props {
  conn: Conn_;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 60; // ~2 months

// ---- helpers ----------------------------------------------------------------

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtSleepDuration(d?: DayEntryRow): string {
  if (!d) return '—';
  if (d.hkSleepDuration != null) {
    const h = d.hkSleepDuration / 60;
    return h.toFixed(1);
  }
  if (d.sleepDurationHours != null) {
    const total =
      (d.sleepDurationHours ?? 0) + (d.sleepDurationMinutes ?? 0) / 60;
    return total.toFixed(1);
  }
  return '—';
}

interface ActivityTotals {
  // type lowercased → hours
  byType: Map<string, number>;
}

function aggregateActivities(activities: ActivityEntry[]): Map<string, ActivityTotals> {
  const out = new Map<string, ActivityTotals>();
  for (const a of activities) {
    const k = dateKey(new Date(a.timestamp));
    let bucket = out.get(k);
    if (!bucket) {
      bucket = { byType: new Map() };
      out.set(k, bucket);
    }
    const t = a.type.toLowerCase();
    const hours = a.duration ?? 0;
    bucket.byType.set(t, (bucket.byType.get(t) ?? 0) + hours);
  }
  return out;
}

// ---- per-day rolled-up data ------------------------------------------------

interface DayData {
  day: DayEntryRow | undefined;
  activities: ActivityTotals | undefined;
  cycleColorHex: string | undefined;
  pomodoros: number;
  weather: HistoricalWeather | undefined;
}

// ---- metric definitions ----------------------------------------------------

interface MetricDef {
  id: string;
  label: string;
  render: (d: DayData, day: Date) => React.ReactNode;
  defaultVisible: boolean;
}

function activityCell(d: DayData, type: string): React.ReactNode {
  const h = d.activities?.byType.get(type);
  if (h == null || h <= 0) return <Muted />;
  return <span>{h < 10 ? h.toFixed(1) : Math.round(h)}</span>;
}

function ratingCell(value: number | null | undefined, palette?: Record<number, string>): React.ReactNode {
  if (value == null) return <Muted />;
  const color = palette?.[value];
  return (
    <span
      className="rating-pill"
      style={color ? { backgroundColor: color, color: '#000' } : undefined}
    >
      {value}
    </span>
  );
}

function moodCell(d: DayData): React.ReactNode {
  if (!d.day?.mood) return <Muted />;
  const color = MOOD_COLORS[d.day.mood as keyof typeof MOOD_COLORS] ?? '#888';
  return <span className="mood-dot" style={{ backgroundColor: color }} />;
}

function colorCircle(text: string, color: string, fg = '#000'): React.ReactNode {
  return (
    <span
      className="color-circle"
      style={{ backgroundColor: color, color: fg }}
    >
      {text}
    </span>
  );
}

function parseJSON<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const METRICS: MetricDef[] = [
  // --- Engagement ---
  {
    id: 'pomodoro',
    label: 'Pomodoro',
    render: (d) => (d.pomodoros > 0 ? <span>{d.pomodoros}</span> : <Muted />),
    defaultVisible: true,
  },
  {
    id: 'steps',
    label: 'Steps',
    render: (d) => {
      const n = d.day?.steps;
      if (n == null) return <Muted />;
      return <span>{n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}</span>;
    },
    defaultVisible: true,
  },

  // --- Heart / body ---
  {
    id: 'rhr',
    label: 'Resting HR',
    render: (d) => <span>{fmtNum(d.day?.restingHeartRate)}</span>,
    defaultVisible: true,
  },
  {
    id: 'avgWeight',
    label: 'Avg Weight',
    render: (d) => <span>{fmtNum(d.day?.avgBodyWeight, 1)}</span>,
    defaultVisible: true,
  },
  {
    id: 'hrv',
    label: 'HRV',
    render: (d) => <span>{fmtNum(d.day?.hrv)}</span>,
    defaultVisible: true,
  },

  // --- Other devices ---
  {
    id: 'screenTime',
    label: 'Screen Time',
    // No screen-time column on day_entries; bundle may not include it.
    render: () => <Muted />,
    defaultVisible: true,
  },

  // --- Sleep (HK + manual) ---
  {
    id: 'hkSleep',
    label: 'HK Sleep',
    render: (d) =>
      d.day?.hkSleepDuration != null
        ? <span>{(d.day.hkSleepDuration / 60).toFixed(1)}</span>
        : <Muted />,
    defaultVisible: true,
  },
  {
    id: 'hkDeep',
    label: 'HK Deep',
    render: (d) =>
      d.day?.hkDeepSleep != null
        ? <span>{(d.day.hkDeepSleep / 60).toFixed(1)}</span>
        : <Muted />,
    defaultVisible: true,
  },
  {
    id: 'hkRem',
    label: 'HK REM',
    render: (d) =>
      d.day?.hkRemSleep != null
        ? <span>{(d.day.hkRemSleep / 60).toFixed(1)}</span>
        : <Muted />,
    defaultVisible: true,
  },
  {
    id: 'cycles',
    label: 'Cycles',
    render: (d) =>
      d.cycleColorHex
        ? <span className="cycle-pill" style={{ backgroundColor: d.cycleColorHex }} />
        : <Muted />,
    defaultVisible: true,
  },
  {
    id: 'calories',
    label: 'Calories',
    // Calories aren't a direct day_entries column; left as muted until we
    // wire HK calories or meals aggregation.
    render: () => <Muted />,
    defaultVisible: true,
  },

  // --- Environmental ---
  {
    id: 'pollen',
    label: 'Pollen',
    render: (d) => {
      const p = parseJSON<PollenDay>(d.day?.pollenData);
      if (!p || p.overall == null) return <Muted />;
      const colorByLevel = ['#666', '#3CB371', '#FFD700', '#FF8C00', '#FF4500', '#8B0000'];
      const level = Math.max(0, Math.min(5, Math.round(p.overall)));
      return colorCircle(String(level), colorByLevel[level], '#fff');
    },
    defaultVisible: true,
  },
  {
    id: 'airQuality',
    label: 'Air Quality',
    render: (d) => {
      const aq = parseJSON<AirQualityDay>(d.day?.airQualityData);
      if (!aq) return <Muted />;
      return colorCircle(String(Math.round(aq.aqi)), aq.aqiColor || '#888', '#000');
    },
    defaultVisible: true,
  },
  {
    id: 'uv',
    label: 'UV',
    render: (d) => {
      const uv = parseJSON<UvDay>(d.day?.uvData);
      if (!uv) return <Muted />;
      return colorCircle(String(Math.round(uv.uvIndex)), uv.uvColor || '#888', '#000');
    },
    defaultVisible: true,
  },
  {
    id: 'pressure',
    label: 'Pressure',
    render: (d) => {
      const p = parseJSON<PressureData>(d.day?.pressureData);
      if (!p || p.pressure_mean_hPa == null) return <Muted />;
      const trend =
        p.pressure_trend === 'rising' ? '↑' :
          p.pressure_trend === 'falling' ? '↓' :
            p.pressure_trend === 'steady' ? '→' : '';
      return <span>{Math.round(p.pressure_mean_hPa)}{trend}</span>;
    },
    defaultVisible: true,
  },
  {
    id: 'weather',
    label: 'Weather',
    render: (d) =>
      d.weather?.temperature != null
        ? <span>{Math.round(d.weather.temperature)}°</span>
        : <Muted />,
    defaultVisible: true,
  },

  // --- Activities (hours) ---
  { id: 'act-other', label: 'Other', render: (d) => activityCell(d, 'other'), defaultVisible: true },
  { id: 'act-transit', label: 'Transit', render: (d) => activityCell(d, 'transit'), defaultVisible: true },
  { id: 'act-socialize', label: 'Socialize', render: (d) => activityCell(d, 'socialize'), defaultVisible: true },
  { id: 'act-leisure', label: 'Leisure', render: (d) => activityCell(d, 'leisure'), defaultVisible: true },
  { id: 'act-exercise', label: 'Exercise', render: (d) => activityCell(d, 'exercise'), defaultVisible: true },
  { id: 'act-school', label: 'School', render: (d) => activityCell(d, 'school'), defaultVisible: true },
  { id: 'act-work', label: 'Work', render: (d) => activityCell(d, 'work'), defaultVisible: true },
  { id: 'act-sleep', label: 'Sleep', render: (d) => activityCell(d, 'sleep'), defaultVisible: true },

  // --- Sleep details (manual log) ---
  {
    id: 'sleepDuration',
    label: 'Sleep Duration',
    render: (d) => <span>{fmtSleepDuration(d.day)}</span>,
    defaultVisible: true,
  },
  {
    id: 'sleepWakeUps',
    label: 'Sleep Wake-ups',
    render: (d) => <span>{fmtNum(d.day?.sleepWakeUps)}</span>,
    defaultVisible: true,
  },
  {
    id: 'sleepWakeFeel',
    label: 'Sleep Wake Feel',
    render: (d) => ratingCell(d.day?.sleepWakeFeel),
    defaultVisible: true,
  },
  {
    id: 'sleepOnset',
    label: 'Sleep Onset',
    render: (d) => <span>{fmtNum(d.day?.sleepOnset)}</span>,
    defaultVisible: true,
  },
  {
    id: 'sleepQuality',
    label: 'Sleep Quality',
    render: (d) => ratingCell(d.day?.sleepQuality),
    defaultVisible: true,
  },

  // --- Day-end levels ---
  { id: 'energy', label: 'Energy', render: (d) => ratingCell(d.day?.energy, ENERGY_COLORS), defaultVisible: true },
  { id: 'wellness', label: 'Wellness', render: (d) => ratingCell(d.day?.wellnessLevel), defaultVisible: true },
  { id: 'mood', label: 'Mood', render: (d) => moodCell(d), defaultVisible: true },
  { id: 'thrive', label: 'Thrive', render: (d) => ratingCell(d.day?.onLevel), defaultVisible: true },
];

function Muted() {
  return <span className="muted">—</span>;
}

/**
 * Rendering shouldn't ever crash the whole tab. If a single metric blows
 * up — usually a JSON column whose shape doesn't match — fall back to the
 * muted placeholder and log to the console so we can find it.
 */
function safeRender(metric: MetricDef, data: DayData, day: Date): React.ReactNode {
  try {
    return metric.render(data, day);
  } catch (err) {
    console.warn(`[Metrics] render failed for ${metric.id} on ${day.toDateString()}`, err);
    return <Muted />;
  }
}

// ---- Metrics view component -------------------------------------------------

export function Metrics({ conn }: Props) {
  const [endDate, setEndDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [days, setDaysList] = useState<Date[]>([]);
  const [byDate, setByDate] = useState<Map<string, DayData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [customizing, setCustomizing] = useState(false);

  // Build the visible day window once per endDate change.
  useEffect(() => {
    const list: Date[] = [];
    for (let i = DEFAULT_DAYS - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      list.push(d);
    }
    setDaysList(list);
  }, [endDate]);

  const startMs = days[0]?.getTime();
  const endMs = days.length ? days[days.length - 1].getTime() + MS_PER_DAY : 0;
  const startDateKey = days[0] ? dateKey(days[0]) : '';
  const endDateKey = days.length ? dateKey(days[days.length - 1]) : '';

  useEffect(() => {
    if (!days.length) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getDayEntriesRange(conn, startDateKey, endDateKey),
      getActivityEntries(conn, startMs, endMs),
      getCycleNotes(conn, startMs - 30 * MS_PER_DAY, endMs),
      getPomodoroCountsRange(conn, startMs, endMs),
      getHistoricalWeatherRange(conn, startDateKey, endDateKey),
    ])
      .then(([dayRows, activities, cycles, pomos, weather]) => {
        if (cancelled) return;
        const dayByKey = new Map(dayRows.map((r) => [r.dateKey, r]));
        const actByKey = aggregateActivities(activities);
        const cycleByKey = buildCycleMap(cycles);
        const pomoByKey = new Map(pomos.map((p) => [p.dateKey, p.count]));
        const weatherByKey = new Map(weather.map((w) => [w.dateKey, w]));

        const merged = new Map<string, DayData>();
        for (const d of days) {
          const k = dateKey(d);
          merged.set(k, {
            day: dayByKey.get(k),
            activities: actByKey.get(k),
            cycleColorHex: cycleByKey.get(k),
            pomodoros: pomoByKey.get(k) ?? 0,
            weather: weatherByKey.get(k),
          });
        }
        setByDate(merged);
      })
      .catch((err) => console.error('[Metrics] fetch failed', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [conn, days, startMs, endMs, startDateKey, endDateKey]);

  const visibleMetrics = useMemo(
    () => METRICS.filter((m) => !hidden.has(m.id)),
    [hidden]
  );

  const stepBack = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - DEFAULT_DAYS);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() + DEFAULT_DAYS);
    const today = startOfLocalDay(new Date());
    setEndDate(d > today ? today : d);
  };

  const todayMs = startOfLocalDay(new Date()).getTime();

  return (
    <div className="metrics">
      <div className="metrics-toolbar">
        <button
          type="button"
          className="metrics-icon-btn"
          aria-label="Customize metrics"
          onClick={() => setCustomizing(true)}
        >
          <SettingsIcon size={16} />
        </button>

        <div className="metrics-date-nav">
          <button type="button" onClick={stepBack}>‹</button>
          <span className="metrics-date-range">
            {days[0]?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {' – '}
            {days[days.length - 1]?.toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </span>
          <button type="button" onClick={stepForward}>›</button>
        </div>

        {loading && <span className="metrics-loading">Loading…</span>}
      </div>

      <div className="metrics-scroll">
        <table className="metrics-table">
          <thead>
            <tr>
              <th className="label-cell" />
              {days.map((d) => {
                const isFirstOfMonth = d.getDate() === 1;
                const isToday = startOfLocalDay(d).getTime() === todayMs;
                return (
                  <th
                    key={d.toISOString()}
                    className={`day-head${isToday ? ' today' : ''}`}
                    title={d.toLocaleDateString(undefined, {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  >
                    <div className="day-head-num">{d.getDate()}</div>
                    {isFirstOfMonth && (
                      <div className="day-head-month">
                        {d.toLocaleDateString(undefined, { month: 'short' })}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleMetrics.map((metric) => (
              <tr key={metric.id}>
                <td className="label-cell">{metric.label}</td>
                {days.map((d) => {
                  const data = byDate.get(dateKey(d));
                  return (
                    <td key={d.toISOString()} className="metric-cell">
                      {data ? safeRender(metric, data, d) : <Muted />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MetricsCustomize
        open={customizing}
        metrics={METRICS.map((m) => ({ id: m.id, label: m.label }))}
        hidden={hidden}
        onChange={setHidden}
        onClose={() => setCustomizing(false)}
      />
    </div>
  );
}

// Local cycle-map builder so we don't introduce a viewer-wide dependency
// from the chart module.
function buildCycleMap(cycles: NoteEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  const sorted = [...cycles].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length; i++) {
    const start = startOfLocalDay(new Date(sorted[i].timestamp));
    const next = sorted[i + 1] ? startOfLocalDay(new Date(sorted[i + 1].timestamp)) : null;
    const defaultEnd = new Date(start);
    defaultEnd.setDate(defaultEnd.getDate() + 7);
    const end = next && next.getTime() < defaultEnd.getTime() ? next : defaultEnd;
    const cursor = new Date(start);
    while (cursor.getTime() < end.getTime()) {
      m.set(dateKey(cursor), cycleColor(sorted[i].cycleColor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return m;
}
