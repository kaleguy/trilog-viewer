import { useEffect, useMemo, useState } from 'react';
import { getDayEntriesRange, type Conn_ } from '../db/queries';
import { ENERGY_COLORS, MOOD_COLORS, type DayEntryRow } from '../db/types';
import './Charts.css';

interface Props {
  conn: Conn_;
}

const WEEKS = 12;
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

  const startDateKey = dateKey(days[0]);
  const endDateKey = dateKey(days[days.length - 1]);

  useEffect(() => {
    let cancelled = false;
    getDayEntriesRange(conn, startDateKey, endDateKey)
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<string, DayEntryRow>();
        for (const r of rows) m.set(r.dateKey, r);
        setRowsByDate(m);
      })
      .catch(() => { /* fall back to empty */ });
    return () => { cancelled = true; };
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
      />
      {/* More chart strips will live below this one. */}
    </div>
  );
}

interface MoodEnergyStripProps {
  days: Date[];
  rowsByDate: Map<string, DayEntryRow>;
  endDate: Date;
  onBack: () => void;
  onForward: () => void;
}

const VBOX_W = 100; // SVG viewBox width — proportional, scales to container
const VBOX_H = 28;  // viewBox height; aspect feels right at ~3.5:1
const Y_MIN = 1;
const Y_MAX = 5;
const PAD_X = 1;    // leave a touch of room so dots near the edges don't clip
const PAD_TOP = 2;
const PAD_BOTTOM = 4; // room for day-of-week strip

const MOOD_LINE_COLOR = '#00DD66';
const ENERGY_LINE_COLOR = '#FFCC44';

/** Color a continuous mood score 1..5 using the iPhone mood palette.
 *  Round to the nearest integer position to pick a single color
 *  (1=upset, 2=anxious, 3=sad, 4=neutral, 5=happy). */
const MOOD_POSITION_NAMES = ['upset', 'anxious', 'sad', 'neutral', 'happy'] as const;
function moodColorForScore(score: number): string {
  const idx = Math.max(0, Math.min(4, Math.round(score) - 1));
  return MOOD_COLORS[MOOD_POSITION_NAMES[idx]];
}

function MoodEnergyStrip({ days, rowsByDate, endDate, onBack, onForward }: MoodEnergyStripProps) {
  const [showMood, setShowMood] = useState(true);
  const [showEnergy, setShowEnergy] = useState(true);

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
  });

  const todayMs = startOfLocalDay(new Date()).getTime();

  return (
    <section className="chart-strip">
      <header className="chart-strip-head">
        <h3 className="chart-strip-title">Mood &amp; Energy</h3>
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
        </div>
        <div className="chart-strip-nav">
          <button type="button" onClick={onBack} aria-label="Previous week">‹</button>
          <span className="chart-strip-range">Week {isoWeekNumber(endDate)}</span>
          <button type="button" onClick={onForward} aria-label="Next week">›</button>
        </div>
      </header>

      <div className="chart-strip-body">
        <svg
          className="chart-svg"
          viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Energy levels for the last 12 weeks"
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

          {/* Mood line first so energy paints on top. Line stays
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
