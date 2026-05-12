import { useEffect, useMemo, useState } from 'react';
import { getActivityEntries, getDayEntriesRange, type Conn_ } from '../db/queries';
import { ACTIVITY_COLORS, ENERGY_COLORS, MOOD_COLORS, type DayEntryRow } from '../db/types';
import { aggregateActivities, type ActivityTotals } from './activityAggregation';
import './Charts.css';

interface Props {
  conn: Conn_;
}

const WEEKS = 24;
const DAYS = WEEKS * 7;

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
/** Saturday of the current week (or today if already Saturday). */
function thisOrNextSaturday(date: Date): Date {
  const r = startOfLocalDay(date);
  const offset = (6 - r.getDay() + 7) % 7;
  if (offset > 0) r.setDate(r.getDate() + offset);
  return r;
}
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Single-number mood score (1=worst .. 5=best) from a day_entries
 * row. Prefers the newer 5-tuple `moodValues` ([upset, anxious, sad,
 * neutral, happy], each 1-10) and computes a weighted mean —
 * upset weights position 1, anxious 2, sad 3, neutral 4, happy 5 —
 * so the score is a continuous indicator of where the day's mix
 * landed. Falls back to the legacy single `mood` string when
 * moodValues is missing. Returns null if neither is set.
 */
const MOOD_POSITION: Record<string, number> = {
  upset: 1, anxious: 2, sad: 3, neutral: 4, happy: 5,
};

function computeDailyMood(row: { mood: string | null; moodValues: string | null }): number | null {
  if (row.moodValues) {
    try {
      const arr = JSON.parse(row.moodValues) as number[];
      if (Array.isArray(arr) && arr.length === 5) {
        let weighted = 0;
        let total = 0;
        for (let i = 0; i < 5; i++) {
          const v = arr[i];
          if (typeof v === 'number' && v > 0) {
            weighted += (i + 1) * v;
            total += v;
          }
        }
        if (total > 0) {
          const score = weighted / total;
          return Math.max(1, Math.min(5, score));
        }
      }
    } catch { /* fall through */ }
  }
  if (row.mood && MOOD_POSITION[row.mood] != null) {
    return MOOD_POSITION[row.mood];
  }
  return null;
}

export function Charts({ conn }: Props) {
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));

  // Shared crosshair index — when the mouse hovers any strip, every
  // strip in the column draws a vertical line at the same day so the
  // user can sight-read across (energy dot ↔ sleep bar for the same
  // date). `null` = no hover.
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);

  // 12 weeks of days, ending on `endDate` (a Saturday), starting on
  // the Sunday 83 days earlier. Future days inside the window render
  // as blank columns.
  const days = useMemo(() => {
    const list: Date[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      list.push(d);
    }
    return list;
  }, [endDate]);

  const [rowsByDate, setRowsByDate] = useState<Map<string, DayEntryRow>>(new Map());
  const [activityTotals, setActivityTotals] = useState<Map<string, ActivityTotals>>(new Map());

  const startDateKey = dateKey(days[0]);
  const endDateKey = dateKey(days[days.length - 1]);
  const startMs = days[0].getTime();
  const endMs = days[days.length - 1].getTime() + 24 * 60 * 60 * 1000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getDayEntriesRange(conn, startDateKey, endDateKey),
      // Pad activity fetch by ±1 day so cross-midnight entries on the
      // edges of the window credit the correct cells.
      getActivityEntries(conn, startMs - MS_PER_DAY, endMs + MS_PER_DAY),
    ])
      .then(([rows, activities]) => {
        if (cancelled) return;
        const m = new Map<string, DayEntryRow>();
        for (const r of rows) m.set(r.dateKey, r);
        setRowsByDate(m);
        setActivityTotals(aggregateActivities(activities));
      })
      .catch(() => { /* fall back to empty */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, startDateKey, endDateKey]);

  const stepBack = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() - 7);
    setEndDate(d);
  };
  const stepForward = () => {
    const d = new Date(endDate);
    d.setDate(d.getDate() + 7);
    const cur = thisOrNextSaturday(new Date());
    setEndDate(d > cur ? cur : d);
  };

  return (
    <div className="charts">
      <MoodEnergyStrip
        days={days}
        rowsByDate={rowsByDate}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={setHoveredDayIndex}
      />
      <SleepStrip
        days={days}
        rowsByDate={rowsByDate}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={setHoveredDayIndex}
      />
      <ActivityStrip
        days={days}
        activityTotals={activityTotals}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={setHoveredDayIndex}
      />
    </div>
  );
}

interface StripProps {
  days: Date[];
  rowsByDate: Map<string, DayEntryRow>;
  endDate: Date;
  onBack: () => void;
  onForward: () => void;
  hoveredDayIndex: number | null;
  onHoverIndex: (i: number | null) => void;
}

type MoodEnergyStripProps = StripProps;

/**
 * Translate a mouse event over the chart body into a day-index.
 * Subtracts the SVG's viewBox PAD_X so the calculation lines up with
 * where dots are actually drawn.
 */
function dayIndexFromMouse(
  event: React.MouseEvent<HTMLElement>,
  dayCount: number,
): number | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const xPx = event.clientX - rect.left;
  // Convert pixel x → viewBox x using the same VBOX_W / PAD_X math
  // the strips use.
  const vboxX = (xPx / rect.width) * VBOX_W;
  const colW = (VBOX_W - 2 * PAD_X) / dayCount;
  const i = Math.floor((vboxX - PAD_X) / colW);
  if (i < 0 || i >= dayCount) return null;
  return i;
}

const VBOX_W = 200; // SVG viewBox width — proportional, scales to container.
                    // Bumped up to keep individual columns narrow enough
                    // that 168-day series doesn't visually crowd at the
                    // dot diameter we use below.
const VBOX_H = 28;
const Y_MIN = 1;
const Y_MAX = 5;
const PAD_X = 1;
const PAD_TOP = 2;
const PAD_BOTTOM = 4;

const MOOD_LINE_COLOR = '#00DD66';
const ENERGY_LINE_COLOR = '#FFCC44';
const WELLNESS_LINE_COLOR = '#FFFFFF';

/** Color a continuous mood score 1..5 using the iPhone mood palette.
 *  Round to the nearest integer position to pick a single color
 *  (1=upset, 2=anxious, 3=sad, 4=neutral, 5=happy). */
const MOOD_POSITION_NAMES = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;
function moodColorForScore(score: number): string {
  const idx = Math.max(0, Math.min(4, Math.round(score) - 1));
  return MOOD_COLORS[MOOD_POSITION_NAMES[idx]];
}

/** Generic 1-5 rating palette (red bad → green good). Reused by
 *  sleep-quality bar coloring; wellness dots are uniform white now
 *  so they don't read as the same series as mood. */
const RATING_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#8BC34A', '#34C759'];

function MoodEnergyStrip({
  days, rowsByDate, endDate, onBack, onForward, hoveredDayIndex, onHoverIndex,
}: MoodEnergyStripProps) {
  const [showMood, setShowMood] = useState(true);
  const [showEnergy, setShowEnergy] = useState(true);
  const [showWellness, setShowWellness] = useState(true);

  const colW = (VBOX_W - 2 * PAD_X) / days.length;
  const plotH = VBOX_H - PAD_TOP - PAD_BOTTOM;

  function xFor(i: number): number {
    // Center the dot in its column.
    return PAD_X + colW * (i + 0.5);
  }
  function yFor(level: number): number {
    const t = (level - Y_MIN) / (Y_MAX - Y_MIN);
    return PAD_TOP + (1 - t) * plotH;
  }

  // Walk each day once and build mood + energy series in parallel.
  // Segments only bridge consecutive days that both have a value for
  // the given metric, so missing days read as missing.
  type Segment = { x1: number; y1: number; x2: number; y2: number };
  type Point = { i: number; level: number; x: number; y: number };

  const energySegments: Segment[] = [];
  const energyPoints: Point[] = [];
  let prevEnergy: { i: number; y: number } | null = null;

  const moodSegments: Segment[] = [];
  const moodPoints: Point[] = [];
  let prevMood: { i: number; y: number } | null = null;

  const wellnessSegments: Segment[] = [];
  const wellnessPoints: Point[] = [];
  let prevWellness: { i: number; y: number } | null = null;

  days.forEach((d, i) => {
    const row = rowsByDate.get(dateKey(d));

    // -- Energy
    const energyLevel = row?.energy ?? null;
    if (energyLevel != null && energyLevel >= 1 && energyLevel <= 5) {
      const x = xFor(i);
      const y = yFor(energyLevel);
      energyPoints.push({ i, level: energyLevel, x, y });
      if (prevEnergy) {
        energySegments.push({ x1: xFor(prevEnergy.i), y1: prevEnergy.y, x2: x, y2: y });
      }
      prevEnergy = { i, y };
    } else {
      prevEnergy = null;
    }

    // -- Mood (derived score from moodValues or legacy mood string)
    const moodScore = row ? computeDailyMood({ mood: row.mood, moodValues: row.moodValues }) : null;
    if (moodScore != null) {
      const x = xFor(i);
      const y = yFor(moodScore);
      moodPoints.push({ i, level: moodScore, x, y });
      if (prevMood) {
        moodSegments.push({ x1: xFor(prevMood.i), y1: prevMood.y, x2: x, y2: y });
      }
      prevMood = { i, y };
    } else {
      prevMood = null;
    }

    // -- Wellness (1-5 integer)
    const wellnessLevel = row?.wellnessLevel ?? null;
    if (wellnessLevel != null && wellnessLevel >= 1 && wellnessLevel <= 5) {
      const x = xFor(i);
      const y = yFor(wellnessLevel);
      wellnessPoints.push({ i, level: wellnessLevel, x, y });
      if (prevWellness) {
        wellnessSegments.push({ x1: xFor(prevWellness.i), y1: prevWellness.y, x2: x, y2: y });
      }
      prevWellness = { i, y };
    } else {
      prevWellness = null;
    }
  });

  const todayMs = startOfLocalDay(new Date()).getTime();

  return (
    <section className="chart-strip">
      <header className="chart-strip-head">
        <h3 className="chart-strip-title">Mood · Energy · Wellness</h3>
        <div className="chart-strip-legend">
          <button
            type="button"
            className={`chart-legend-item${showMood ? '' : ' off'}`}
            aria-pressed={showMood}
            onClick={() => setShowMood((v) => !v)}
            title={showMood ? 'Hide mood line' : 'Show mood line'}
          >
            <span className="chart-legend-dot" style={{ background: MOOD_LINE_COLOR }} />
            Mood
          </button>
          <button
            type="button"
            className={`chart-legend-item${showEnergy ? '' : ' off'}`}
            aria-pressed={showEnergy}
            onClick={() => setShowEnergy((v) => !v)}
            title={showEnergy ? 'Hide energy line' : 'Show energy line'}
          >
            <span className="chart-legend-dot" style={{ background: ENERGY_LINE_COLOR }} />
            Energy
          </button>
          <button
            type="button"
            className={`chart-legend-item${showWellness ? '' : ' off'}`}
            aria-pressed={showWellness}
            onClick={() => setShowWellness((v) => !v)}
            title={showWellness ? 'Hide wellness line' : 'Show wellness line'}
          >
            <span className="chart-legend-dot" style={{ background: WELLNESS_LINE_COLOR }} />
            Wellness
          </button>
        </div>
        <div className="chart-strip-nav">
          <button type="button" onClick={onBack} aria-label="Previous week">‹</button>
          <span className="chart-strip-range">Week {isoWeekNumber(endDate)}</span>
          <button type="button" onClick={onForward} aria-label="Next week">›</button>
        </div>
      </header>

      <div
        className="chart-strip-body"
        onMouseMove={(e) => onHoverIndex(dayIndexFromMouse(e, days.length))}
        onMouseLeave={() => onHoverIndex(null)}
      >
        <svg
          className="chart-svg"
          viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Mood, energy and wellness for the last 24 weeks"
        >
          {/* Subtle horizontal gridlines at every integer energy level */}
          {[1, 2, 3, 4, 5].map((lvl) => (
            <line
              key={lvl}
              x1={PAD_X}
              x2={VBOX_W - PAD_X}
              y1={yFor(lvl)}
              y2={yFor(lvl)}
              className="chart-grid-line"
            />
          ))}

          {/* Week-boundary verticals — every 7 days */}
          {days.map((d, i) => (
            d.getDay() === 0 && i !== 0 ? (
              <line
                key={`wk-${i}`}
                x1={PAD_X + colW * i}
                x2={PAD_X + colW * i}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-week-line"
              />
            ) : null
          ))}

          {/* Today marker */}
          {(() => {
            const todayIdx = days.findIndex((d) => startOfLocalDay(d).getTime() === todayMs);
            if (todayIdx < 0) return null;
            return (
              <line
                x1={xFor(todayIdx)}
                x2={xFor(todayIdx)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-today-line"
              />
            );
          })()}

          {/* Crosshair — shared between strips so the user can line
              up values across charts for the same day. */}
          {hoveredDayIndex != null && hoveredDayIndex >= 0 && hoveredDayIndex < days.length && (
            <line
              x1={xFor(hoveredDayIndex)}
              x2={xFor(hoveredDayIndex)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              className="chart-cursor-line"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Wellness paints first — white line, white dots so it
              doesn't compete with mood-green. */}
          {showWellness && wellnessSegments.map((s, i) => (
            <line
              key={`well-seg-${i}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              className="chart-wellness-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {showWellness && wellnessPoints.map((p) => (
            <circle
              key={`well-pt-${p.i}`}
              cx={p.x}
              cy={p.y}
              r={0.55}
              fill={WELLNESS_LINE_COLOR}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {`${days[p.i].toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — wellness ${p.level}`}
              </title>
            </circle>
          ))}

          {/* Mood line next so energy paints on top. Line stays
              green; dots use the iPhone mood palette per rounded
              score (upset red ↦ happy green). */}
          {showMood && moodSegments.map((s, i) => (
            <line
              key={`mood-seg-${i}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              className="chart-mood-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {showMood && moodPoints.map((p) => (
            <circle
              key={`mood-pt-${p.i}`}
              cx={p.x}
              cy={p.y}
              r={0.55}
              fill={moodColorForScore(p.level)}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {`${days[p.i].toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — mood ${p.level.toFixed(1)}`}
              </title>
            </circle>
          ))}

          {/* Energy line + dots — yellow line, ENERGY_COLORS dots
              (matches iPhone palette). Painted last so points sit on
              top of overlapping mood segments. */}
          {showEnergy && energySegments.map((s, i) => (
            <line
              key={`energy-seg-${i}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              className="chart-energy-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {showEnergy && energyPoints.map((p) => (
            <circle
              key={`energy-pt-${p.i}`}
              cx={p.x}
              cy={p.y}
              r={0.55}
              fill={ENERGY_COLORS[p.level - 1]}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {`${days[p.i].toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — energy ${p.level}`}
              </title>
            </circle>
          ))}
        </svg>

        {/* Day-of-week strip beneath the chart. Show date numbers on
            the 1st of each month so the calendar reads. */}
        <div className="chart-day-row">
          {days.map((d, i) => {
            const isFirstOfMonth = d.getDate() === 1;
            const isToday = startOfLocalDay(d).getTime() === todayMs;
            return (
              <div
                key={i}
                className={`chart-day-cell${isToday ? ' today' : ''}`}
                title={d.toLocaleDateString(undefined, {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              >
                {isFirstOfMonth && (
                  <div className="chart-day-month">
                    {d.toLocaleDateString(undefined, { month: 'short' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


// ---- Sleep strip -----------------------------------------------------------

const SLEEP_Y_MAX = 10; // hours; gridlines at 4, 6, 8

/**
 * Total sleep hours for a day. Prefer HealthKit's hkSleepDuration
 * (in minutes), fall back to the manually-logged sleepDurationHours
 * + sleepDurationMinutes pair. Returns null when neither is set.
 */
function dailySleepHours(row: DayEntryRow): number | null {
  if (row.hkSleepDuration != null && row.hkSleepDuration > 0) {
    return row.hkSleepDuration / 60;
  }
  if (row.sleepDurationHours != null && row.sleepDurationHours > 0) {
    return row.sleepDurationHours + (row.sleepDurationMinutes ?? 0) / 60;
  }
  return null;
}

function SleepStrip({
  days, rowsByDate, endDate, onBack, onForward, hoveredDayIndex, onHoverIndex,
}: StripProps) {
  const colW = (VBOX_W - 2 * PAD_X) / days.length;
  const plotH = VBOX_H - PAD_TOP - PAD_BOTTOM;
  const BAR_GAP = 0.15; // viewBox units between bars

  function xFor(i: number): number { return PAD_X + colW * i; }
  function yForHours(h: number): number {
    const clamped = Math.min(h, SLEEP_Y_MAX);
    return PAD_TOP + plotH * (1 - clamped / SLEEP_Y_MAX);
  }
  function heightForHours(h: number): number {
    const clamped = Math.min(h, SLEEP_Y_MAX);
    return plotH * (clamped / SLEEP_Y_MAX);
  }

  const bars = days.map((d, i) => {
    const row = rowsByDate.get(dateKey(d));
    if (!row) return null;
    const hours = dailySleepHours(row);
    if (hours == null) return null;
    const quality = row.sleepQuality;
    const color = quality != null && quality >= 1 && quality <= 5
      ? RATING_COLORS[quality - 1]
      : '#6B7280';
    return {
      i,
      x: xFor(i) + BAR_GAP / 2,
      y: yForHours(hours),
      width: colW - BAR_GAP,
      height: heightForHours(hours),
      color,
      hours,
      quality,
    };
  }).filter((b): b is NonNullable<typeof b> => b !== null);

  const todayMs = startOfLocalDay(new Date()).getTime();

  return (
    <section className="chart-strip">
      <header className="chart-strip-head">
        <h3 className="chart-strip-title">Sleep</h3>
        <div className="chart-strip-legend">
          {[1, 2, 3, 4, 5].map((q) => (
            <span key={q} className="chart-legend-item" style={{ cursor: 'default' }}>
              <span className="chart-legend-dot" style={{ background: RATING_COLORS[q - 1] }} />
              {q}
            </span>
          ))}
        </div>
        <div className="chart-strip-nav">
          <button type="button" onClick={onBack} aria-label="Previous week">‹</button>
          <span className="chart-strip-range">Week {isoWeekNumber(endDate)}</span>
          <button type="button" onClick={onForward} aria-label="Next week">›</button>
        </div>
      </header>

      <div
        className="chart-strip-body"
        onMouseMove={(e) => onHoverIndex(dayIndexFromMouse(e, days.length))}
        onMouseLeave={() => onHoverIndex(null)}
      >
        <svg
          className="chart-svg"
          viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Sleep duration per day, bars colored by quality"
        >
          {[4, 6, 8].map((h) => (
            <line
              key={h}
              x1={PAD_X}
              x2={VBOX_W - PAD_X}
              y1={yForHours(h)}
              y2={yForHours(h)}
              className="chart-grid-line"
            />
          ))}

          {days.map((d, i) => (
            d.getDay() === 0 && i !== 0 ? (
              <line
                key={`wk-${i}`}
                x1={PAD_X + colW * i}
                x2={PAD_X + colW * i}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-week-line"
              />
            ) : null
          ))}

          {(() => {
            const todayIdx = days.findIndex((d) => startOfLocalDay(d).getTime() === todayMs);
            if (todayIdx < 0) return null;
            return (
              <line
                x1={xFor(todayIdx) + colW / 2}
                x2={xFor(todayIdx) + colW / 2}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-today-line"
              />
            );
          })()}

          {/* Shared crosshair — `xFor` in this strip returns the
              column's left edge, so add half-col to center on the
              same day as the MoodEnergy strip's dot. */}
          {bars.map((b) => (
            <rect
              key={`sleep-${b.i}`}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              fill={b.color}
              rx={0.1}
            >
              <title>
                {`${days[b.i].toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${b.hours.toFixed(1)}h${b.quality != null ? `, quality ${b.quality}` : ''}`}
              </title>
            </rect>
          ))}

          {/* Crosshair last so it paints over the bars. */}
          {hoveredDayIndex != null && hoveredDayIndex >= 0 && hoveredDayIndex < days.length && (
            <line
              x1={xFor(hoveredDayIndex) + colW / 2}
              x2={xFor(hoveredDayIndex) + colW / 2}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              className="chart-cursor-line"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        <div className="chart-day-row">
          {days.map((d, i) => {
            const isFirstOfMonth = d.getDate() === 1;
            const isToday = startOfLocalDay(d).getTime() === todayMs;
            return (
              <div
                key={i}
                className={`chart-day-cell${isToday ? ' today' : ''}`}
                title={d.toLocaleDateString(undefined, {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              >
                {isFirstOfMonth && (
                  <div className="chart-day-month">
                    {d.toLocaleDateString(undefined, { month: 'short' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---- Activity-mix stacked-bar strip --------------------------------------

interface ActivityStripProps {
  days: Date[];
  activityTotals: Map<string, ActivityTotals>;
  endDate: Date;
  onBack: () => void;
  onForward: () => void;
  hoveredDayIndex: number | null;
  onHoverIndex: (i: number | null) => void;
}

// Stacking order, bottom→top. Sleep anchors the base (biggest most
// days), then waking activities, with `other` floating at top as a
// catch-all. Order chosen to roughly match the iPhone's add-entry
// dialog so users see a familiar layout.
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

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
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

const ACTIVITY_Y_MAX = 24; // hours

function ActivityStrip({
  days, activityTotals, endDate, onBack, onForward, hoveredDayIndex, onHoverIndex,
}: ActivityStripProps) {
  // Per-type toggles. Default everything on; clicking a legend chip
  // hides that activity's segments across all days. Hidden segments
  // collapse the stack rather than leaving gaps — we just don't draw
  // them and let segments above settle down.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visibleTypes = ACTIVITY_STACK_ORDER.filter((t) => !hidden.has(t));

  const colW = (VBOX_W - 2 * PAD_X) / days.length;
  const plotH = VBOX_H - PAD_TOP - PAD_BOTTOM;
  const BAR_GAP = 0.15;

  function xFor(i: number): number { return PAD_X + colW * i; }
  function yForHours(h: number): number {
    const clamped = Math.min(h, ACTIVITY_Y_MAX);
    return PAD_TOP + plotH * (1 - clamped / ACTIVITY_Y_MAX);
  }

  // Pre-compute stack segments per day. Each segment is one type
  // sitting on top of the running total. We clamp the running total
  // at ACTIVITY_Y_MAX so overflow days (>24h logged) don't escape.
  const segmentsByDay = days.map((d, i) => {
    const totals = activityTotals.get(dateKey(d));
    if (!totals) return null;
    const stack: {
      type: string;
      hours: number;
      y: number;
      h: number;
      color: string;
    }[] = [];
    let runningHours = 0;
    for (const type of visibleTypes) {
      const hours = totals.byType.get(type) ?? 0;
      if (hours <= 0) continue;
      const baseHours = runningHours;
      runningHours = Math.min(ACTIVITY_Y_MAX, runningHours + hours);
      const segTop = yForHours(runningHours);
      const segBottom = yForHours(baseHours);
      stack.push({
        type,
        hours,
        y: segTop,
        h: segBottom - segTop,
        color: ACTIVITY_COLORS[type] ?? ACTIVITY_COLORS.other ?? '#767676',
      });
      if (runningHours >= ACTIVITY_Y_MAX) break;
    }
    if (stack.length === 0) return null;
    return { i, x: xFor(i) + BAR_GAP / 2, width: colW - BAR_GAP, segments: stack, total: runningHours };
  }).filter((d): d is NonNullable<typeof d> => d !== null);

  const todayMs = startOfLocalDay(new Date()).getTime();

  const toggleType = (t: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <section className="chart-strip">
      <header className="chart-strip-head">
        <h3 className="chart-strip-title">Activity Mix</h3>
        <div className="chart-strip-legend">
          {ACTIVITY_STACK_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`chart-legend-item${hidden.has(t) ? ' off' : ''}`}
              aria-pressed={!hidden.has(t)}
              onClick={() => toggleType(t)}
              title={hidden.has(t) ? `Show ${t}` : `Hide ${t}`}
            >
              <span className="chart-legend-dot" style={{ background: ACTIVITY_COLORS[t] ?? '#767676' }} />
              {ACTIVITY_TYPE_LABELS[t] ?? t}
            </button>
          ))}
        </div>
        <div className="chart-strip-nav">
          <button type="button" onClick={onBack} aria-label="Previous week">‹</button>
          <span className="chart-strip-range">Week {isoWeekNumber(endDate)}</span>
          <button type="button" onClick={onForward} aria-label="Next week">›</button>
        </div>
      </header>

      <div
        className="chart-strip-body"
        onMouseMove={(e) => onHoverIndex(dayIndexFromMouse(e, days.length))}
        onMouseLeave={() => onHoverIndex(null)}
      >
        <svg
          className="chart-svg"
          viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Activity mix per day, stacked by type"
        >
          {/* Gridlines every 6 hours */}
          {[6, 12, 18, 24].map((h) => (
            <line
              key={h}
              x1={PAD_X}
              x2={VBOX_W - PAD_X}
              y1={yForHours(h)}
              y2={yForHours(h)}
              className="chart-grid-line"
            />
          ))}

          {/* Week-boundary verticals */}
          {days.map((d, i) => (
            d.getDay() === 0 && i !== 0 ? (
              <line
                key={`wk-${i}`}
                x1={PAD_X + colW * i}
                x2={PAD_X + colW * i}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-week-line"
              />
            ) : null
          ))}

          {/* Today line */}
          {(() => {
            const todayIdx = days.findIndex((d) => startOfLocalDay(d).getTime() === todayMs);
            if (todayIdx < 0) return null;
            return (
              <line
                x1={xFor(todayIdx) + colW / 2}
                x2={xFor(todayIdx) + colW / 2}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="chart-today-line"
              />
            );
          })()}

          {/* Stacked bars — painted before the crosshair so the
              vertical guideline sits on top of the bars and stays
              visible. */}
          {segmentsByDay.map((day) => (
            day.segments.map((seg, j) => (
              <rect
                key={`act-${day.i}-${j}`}
                x={day.x}
                y={seg.y}
                width={day.width}
                height={seg.h}
                fill={seg.color}
              >
                <title>
                  {`${days[day.i].toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${ACTIVITY_TYPE_LABELS[seg.type] ?? seg.type}: ${seg.hours.toFixed(1)}h`}
                </title>
              </rect>
            ))
          ))}

          {/* Shared crosshair — last so it paints on top of the bars */}
          {hoveredDayIndex != null && hoveredDayIndex >= 0 && hoveredDayIndex < days.length && (
            <line
              x1={xFor(hoveredDayIndex) + colW / 2}
              x2={xFor(hoveredDayIndex) + colW / 2}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              className="chart-cursor-line"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        <div className="chart-day-row">
          {days.map((d, i) => {
            const isFirstOfMonth = d.getDate() === 1;
            const isToday = startOfLocalDay(d).getTime() === todayMs;
            return (
              <div
                key={i}
                className={`chart-day-cell${isToday ? ' today' : ''}`}
                title={d.toLocaleDateString(undefined, {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              >
                {isFirstOfMonth && (
                  <div className="chart-day-month">
                    {d.toLocaleDateString(undefined, { month: 'short' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
