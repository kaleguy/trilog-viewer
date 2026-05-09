import { useEffect, useMemo, useState } from 'react';
import { Utensils, HeartPulse, Droplet, FileText, BarChart3 } from 'lucide-react';
import {
  getActivityEntries,
  getEnergyEntries,
  getMoodEntries,
  getNoteEntries,
  type Conn_,
} from '../db/queries';
import {
  activityColor,
  ENERGY_COLORS,
  MOOD_COLORS,
  type ActivityEntry,
  type EnergyEntry,
  type MoodEntry,
  type NoteEntry,
} from '../db/types';
import './MoodChart.css';

type VisibilityState = 'all' | 'mood' | 'energy' | 'activity';

interface Props {
  conn: Conn_;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DEFAULT_DAYS_ALL = 30;
const DEFAULT_DAYS_SINGLE = 90;
const DEFAULT_ACTIVITY_HOURS = 1;
const MIN_BAR_HEIGHT_PCT = 0.3;

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

export function MoodChart({ conn }: Props) {
  const [visibility, setVisibility] = useState<VisibilityState>('all');
  const [showNotes, setShowNotes] = useState(true);
  const [endDate, setEndDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [energies, setEnergies] = useState<EnergyEntry[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
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
    // has neighbors to anchor to.
    const padMs = 2 * MS_PER_DAY;
    Promise.all([
      getMoodEntries(conn, startMs, endMs),
      getEnergyEntries(conn, startMs, endMs),
      getActivityEntries(conn, startMs - padMs, endMs + padMs),
      getNoteEntries(conn, startMs, endMs),
    ])
      .then(([m, e, a, n]) => {
        if (cancelled) return;
        setMoods(m);
        setEnergies(e);
        setActivities(computeEffectiveEnds(a));
        setNotes(n);
      })
      .catch((err) => console.error('[MoodChart] query failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conn, startMs, endMs]);

  const buckets = useMemo(
    () => bucketByDay(days, moods, energies, activities, notes),
    [days, moods, energies, activities, notes]
  );

  const showMood = visibility === 'all' || visibility === 'mood';
  const showEnergy = visibility === 'all' || visibility === 'energy';
  const showActivity = visibility === 'all' || visibility === 'activity';

  const stepBack = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - daysToShow);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() + daysToShow);
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
      />
    </div>
  );
}

interface ChartGridProps {
  buckets: DayBucket[];
  showMood: boolean;
  showEnergy: boolean;
  showActivity: boolean;
  showNotes: boolean;
}

const HOUR_LABELS = [3, 6, 9, 12, 15, 18, 21];

function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12AM';
  if (h === 12) return '12PM';
  if (h < 12) return `${h}AM`;
  return `${h - 12}PM`;
}

function ChartGrid({ buckets, showMood, showEnergy, showActivity, showNotes }: ChartGridProps) {
  const visibleCount = (showMood ? 1 : 0) + (showEnergy ? 1 : 0) + (showActivity ? 1 : 0);
  const subColumns = Math.max(visibleCount, 1);
  const todayMs = startOfLocalDay(new Date()).getTime();
  // Each sub-column needs ~18px to show a 14px circle comfortably; scale day
  // min-width by the number of visible sub-columns so single-view stays
  // narrow and "all"-view doesn't squish the circles.
  const dayMinWidth = subColumns * 18;

  return (
    <div className="chart-scroll">
      <div className="chart-grid">
        <div className="chart-yaxis">
          <div className="chart-yaxis-track">
            {HOUR_LABELS.map((h) => (
              <div
                key={h}
                className="chart-yaxis-label"
                style={{ top: `${(h / 24) * 100}%` }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>
          <div className="chart-yaxis-footer-spacer" />
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
            />
          ))}
          {/* Light horizontal reference lines at 3am, 12pm, 6pm — same as
              the iOS chart. Positioned outside the day columns so they
              span all of them and stay aligned across the chart. */}
          <div className="time-grid">
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
}

function DayColumn({
  bucket, isToday, showMood, showEnergy, showActivity, showNotes, subColumns, minWidth,
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
              />
            ))}
          </div>
        )}
      </div>

      <div className="day-footer">
        <div className="day-num">{date.getDate()}</div>
        <div className="day-name">
          {date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}
        </div>
      </div>
    </div>
  );
}

interface NoteMarkerProps {
  note: NoteEntry;
  top: number;
  circular: boolean;
}

/**
 * A note marker is a 14px circle (same diameter as the mood/energy dots) with
 * an icon picked from the note's type flags. Tracking notes get a square
 * background to match the iOS chart's visual distinction.
 */
function NoteMarker({ note, top, circular }: NoteMarkerProps) {
  // White marker always; the icon shape is the differentiator.
  let Icon = FileText;
  if (note.isCycle) Icon = Droplet;
  else if (note.isMeal) Icon = Utensils;
  else if (note.isHealth) Icon = HeartPulse;
  else if (/\{tracking:/i.test(note.text || '') || /^@/.test(note.text || '')) Icon = BarChart3;

  return (
    <div
      className={`note-marker ${circular ? 'circular' : ''}`}
      style={{ top: `${top}%` }}
      title={`${new Date(note.timestamp).toLocaleTimeString()} — ${note.text}`}
    >
      <Icon size={13} strokeWidth={2.4} />
    </div>
  );
}
