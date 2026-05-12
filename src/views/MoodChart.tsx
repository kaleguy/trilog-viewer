import { useEffect, useMemo, useState } from 'react';
import { Utensils, HeartPulse, Moon, FileText, Tag } from 'lucide-react';
import {
  getActivityEntries,
  getCustomTrackingItems,
  type CustomTrackingItem,
  getCycleNotes,
  getEnergyEntries,
  getHistoricalWeatherRange,
  getMoodEntries,
  getNoteEntries,
  type Conn_,
} from '../db/queries';
import {
  activityColor,
  cycleColor,
  ENERGY_COLORS,
  MOOD_COLORS,
  type ActivityEntry,
  type EnergyEntry,
  type HistoricalWeather,
  type MoodEntry,
  type NoteEntry,
} from '../db/types';
import { pickWeatherIcon } from './weatherIcon';
import { moonSpriteStyle } from './moonPhase';
import './MoodChart.css';

type VisibilityState = 'all' | 'mood' | 'energy' | 'activity';

interface Props {
  conn: Conn_;
  settings: Record<string, string>;
  viewerSettings: { showCycles: boolean; showWeather: boolean; showMoonPhases: boolean };
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DEFAULT_DAYS_ALL = 30;
const DEFAULT_DAYS_SINGLE = 90;
const DEFAULT_ACTIVITY_HOURS = 1;
const MIN_BAR_HEIGHT_PCT = 0.3;
const CYCLE_PHASE_DAYS = 7;
const CYCLE_LOOKBACK_DAYS = 30; // pull cycle notes from before the visible
                                // window so a phase that started earlier
                                // still paints its remaining days
const WEATHER_ROW_PX = 36;
const CYCLE_ROW_PX = 14;
const MOON_ROW_PX = 22;
const MOON_ICON_PX = 18;

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
 * Effective end with "Fill in Gaps" treated as globally on:
 *   - Always extend each activity forward to the start of the next one,
 *     overriding any explicit endTimestamp. This produces the continuous
 *     "every minute is some activity" look from the iOS chart.
 *   - Last activity in the series falls back to its endTimestamp, or to
 *     `duration` hours past its start (1h if neither is set).
 *
 * TODO: when we add a viewer settings menu, gate this on the equivalent of
 * iOS's per-entry fillGaps flag instead of forcing it.
 */
function computeEffectiveEnds(activities: ActivityEntry[]): ActivityEntry[] {
  if (activities.length === 0) return activities;
  const sorted = [...activities].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.map((entry, i) => {
    const next = sorted[i + 1];
    if (next) return { ...entry, endTimestamp: next.timestamp };
    if (entry.endTimestamp != null) return entry;
    const naturalEnd = entry.timestamp + (entry.duration || DEFAULT_ACTIVITY_HOURS) * MS_PER_HOUR;
    return { ...entry, endTimestamp: naturalEnd };
  });
}

interface DayBucket {
  date: Date;
  key: string;
  moods: MoodEntry[];
  energies: EnergyEntry[];
  activities: ActivityEntry[];
  notes: NoteEntry[];
}

function bucketByDay(
  days: Date[],
  moods: MoodEntry[],
  energies: EnergyEntry[],
  activities: ActivityEntry[],
  notes: NoteEntry[]
): DayBucket[] {
  const buckets: DayBucket[] = days.map((date) => ({
    date,
    key: dateKey(date),
    moods: [],
    energies: [],
    activities: [],
    notes: [],
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const e of moods) {
    const b = byKey.get(dateKey(new Date(e.timestamp)));
    if (b) b.moods.push(e);
  }
  for (const e of energies) {
    const b = byKey.get(dateKey(new Date(e.timestamp)));
    if (b) b.energies.push(e);
  }
  for (const e of notes) {
    const b = byKey.get(dateKey(new Date(e.timestamp)));
    if (b) b.notes.push(e);
  }

  // Activities: place on every day they overlap. Each receiving day will
  // clamp the bar to its own day boundary at render time.
  for (const e of activities) {
    const startDay = startOfLocalDay(new Date(e.timestamp));
    const end = e.endTimestamp ?? e.timestamp + DEFAULT_ACTIVITY_HOURS * MS_PER_HOUR;
    let cursor = new Date(startDay);
    while (cursor.getTime() < end) {
      const b = byKey.get(dateKey(cursor));
      if (b) b.activities.push(e);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return buckets;
}

export function MoodChart({ conn, settings, viewerSettings }: Props) {
  // settings: read-only snapshot from the bundle (lat/lng for future
  // sun-times, theme, etc.). Currently unused on the chart side — the
  // header label in App.tsx is the only consumer.
  void settings;

  const [visibility, setVisibility] = useState<VisibilityState>('all');
  const [showNotes, setShowNotes] = useState(true);
  const [selectedNote, setSelectedNote] = useState<NoteEntry | null>(null);
  const [trackerItems, setTrackerItems] = useState<CustomTrackingItem[]>([]);
  const trackerKeys = useMemo(() => buildTrackerKeySet(trackerItems), [trackerItems]);

  // Custom tracker definitions don't change with the visible date
  // window — pull them once and cache. The note popup uses them to
  // enrich "t key value" notes with the tracker's label / type /
  // category; the marker uses them to pick the Tag icon.
  useEffect(() => {
    let cancelled = false;
    getCustomTrackingItems(conn)
      .then((items) => { if (!cancelled) setTrackerItems(items); })
      .catch(() => { /* table may not exist on older bundles */ });
    return () => { cancelled = true; };
  }, [conn]);

  // Close note popup on Escape.
  useEffect(() => {
    if (!selectedNote) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNote(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNote]);
  const [endDate, setEndDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [energies, setEnergies] = useState<EnergyEntry[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [cycles, setCycles] = useState<NoteEntry[]>([]);
  const [weather, setWeather] = useState<HistoricalWeather[]>([]);
  const [loading, setLoading] = useState(false);

  // 30 days when all 3 metrics are visible (3 sub-cols × 30 = 90 narrow cols).
  // 90 days in single-view (1 sub-col × 90 = 90) so per-sub-column width matches.
  const daysToShow = visibility === 'all' ? DEFAULT_DAYS_ALL : DEFAULT_DAYS_SINGLE;

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      out.push(d);
    }
    return out;
  }, [endDate, daysToShow]);

  const startMs = days[0].getTime();
  const endMs = days[days.length - 1].getTime() + MS_PER_DAY;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Fetch a wider window for activities so cross-day extension at the edges
    // has neighbors to anchor to. Cycles get an even wider lookback so a
    // phase that started before the visible range still paints its tail.
    const padMs = 2 * MS_PER_DAY;
    const cycleLookbackMs = CYCLE_LOOKBACK_DAYS * MS_PER_DAY;
    // Serialize the six invokes. Running them in parallel via
    // Promise.all was contributing to tauri-plugin-sql IPC deadlocks
    // after a few rounds of date navigation.
    (async () => {
      const breather = () => new Promise((r) => setTimeout(r, 30));
      try {
        const m = await getMoodEntries(conn, startMs, endMs);
        if (cancelled) return;
        await breather();
        const e = await getEnergyEntries(conn, startMs, endMs);
        if (cancelled) return;
        await breather();
        const a = await getActivityEntries(conn, startMs - padMs, endMs + padMs);
        if (cancelled) return;
        await breather();
        const n = await getNoteEntries(conn, startMs, endMs);
        if (cancelled) return;
        await breather();
        const c = await getCycleNotes(conn, startMs - cycleLookbackMs, endMs);
        if (cancelled) return;
        await breather();
        const w = await getHistoricalWeatherRange(
          conn,
          dateKey(new Date(startMs)),
          dateKey(new Date(endMs - 1))
        );
        if (cancelled) return;
        setMoods(m);
        setEnergies(e);
        setActivities(computeEffectiveEnds(a));
        setNotes(n);
        setCycles(c);
        setWeather(w);
      } catch (err) {
        console.error('[MoodChart] query failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn, startMs, endMs]);

  const buckets = useMemo(
    () => bucketByDay(days, moods, energies, activities, notes),
    [days, moods, energies, activities, notes]
  );

  // dateKey → cycle phase color. Each cycle note's phase runs for
  // CYCLE_PHASE_DAYS days OR until the next cycle note's day, whichever
  // is sooner. Computed once per cycles change.
  const cycleByDate = useMemo(() => {
    const m = new Map<string, string>();
    const sorted = [...cycles].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length; i++) {
      const start = startOfLocalDay(new Date(sorted[i].timestamp));
      const next = sorted[i + 1] ? startOfLocalDay(new Date(sorted[i + 1].timestamp)) : null;
      const defaultEnd = new Date(start);
      defaultEnd.setDate(defaultEnd.getDate() + CYCLE_PHASE_DAYS);
      const end = next && next.getTime() < defaultEnd.getTime() ? next : defaultEnd;
      const cursor = new Date(start);
      while (cursor.getTime() < end.getTime()) {
        m.set(dateKey(cursor), cycleColor(sorted[i].cycleColor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return m;
  }, [cycles]);

  const weatherByDate = useMemo(() => {
    const m = new Map<string, HistoricalWeather>();
    for (const w of weather) m.set(w.dateKey, w);
    return m;
  }, [weather]);

  const showMood = visibility === 'all' || visibility === 'mood';
  const showEnergy = visibility === 'all' || visibility === 'energy';
  const showActivity = visibility === 'all' || visibility === 'activity';

  // Step the window by one calendar month so the user can scrub
  // through history without skipping `daysToShow` (90 days at the
  // 'all' zoom) in a single click.
  const stepBack = () => {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() - 1);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() + 1);
    const today = startOfLocalDay(new Date());
    setEndDate(d > today ? today : d);
  };

  return (
    <div className="moodchart">
      <div className="moodchart-toolbar">
        <div className="toggle-group">
          {(['all', 'mood', 'energy', 'activity'] as VisibilityState[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`toggle ${visibility === v ? 'active' : ''}`}
              onClick={() => setVisibility(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <label className="notes-toggle">
          <input
            type="checkbox"
            checked={showNotes}
            onChange={(e) => setShowNotes(e.target.checked)}
          />
          Notes
        </label>

        <div className="date-nav">
          <button type="button" onClick={stepBack}>‹</button>
          <span className="date-range">
            {days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {' – '}
            {days[days.length - 1].toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <button type="button" onClick={stepForward}>›</button>
        </div>

        {loading && <span className="loading">Loading…</span>}
      </div>

      <ChartGrid
        buckets={buckets}
        showMood={showMood}
        showEnergy={showEnergy}
        showActivity={showActivity}
        showNotes={showNotes}
        showCycles={viewerSettings.showCycles}
        showWeather={viewerSettings.showWeather}
        showMoonPhases={viewerSettings.showMoonPhases}
        cycleByDate={cycleByDate}
        weatherByDate={weatherByDate}
        onNoteClick={setSelectedNote}
        trackerKeys={trackerKeys}
      />

      {/* Note popup — click a marker in the chart to open. Click the
          backdrop, the close button, or press Esc to dismiss. */}
      {selectedNote && (
        <NotePopup
          note={selectedNote}
          trackerItems={trackerItems}
          onClose={() => setSelectedNote(null)}
        />
      )}
    </div>
  );
}

interface NotePopupProps {
  note: NoteEntry;
  trackerItems: CustomTrackingItem[];
  onClose: () => void;
}

interface ParsedTrackerNote {
  key: string;
  value: number | null;
  isNegative: boolean;
  trailing: string;
}

/**
 * Parse a "t key value …" or "track key value …" note. Returns null
 * if the note doesn't look like a tracker entry. Mirrors the iPhone
 * parser semantics enough for display purposes (the full
 * customTrackingParser is used for aggregation elsewhere).
 */
function parseTrackerNote(text: string): ParsedTrackerNote | null {
  const m = /^\s*(?:t|track)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(-?\d+(?:\.\d+)?))?(.*)$/i.exec(text || '');
  if (!m) return null;
  const key = m[1].toLowerCase();
  const value = m[2] ? parseFloat(m[2]) : null;
  let trailing = (m[3] || '').trim();
  let isNegative = false;
  // No numeric value but a leading "-" means an "off" / negative
  // flag — e.g. `t vegan - cheated at lunch` for a toggle.
  if (m[2] === undefined && trailing.startsWith('-')) {
    const rest = trailing.slice(1).trimStart();
    if (!/^\d/.test(rest)) {
      isNegative = true;
      trailing = rest;
    }
  }
  return { key, value: value !== null && !Number.isNaN(value) ? value : null, isNegative, trailing };
}

function normalizeTrackerType(t: string | null, isNumeric: number): string {
  let type = t ?? (isNumeric ? 'sum' : 'text');
  if (type === 'non_numeric') type = 'text';
  if (type === 'currency') type = 'sum';
  return type;
}

const TRACKER_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  traffic_light: 'Traffic Light',
  itemized_list: 'Itemized List',
  toggle: 'Toggle',
};

const TRAFFIC_LIGHT_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#8BC34A', '#34C759'];

function NotePopup({ note, trackerItems, onClose }: NotePopupProps) {
  // Build a label → tracker map once (handles both "t key" and
  // "track LabelName" usages).
  const byKey = new Map<string, CustomTrackingItem>();
  const byLabel = new Map<string, CustomTrackingItem>();
  for (const item of trackerItems) {
    if (item.key) byKey.set(item.key.toLowerCase(), item);
    if (item.label) byLabel.set(item.label.toLowerCase(), item);
  }

  const parsed = parseTrackerNote(note.text);
  const trackerItem = parsed
    ? (byKey.get(parsed.key) ?? byLabel.get(parsed.key))
    : undefined;
  const isTrackerNote = !!parsed && !!trackerItem;

  // Pick a human label + accent color matching the marker icon.
  let kind = 'Note';
  let accent = '#9CA3AF';
  if (note.isCycle) { kind = 'Cycle'; accent = '#FF6B9D'; }
  else if (note.isMeal) { kind = 'Meal'; accent = '#FF9500'; }
  else if (note.isHealth) { kind = 'Health'; accent = '#34C759'; }
  else if (isTrackerNote) { kind = 'Tracker'; accent = '#4A90C2'; }

  const dt = new Date(note.timestamp);
  const dateLine = dt.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeLine = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="note-popup-overlay" onClick={onClose}>
      <div className="note-popup" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="note-popup-close" onClick={onClose} aria-label="Close">×</button>
        <div className="note-popup-header">
          <span className="note-popup-kind" style={{ background: accent }}>{kind}</span>
          <div className="note-popup-time">
            <div className="note-popup-date">{dateLine}</div>
            <div className="note-popup-clock">{timeLine}</div>
          </div>
        </div>

        {isTrackerNote && trackerItem && parsed ? (
          <TrackerNoteBody item={trackerItem} parsed={parsed} />
        ) : (
          <div className="note-popup-body">{note.text}</div>
        )}

        {note.calories != null && note.calories > 0 && (
          <div className="note-popup-meta">{note.calories} kcal</div>
        )}
      </div>
    </div>
  );
}

function TrackerNoteBody({ item, parsed }: { item: CustomTrackingItem; parsed: ParsedTrackerNote }) {
  const type = normalizeTrackerType(item.type, item.isNumeric);
  const typeLabel = TRACKER_TYPE_LABELS[type] ?? type;
  const categoryLabel = item.category
    ? item.category.charAt(0).toUpperCase() + item.category.slice(1)
    : null;

  // Render the value differently per type so the popup matches the
  // grid cell's interpretation.
  let valueNode: React.ReactNode = null;
  if (type === 'toggle') {
    const on = !parsed.isNegative;
    valueNode = (
      <span className={`tracker-popup-value tracker-popup-toggle ${on ? 'on' : 'off'}`}>
        {on ? 'ON' : 'OFF'}
      </span>
    );
  } else if (type === 'traffic_light' && parsed.value != null) {
    const level = Math.max(1, Math.min(5, Math.round(parsed.value)));
    const color = TRAFFIC_LIGHT_COLORS[level - 1];
    valueNode = (
      <span className="tracker-popup-value">
        <span className="tracker-popup-swatch" style={{ background: color }} />
        Level {level}
      </span>
    );
  } else if (parsed.value != null) {
    const display = type === 'average'
      ? (Number.isInteger(parsed.value) ? String(parsed.value) : parsed.value.toFixed(1))
      : String(parsed.value);
    valueNode = <span className="tracker-popup-value">{display}</span>;
  } else if (type === 'count' || type === 'itemized_list') {
    valueNode = <span className="tracker-popup-value">+1</span>;
  } else {
    valueNode = <span className="tracker-popup-value tracker-popup-logged">Logged</span>;
  }

  return (
    <div className="tracker-popup-body">
      <div className="tracker-popup-label">{item.label}</div>
      <div className="tracker-popup-meta">
        {typeLabel}
        {categoryLabel ? ` · ${categoryLabel}` : ''}
        {' · key '}
        <code>{item.key}</code>
      </div>
      <div className="tracker-popup-value-row">{valueNode}</div>
      {parsed.trailing && (
        <div className="tracker-popup-trailing">{parsed.trailing}</div>
      )}
    </div>
  );
}

/** Lowercased keys of every defined custom tracker. Used by
 *  NoteMarker to decide whether a "t key …" note really is a
 *  tracker entry (vs. a sentence that just starts with "t "). */
function buildTrackerKeySet(items: CustomTrackingItem[]): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    if (it.key) set.add(it.key.toLowerCase());
    if (it.label) set.add(it.label.toLowerCase());
  }
  return set;
}

interface ChartGridProps {
  buckets: DayBucket[];
  showMood: boolean;
  showEnergy: boolean;
  showActivity: boolean;
  showNotes: boolean;
  showCycles: boolean;
  showWeather: boolean;
  showMoonPhases: boolean;
  cycleByDate: Map<string, string>;
  weatherByDate: Map<string, HistoricalWeather>;
  onNoteClick: (note: NoteEntry) => void;
  trackerKeys: Set<string>;
}

const HOUR_LABELS = [3, 6, 9, 12, 15, 18, 21, 24];

function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function labelTransform(h: number): string {
  // Anchor the very-bottom label by its bottom edge so it sits inside the
  // chart instead of bleeding into the day-footer below. The very-top
  // label (if we ever add it) would anchor by its top edge for the same
  // reason. Mid-axis labels stay vertically centered on their tick.
  if (h === 24) return 'translateY(-100%)';
  if (h === 0) return 'translateY(0)';
  return 'translateY(-50%)';
}

function ChartGrid({
  buckets, showMood, showEnergy, showActivity, showNotes,
  showCycles, showWeather, showMoonPhases, cycleByDate, weatherByDate,
  onNoteClick, trackerKeys,
}: ChartGridProps) {
  const visibleCount = (showMood ? 1 : 0) + (showEnergy ? 1 : 0) + (showActivity ? 1 : 0);
  const subColumns = Math.max(visibleCount, 1);
  const todayMs = startOfLocalDay(new Date()).getTime();
  const dayMinWidth = subColumns * 18;

  // Day column stack from top to bottom: day-track | date | moon | weather
  // | cycle. Cycle moved to the bottom alongside the other ancillary
  // strips so all per-day chrome lives in the same footer block.
  const weatherH = showWeather ? WEATHER_ROW_PX : 0;
  const cycleH = showCycles ? CYCLE_ROW_PX : 0;
  const moonH = showMoonPhases ? MOON_ROW_PX : 0;

  return (
    <div className="chart-scroll">
      <div className="chart-grid">
        <div className="chart-yaxis">
          <div className="chart-yaxis-track">
            {HOUR_LABELS.map((h) => (
              <div
                key={h}
                className="chart-yaxis-label"
                style={{ top: `${(h / 24) * 100}%`, transform: labelTransform(h) }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>
          <div className="chart-yaxis-footer-spacer" />
          {moonH > 0 && (
            <div className="chart-yaxis-moon-spacer" style={{ height: moonH }} />
          )}
          {weatherH > 0 && (
            <div className="chart-yaxis-weather-spacer" style={{ height: weatherH }} />
          )}
          {cycleH > 0 && (
            <div className="chart-yaxis-cycle-spacer" style={{ height: cycleH }} />
          )}
        </div>

        <div className="chart-columns">
          {buckets.map((b) => (
            <DayColumn
              key={b.key}
              bucket={b}
              isToday={startOfLocalDay(b.date).getTime() === todayMs}
              showMood={showMood}
              showEnergy={showEnergy}
              showActivity={showActivity}
              showNotes={showNotes}
              subColumns={subColumns}
              minWidth={dayMinWidth}
              weather={showWeather ? weatherByDate.get(b.key) : undefined}
              cycleColorHex={showCycles ? cycleByDate.get(b.key) : undefined}
              weatherRowH={weatherH}
              cycleRowH={cycleH}
              moonRowH={moonH}
              onNoteClick={onNoteClick}
              trackerKeys={trackerKeys}
            />
          ))}
          {/* Reference lines pinned to the day-track area only. Stop them
              above the date footer + moon + weather + cycle strips below. */}
          <div
            className="time-grid"
            style={{ top: 0, bottom: 36 + moonH + weatherH + cycleH }}
          >
            <div className="time-grid-line" style={{ top: `${(3 / 24) * 100}%` }} />
            <div className="time-grid-line" style={{ top: `${(12 / 24) * 100}%` }} />
            <div className="time-grid-line" style={{ top: `${(18 / 24) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface DayColumnProps {
  bucket: DayBucket;
  isToday: boolean;
  showMood: boolean;
  showEnergy: boolean;
  showActivity: boolean;
  showNotes: boolean;
  subColumns: number;
  minWidth: number;
  weather?: HistoricalWeather;
  cycleColorHex?: string;
  weatherRowH: number;
  cycleRowH: number;
  moonRowH: number;
  onNoteClick: (note: NoteEntry) => void;
  trackerKeys: Set<string>;
}

function DayColumn({
  bucket, isToday, showMood, showEnergy, showActivity, showNotes,
  subColumns, minWidth, weather, cycleColorHex,
  weatherRowH, cycleRowH, moonRowH, onNoteClick, trackerKeys,
}: DayColumnProps) {
  const { date } = bucket;
  const dayStart = startOfLocalDay(date).getTime();
  const dayEnd = dayStart + MS_PER_DAY;

  const yPct = (timestamp: number): number =>
    Math.max(0, Math.min(100, ((timestamp - dayStart) / MS_PER_DAY) * 100));

  // Activity: clamp to day boundaries so a multi-day bar shows just its slice.
  const activityRange = (a: ActivityEntry): [number, number] => {
    const start = Math.max(a.timestamp, dayStart);
    const end = Math.min(a.endTimestamp ?? a.timestamp + DEFAULT_ACTIVITY_HOURS * MS_PER_HOUR, dayEnd);
    const topPct = ((start - dayStart) / MS_PER_DAY) * 100;
    const heightPct = Math.max(((end - start) / MS_PER_DAY) * 100, MIN_BAR_HEIGHT_PCT);
    return [topPct, heightPct];
  };

  return (
    <div
      className={`day-column ${isToday ? 'today' : ''}`}
      style={{ minWidth: `${minWidth}px` }}
    >
      <div
        className="day-track"
        style={{ gridTemplateColumns: `repeat(${subColumns}, 1fr)` }}
      >
        {showMood && (
          <div className="subcol">
            {bucket.moods.map((m) => (
              <div
                key={m.id}
                className="circle mood-circle"
                style={{ top: `${yPct(m.timestamp)}%`, backgroundColor: MOOD_COLORS[m.type] }}
                title={`${new Date(m.timestamp).toLocaleTimeString()} — ${m.type}${m.notes ? ` — ${m.notes}` : ''}`}
              />
            ))}
          </div>
        )}

        {showEnergy && (
          <div className="subcol">
            {bucket.energies.map((e) => (
              <div
                key={e.id}
                className="circle energy-circle"
                style={{ top: `${yPct(e.timestamp)}%`, backgroundColor: ENERGY_COLORS[e.level] }}
                title={`${new Date(e.timestamp).toLocaleTimeString()} — energy ${e.level}${e.notes ? ` — ${e.notes}` : ''}`}
              />
            ))}
          </div>
        )}

        {showActivity && (
          <div className="subcol">
            {bucket.activities.map((a) => {
              const [top, height] = activityRange(a);
              return (
                <div
                  key={`${a.id}-${dayStart}`}
                  className={`activity-bar ${a.isGapFiller ? 'gap-fill' : ''}`}
                  style={{ top: `${top}%`, height: `${height}%`, backgroundColor: activityColor(a.type) }}
                  title={`${new Date(a.timestamp).toLocaleTimeString()} — ${a.type}${a.duration ? ` (${a.duration.toFixed(1)}h)` : ''}${a.notes ? ` — ${a.notes}` : ''}`}
                />
              );
            })}
          </div>
        )}

        {showNotes && bucket.notes.length > 0 && (
          <div
            className="notes-overlay"
            style={{
              // Pin to the right-most visible sub-column. In "all" view that's
              // the activity column; in single-view it's the only column.
              left: `${(1 - 1 / subColumns) * 100}%`,
              width: `${100 / subColumns}%`,
            }}
          >
            {bucket.notes.map((n) => (
              <NoteMarker
                key={n.id}
                note={n}
                top={yPct(n.timestamp)}
                circular={subColumns > 1}
                onClick={() => onNoteClick(n)}
                trackerKeys={trackerKeys}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className="day-footer"
        title={date.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      >
        <div className="day-num">{date.getDate()}</div>
        <div className="day-name">
          {date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}
        </div>
      </div>
      {moonRowH > 0 && (
        <div className="day-moon" style={{ height: moonRowH }}>
          <div
            className="moon-icon"
            style={moonSpriteStyle(date, MOON_ICON_PX)}
            title={date.toDateString()}
          />
        </div>
      )}
      {weatherRowH > 0 && (
        <div className="day-weather" style={{ height: weatherRowH }}>
          {weather && <WeatherCell weather={weather} />}
        </div>
      )}
      {cycleRowH > 0 && (
        <div className="day-cycle" style={{ height: cycleRowH }}>
          {cycleColorHex && (
            <div className="cycle-bar" style={{ backgroundColor: cycleColorHex }} />
          )}
        </div>
      )}
    </div>
  );
}

interface WeatherCellProps {
  weather: HistoricalWeather;
}

function WeatherCell({ weather }: WeatherCellProps) {
  const Icon = pickWeatherIcon(weather.shortForecast);
  const t = weather.temperature;
  const u = weather.temperatureUnit ?? '°';
  const tooltip = `${weather.shortForecast}${
    t != null ? ` · ${t}°${u}` : ''
  }${
    weather.precipProb != null && weather.precipProb > 0
      ? ` · ${Math.round(weather.precipProb * 100)}% precip`
      : ''
  }`;
  return (
    <div className="weather-cell" title={tooltip}>
      <Icon size={18} strokeWidth={1.8} />
      {t != null && <span className="weather-temp">{t}°</span>}
    </div>
  );
}

interface NoteMarkerProps {
  note: NoteEntry;
  top: number;
  circular: boolean;
  onClick?: () => void;
  trackerKeys: Set<string>;
}

/**
 * A note marker is a 14px circle (same diameter as the mood/energy dots) with
 * an icon picked from the note's type flags. Tracking notes get a square
 * background to match the iOS chart's visual distinction.
 */
function NoteMarker({ note, top, circular, onClick, trackerKeys }: NoteMarkerProps) {
  // Pick an icon based on the note's classification. Tracker
  // detection mirrors the popup: parse the leading "t key" pattern
  // and confirm the key matches a real custom_tracking_items row.
  // Without the trackerKeys check, a sentence like "t the quick
  // brown fox" would false-positive.
  let Icon = FileText;
  if (note.isCycle) {
    Icon = Moon;
  } else if (note.isMeal) {
    Icon = Utensils;
  } else if (note.isHealth) {
    Icon = HeartPulse;
  } else {
    const m = /^\s*(?:t|track)\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(note.text || '');
    if (m && trackerKeys.has(m[1].toLowerCase())) {
      Icon = Tag;
    }
  }

  return (
    <button
      type="button"
      className={`note-marker ${circular ? 'circular' : ''}`}
      style={{ top: `${top}%` }}
      title={`${new Date(note.timestamp).toLocaleTimeString()} — click to read`}
      onClick={onClick}
    >
      <Icon size={13} strokeWidth={2.4} />
    </button>
  );
}
