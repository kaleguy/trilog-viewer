import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Apple,
  Bandage,
  Bed,
  Briefcase,
  Car,
  Cloud,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Flower,
  Footprints,
  Gauge,
  GraduationCap,
  Heart,
  HeartPulse,
  MoreHorizontal,
  Moon,
  Pill,
  Scale,
  Settings as SettingsIcon,
  Signal,
  Smartphone,
  Smile,
  Sun,
  Thermometer,
  Type as TypeIcon,
  Users,
  Wind,
  Zap,
} from 'lucide-react';
import {
  getActivityEntries,
  getCycleNotes,
  getDailyCaloriesRange,
  getDayEntriesRange,
  getHistoricalWeatherRange,
  getPomodoroCountsRange,
  type Conn_,
} from '../db/queries';
import {
  activityColor,
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
import { pickWeatherIcon } from './weatherIcon';
import './Metrics.css';

interface Props {
  conn: Conn_;
  settings?: Record<string, string>;
}

/**
 * Map the iPhone WeekView's row labels (the keys in the persisted
 * `weekViewVisibleRows` zustand state) to this viewer's metric IDs.
 * Anything not in the map (older bundle, mismatched name) is left at
 * its viewer default.
 */
const IPHONE_LABEL_TO_METRIC_ID: Record<string, string> = {
  Mood: 'mood',
  Energy: 'energy',
  Wellness: 'wellness',
  On: 'thrive',
  Steps: 'steps',
  'Resting HR': 'rhr',
  'Avg Weight': 'avgWeight',
  HRV: 'hrv',
  'Screen Time': 'screenTime',
  'HK Sleep': 'hkSleep',
  'HK Deep': 'hkDeep',
  'HK REM': 'hkRem',
  Weather: 'weatherIcon',
  Temp: 'weather',
  Humidity: 'humidity',
  Pressure: 'pressure',
  Barom: 'barom',
  Pollen: 'pollen',
  'Air Quality': 'airQuality',
  UV: 'uv',
  Calories: 'calories',
  Cycles: 'cycles',
  'Sleep Quality': 'sleepQuality',
  'Sleep Onset': 'sleepOnset',
  'Sleep Wake Feel': 'sleepWakeFeel',
  'Sleep Wake-ups': 'sleepWakeUps',
  'Sleep Duration': 'sleepDuration',
  Sleep: 'act-sleep',
  Work: 'act-work',
  School: 'act-school',
  Exercise: 'act-exercise',
  Leisure: 'act-leisure',
  Socialize: 'act-socialize',
  Transit: 'act-transit',
  Other: 'act-other',
  Pomodoro: 'pomodoro',
};

/**
 * Icon to render for each metric when iconMode is on. Keyed by the
 * viewer's metric id (not the iPhone label) so it stays in sync with
 * the METRICS array regardless of label-vs-id divergence (e.g. iPhone
 * 'On' vs viewer 'thrive'). Matches the iPhone's getRowIcon mapping.
 */
const METRIC_ICON: Record<string, { Icon: React.ComponentType<{ size?: number; color?: string }>; color?: string }> = {
  thrive: { Icon: Signal },
  mood: { Icon: Smile },
  energy: { Icon: Zap },
  wellness: { Icon: Heart },
  sleepQuality: { Icon: Bed, color: '#60A5FA' },
  sleepOnset: { Icon: Bed, color: '#60A5FA' },
  sleepWakeFeel: { Icon: Bed, color: '#60A5FA' },
  sleepWakeUps: { Icon: Bed, color: '#60A5FA' },
  sleepDuration: { Icon: Bed, color: '#60A5FA' },
  'act-sleep': { Icon: Bed, color: '#4A4A4A' },
  cycles: { Icon: Moon },
  'act-work': { Icon: Briefcase, color: '#2E6BC7' },
  'act-school': { Icon: GraduationCap, color: '#CC3333' },
  'act-exercise': { Icon: Dumbbell, color: '#FF8800' },
  'act-leisure': { Icon: Coffee, color: '#9932CC' },
  'act-socialize': { Icon: Users, color: '#00CC55' },
  'act-transit': { Icon: Car, color: '#5BA3FF' },
  'act-other': { Icon: MoreHorizontal, color: '#767676' },
  pomodoro: { Icon: Apple },
  steps: { Icon: Footprints },
  rhr: { Icon: HeartPulse },
  avgWeight: { Icon: Scale },
  hrv: { Icon: Activity },
  screenTime: { Icon: Smartphone },
  hkSleep: { Icon: Moon, color: '#60A5FA' },
  hkDeep: { Icon: Moon, color: '#818CF8' },
  hkRem: { Icon: Moon, color: '#A78BFA' },
  weather: { Icon: Thermometer },
  weatherIcon: { Icon: Cloud },
  humidity: { Icon: Droplets },
  pressure: { Icon: Gauge },
  barom: { Icon: Gauge },
  pollen: { Icon: Flower },
  airQuality: { Icon: Wind },
  uv: { Icon: Sun },
  calories: { Icon: Flame },
};

function hiddenIdsFromIphoneSettings(settings?: Record<string, string>): Set<string> {
  if (!settings?.weekViewVisibleRows) return new Set();
  try {
    const parsed = JSON.parse(settings.weekViewVisibleRows) as Record<string, boolean>;
    const hidden = new Set<string>();
    for (const [label, visible] of Object.entries(parsed)) {
      if (visible === false) {
        const id = IPHONE_LABEL_TO_METRIC_ID[label];
        if (id) hidden.add(id);
      }
    }
    return hidden;
  } catch {
    return new Set();
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// 6 calendar weeks. Anchored to a Saturday end → leftmost column
// is always Sunday. Step navigation moves by exactly one week, so
// the Sun-Sat layout stays put across all views.
const DEFAULT_DAYS = 42;

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

/**
 * ISO 8601 week number — Monday-anchored, week containing the first
 * Thursday of the year is week 1. Same algorithm the iPhone WeekView
 * uses, so the viewer's "Week N" matches.
 */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

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
  calories: number;
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
  // Tint the hour total in the activity's brand color so rows are
  // identifiable at a glance — same colors the iPhone WeekView uses.
  return (
    <span style={{ color: activityColor(type), fontWeight: 600 }}>
      {h < 10 ? h.toFixed(1) : Math.round(h)}
    </span>
  );
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

const MOOD_ORDER = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;

function moodCell(d: DayData): React.ReactNode {
  // Preferred: 5-segment proportional bar from `moodValues` — matches
  // the iPhone MiniMoodBar. Fall back to the legacy single-mood dot.
  const raw = d.day?.moodValues;
  if (raw) {
    try {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr) && arr.length === 5) {
        const total = arr.reduce((s, v) => s + (v > 0 ? v : 0), 0);
        if (total > 0) {
          return (
            <span className="mini-mood-bar">
              {arr.map((value, i) => {
                if (value <= 0) return null;
                const color = MOOD_COLORS[MOOD_ORDER[i] as keyof typeof MOOD_COLORS] ?? '#888';
                return (
                  <span
                    key={i}
                    className="mini-mood-seg"
                    style={{ flexGrow: value, backgroundColor: color }}
                  />
                );
              })}
            </span>
          );
        }
      }
    } catch { /* fall through */ }
  }
  if (d.day?.mood) {
    const color = MOOD_COLORS[d.day.mood as keyof typeof MOOD_COLORS] ?? '#888';
    return <span className="mood-dot" style={{ backgroundColor: color }} />;
  }
  return <Muted />;
}

/**
 * Wellness level (1–5) → tinted Lucide icon. Same mapping the iPhone
 * WeekView uses: thermometer/red for "sick" through heart-pulse/green
 * for "great".
 */
const WELLNESS_ICONS: { Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; color: string }[] = [
  { Icon: Thermometer, color: '#FF3B30' },
  { Icon: Pill, color: '#FF9500' },
  { Icon: Bandage, color: '#FFCC00' },
  { Icon: Heart, color: '#8BC34A' },
  { Icon: HeartPulse, color: '#34C759' },
];

function wellnessCell(value: number | null | undefined): React.ReactNode {
  if (value == null || value < 1 || value > 5) return <Muted />;
  const { Icon, color } = WELLNESS_ICONS[value - 1];
  return <Icon size={16} color={color} strokeWidth={2} />;
}

/**
 * 5-bar ascending signal indicator — mirrors the iOS WeekView's Thrive
 * cell rendering. Bars 1..value are filled green; the rest are
 * inactive grey.
 */
function signalBars(value: number | null | undefined): React.ReactNode {
  if (value == null || value <= 0) return <Muted />;
  return (
    <span className="signal-bars">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`signal-bar${i <= value ? ' filled' : ''}`}
          style={{ height: `${(i / 5) * 100}%` }}
        />
      ))}
    </span>
  );
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
    render: (d) => {
      const m = d.day?.screenTimeMinutes;
      if (m == null || m <= 0) return <Muted />;
      // Same format the iOS WeekView cell uses: H:MM, h, or Nm.
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return <span>{mm > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${h}h`}</span>;
      }
      return <span>{m}m</span>;
    },
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
    // HealthKit dietary total wins when present (mirror of the iOS
    // WeekView's `useHealthKitCalories` precedence); otherwise fall
    // back to the meal-note SUM. Both yield a single kcal total.
    render: (d) => {
      const hk = d.day?.hkDietaryCalories;
      const value = hk != null && hk > 0 ? hk : d.calories;
      if (!value || value <= 0) return <Muted />;
      const n = Math.round(value);
      return <span>{n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}</span>;
    },
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
      return <span>{Math.round(p.pressure_mean_hPa)}</span>;
    },
    defaultVisible: true,
  },
  {
    id: 'barom',
    label: 'Barom',
    // Trend indicator only — matches the iPhone Barom row (colored
    // dot for rising/steady/falling). Numeric pressure lives on the
    // Pressure row.
    render: (d) => {
      const p = parseJSON<PressureData>(d.day?.pressureData);
      if (!p) return <Muted />;
      const trend = p.pressure_trend;
      if (trend !== 'rising' && trend !== 'falling' && trend !== 'steady') return <Muted />;
      const color =
        trend === 'rising' ? '#FF3B30' :
          trend === 'falling' ? '#007AFF' :
            '#34C759';
      return <span className="cycle-pill" style={{ backgroundColor: color, width: 10, height: 10, borderRadius: 5 }} />;
    },
    defaultVisible: true,
  },
  {
    id: 'weather',
    label: 'Temp',
    render: (d) =>
      d.weather?.temperature != null
        ? <span>{Math.round(d.weather.temperature)}°</span>
        : <Muted />,
    defaultVisible: true,
  },
  {
    id: 'weatherIcon',
    label: 'Weather',
    // iPhone WeekView's Weather row is just the icon — no temperature.
    // We split the two into separate rows in the viewer so a wide
    // screen can show both at a glance.
    render: (d) => {
      const w = d.weather;
      if (!w?.shortForecast) return <Muted />;
      const Icon = pickWeatherIcon(w.shortForecast);
      return <Icon size={16} color="#ddd" />;
    },
    defaultVisible: true,
  },
  {
    id: 'humidity',
    label: 'Humidity',
    // Pro/Google path only — `humidityPercent` comes from the
    // currentConditions response and is persisted on the
    // historical_weather row.
    render: (d) => {
      const h = d.weather?.humidityPercent;
      if (h == null) return <Muted />;
      return <span>{Math.round(h)}%</span>;
    },
    defaultVisible: false,
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
  { id: 'wellness', label: 'Wellness', render: (d) => wellnessCell(d.day?.wellnessLevel), defaultVisible: true },
  { id: 'mood', label: 'Mood', render: (d) => moodCell(d), defaultVisible: true },
  { id: 'thrive', label: 'Thrive', render: (d) => signalBars(d.day?.onLevel), defaultVisible: true },
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

/** Saturday of the week containing `date`, or `date` itself if it's
 *  already Saturday. Used so the rightmost column is always a Sat
 *  and the 45-day window starts on a Thursday regardless of weekday
 *  the viewer is opened on. Future days appear as blank cells. */
function thisOrNextSaturday(date: Date): Date {
  const result = startOfLocalDay(date);
  const offset = (6 - result.getDay() + 7) % 7;
  if (offset > 0) result.setDate(result.getDate() + offset);
  return result;
}

export function Metrics({ conn, settings }: Props) {
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));
  const [days, setDaysList] = useState<Date[]>([]);
  const [byDate, setByDate] = useState<Map<string, DayData>>(new Map());
  const [loading, setLoading] = useState(false);
  // Seed hidden rows from the iPhone WeekView's persisted visibility
  // map (stamped into app_settings at export). Bundles from older
  // builds don't include the key — that's fine, defaults to empty.
  const [hidden, setHidden] = useState<Set<string>>(() => hiddenIdsFromIphoneSettings(settings));
  const [customizing, setCustomizing] = useState(false);
  // Mirror the iPhone WeekView's icon mode. The setting is exported
  // alongside the visibility map; default to off when missing.
  const [iconMode, setIconMode] = useState<boolean>(
    () => settings?.weekViewIconMode === 'true'
  );

  // Re-seed when a new bundle is opened (settings reference changes).
  useEffect(() => {
    setHidden(hiddenIdsFromIphoneSettings(settings));
    setIconMode(settings?.weekViewIconMode === 'true');
  }, [settings]);

  // Build the visible day window — always exactly DEFAULT_DAYS
  // columns ending on `endDate`. Because `endDate` is anchored to a
  // Saturday and stepping is in whole weeks, the weekday layout
  // stays consistent across navigation. Days past today still render
  // as columns; their cells naturally come back empty (no data).
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
      getDailyCaloriesRange(conn, startMs, endMs),
      getHistoricalWeatherRange(conn, startDateKey, endDateKey),
    ])
      .then(([dayRows, activities, cycles, pomos, cals, weather]) => {
        if (cancelled) return;
        const dayByKey = new Map(dayRows.map((r) => [r.dateKey, r]));
        const actByKey = aggregateActivities(activities);
        const cycleByKey = buildCycleMap(cycles);
        const pomoByKey = new Map(pomos.map((p) => [p.dateKey, p.count]));
        const calByKey = new Map(cals.map((c) => [c.dateKey, c.calories]));
        const weatherByKey = new Map(weather.map((w) => [w.dateKey, w]));

        const merged = new Map<string, DayData>();
        for (const d of days) {
          const k = dateKey(d);
          merged.set(k, {
            day: dayByKey.get(k),
            activities: actByKey.get(k),
            cycleColorHex: cycleByKey.get(k),
            pomodoros: pomoByKey.get(k) ?? 0,
            calories: calByKey.get(k) ?? 0,
            weather: weatherByKey.get(k),
          });
        }
        setByDate(merged);
      })
      .catch((err) => console.error('[Metrics] fetch failed', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [conn, days, startMs, endMs, startDateKey, endDateKey]);

  // METRICS is in iPhone's `rowLabels` array order, which the iPhone
  // reverses before rendering (last-in-array = top of grid). Mirror
  // that reverse here so Thrive lands on top, Pomodoro on bottom.
  const visibleMetrics = useMemo(
    () => METRICS.filter((m) => !hidden.has(m.id)).reverse(),
    [hidden]
  );

  // Navigation steps one whole week at a time so the weekday
  // alignment (Sat end / Thu start) is preserved. Forward step caps
  // at the current week's Saturday so users can't scroll past it.
  const stepBack = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - 7);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() + 7);
    const currentSaturday = thisOrNextSaturday(new Date());
    setEndDate(d > currentSaturday ? currentSaturday : d);
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
        <button
          type="button"
          className={`metrics-icon-btn${iconMode ? ' active' : ''}`}
          aria-label={iconMode ? 'Show row labels as text' : 'Show row labels as icons'}
          title={iconMode ? 'Row labels: icons' : 'Row labels: text'}
          onClick={() => setIconMode((v) => !v)}
        >
          <TypeIcon size={16} />
        </button>

        <div className="metrics-date-nav">
          <button type="button" onClick={stepBack}>‹</button>
          <span className="metrics-date-range">
            {days.length > 0 ? `Week ${isoWeekNumber(days[days.length - 1])}` : ''}
          </span>
          <button type="button" onClick={stepForward}>›</button>
        </div>

        {loading && <span className="metrics-loading">Loading…</span>}
      </div>

      <div className="metrics-scroll">
        <table className="metrics-table">
          <thead>
            <tr>
              <th className={`label-cell${iconMode ? ' icon-mode' : ''}`} />
              {days.map((d) => {
                const isFirstOfMonth = d.getDate() === 1;
                const isToday = startOfLocalDay(d).getTime() === todayMs;
                // Top line: month abbr on the 1st of the month,
                // otherwise the day-of-week letter (S M T W T F S).
                const topLine = isFirstOfMonth
                  ? d.toLocaleDateString(undefined, { month: 'short' })
                  : WEEKDAY_LETTERS[d.getDay()];
                return (
                  <th
                    key={d.toISOString()}
                    className={`day-head${isToday ? ' today' : ''}`}
                    title={d.toLocaleDateString(undefined, {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  >
                    <div className={`day-head-top${isFirstOfMonth ? ' month' : ''}`}>
                      {topLine}
                    </div>
                    <div className="day-head-num">{d.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleMetrics.map((metric) => {
              const iconDef = iconMode ? METRIC_ICON[metric.id] : undefined;
              return (
              <tr key={metric.id}>
                <td className={`label-cell${iconMode ? ' icon-mode' : ''}`} title={metric.label}>
                  {iconDef ? (
                    <iconDef.Icon size={18} color={iconDef.color ?? '#ddd'} />
                  ) : (
                    metric.label
                  )}
                </td>
                {days.map((d) => {
                  const data = byDate.get(dateKey(d));
                  return (
                    <td key={d.toISOString()} className="metric-cell">
                      {data ? safeRender(metric, data, d) : <Muted />}
                    </td>
                  );
                })}
              </tr>
              );
            })}
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
