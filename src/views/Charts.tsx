import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getActivityEntries, getDayEntriesRange, type Conn_ } from '../db/queries';
import { ACTIVITY_COLORS, ENERGY_COLORS, MOOD_COLORS, type ActivityEntry, type DayEntryRow } from '../db/types';
import { aggregateActivities, type ActivityTotals } from './activityAggregation';
import './Charts.css';

interface Props {
  conn: Conn_;
}

// Preset window lengths the user can switch between. Step nav is
// always one week regardless of which one is selected.
const WINDOW_OPTIONS: { weeks: number; label: string }[] = [
  { weeks: 4, label: '4w' },
  { weeks: 12, label: '12w' },
  { weeks: 24, label: '24w' },
  { weeks: 52, label: '1y' },
];
const DEFAULT_WEEKS = 24;

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

// Module-level formatter — Date.prototype.toLocaleDateString recreates
// an Intl.DateTimeFormat on every call (~0.05ms each). The DayRow
// formats month labels for every visible day; reuse one formatter.
const MONTH_SHORT_FMT = new Intl.DateTimeFormat(undefined, { month: 'short' });

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
  const [windowWeeks, setWindowWeeks] = useState<number>(DEFAULT_WEEKS);

  // Shared crosshair index — when the mouse hovers any strip, every
  // strip in the column draws a vertical line at the same day so the
  // user can sight-read across (energy dot ↔ sleep bar for the same
  // date). `null` = no hover.
  //
  // The crosshair renders as an absolute-positioned overlay (not as an
  // SVG <line>), so updating it doesn't force React to reconcile the
  // thousands of data SVG elements on every mousemove.
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);
  const handleHoverIndex = useCallback((i: number | null) => {
    setHoveredDayIndex((prev) => (prev === i ? prev : i));
  }, []);

  // N weeks of days, ending on `endDate` (a Saturday), starting on
  // the Sunday (N*7 − 1) days earlier. Future days inside the window
  // render as blank columns.
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

  const [rowsByDate, setRowsByDate] = useState<Map<string, DayEntryRow>>(new Map());
  const [activityTotals, setActivityTotals] = useState<Map<string, ActivityTotals>>(new Map());
  const [perf, setPerf] = useState<string>('');

  const startDateKey = dateKey(days[0]);
  const endDateKey = dateKey(days[days.length - 1]);
  const startMs = days[0].getTime();
  const endMs = days[days.length - 1].getTime() + 24 * 60 * 60 * 1000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  useEffect(() => {
    let cancelled = false;
    const tStart = performance.now();
    console.log(`[charts] effect fired window=${windowWeeks}w range=${startDateKey}..${endDateKey}`);

    setPerf(`${windowWeeks}w · EFFECT FIRED at t=0`);

    let banner = document.getElementById('charts-liveness-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'charts-liveness-banner';
      banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        background: #c0392b; color: #fff;
        padding: 8px; font-size: 16px; font-weight: 700;
        font-family: ui-monospace, monospace;
        text-align: center; z-index: 99999;
      `;
      document.body.appendChild(banner);
    }

    let watchdogPhase = 'about-to-query';
    let tickCount = 0;
    const originalTitle = document.title;

    // Multiple liveness probes — at least one should land if JS is
    // doing ANYTHING. If banner stays at "EFFECT_BODY_SYNC_DONE",
    // every async mechanism (microtask, setTimeout, rAF, setInterval)
    // is being starved.
    banner.textContent = 'CHECKPOINT 0: synchronous setup';

    // Microtask
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (banner) banner.textContent = 'CHECKPOINT 1: microtask fired';
    });

    // setTimeout 0
    setTimeout(() => {
      if (cancelled) return;
      if (banner) banner.textContent = 'CHECKPOINT 2: setTimeout(0) fired';
    }, 0);

    // requestAnimationFrame chain — most reliable liveness indicator
    let rafCount = 0;
    const rafTick = () => {
      if (cancelled) return;
      rafCount++;
      if (banner) {
        banner.textContent = `CHECKPOINT 3: rAF#${rafCount} · ${watchdogPhase} · ${((performance.now() - tStart) / 1000).toFixed(1)}s`;
      }
      requestAnimationFrame(rafTick);
    };
    requestAnimationFrame(rafTick);

    // setInterval fallback
    const watchdog = setInterval(() => {
      if (cancelled) return;
      tickCount++;
      const elapsed = ((performance.now() - tStart) / 1000).toFixed(1);
      document.title = `TICK#${tickCount} ${watchdogPhase} ${elapsed}s`;
      setPerf(`${windowWeeks}w · tick#${tickCount} · ${watchdogPhase} · ${elapsed}s`);
    }, 100);
    const restoreTitle = () => { document.title = originalTitle; };
    void restoreTitle;

    banner.textContent = 'CHECKPOINT BODY_END: about to defer runQuery 2s';

    const runQuery = async () => {
      try {
        watchdogPhase = '1/5 querying day_entries…';
        const tQ1Start = performance.now();
        const rows = await getDayEntriesRange(conn, startDateKey, endDateKey);
        if (cancelled) return;
        const tQ1End = performance.now();
        console.log(`[charts] day_entries done rows=${rows.length} dur=${(tQ1End - tQ1Start).toFixed(0)}ms`);

        // Chunk activity_entries into 4 quarter-year queries, run
        // serially. If the single-call query was hanging on payload
        // size or some per-call limit, smaller chunks should sail.
        const allActivities: ActivityEntry[] = [];
        const totalMs = (endMs + MS_PER_DAY) - (startMs - MS_PER_DAY);
        const CHUNKS = 4;
        const tQ2Start = performance.now();
        for (let i = 0; i < CHUNKS; i++) {
          const chunkStart = (startMs - MS_PER_DAY) + (totalMs * i) / CHUNKS;
          const chunkEnd = (startMs - MS_PER_DAY) + (totalMs * (i + 1)) / CHUNKS;
          watchdogPhase = `2/5 activities chunk ${i + 1}/${CHUNKS}…`;
          const tChunkStart = performance.now();
          const chunk = await getActivityEntries(conn, chunkStart, chunkEnd);
          const tChunkEnd = performance.now();
          console.log(`[charts] activity chunk ${i + 1}/${CHUNKS} rows=${chunk.length} dur=${(tChunkEnd - tChunkStart).toFixed(0)}ms`);
          if (cancelled) return;
          allActivities.push(...chunk);
        }
        const tQ2End = performance.now();
        console.log(`[charts] all activity chunks done total=${allActivities.length} dur=${(tQ2End - tQ2Start).toFixed(0)}ms`);

        watchdogPhase = '3/5 building map…';
        const m = new Map<string, DayEntryRow>();
        for (const r of rows) m.set(r.dateKey, r);
        const tMapEnd = performance.now();

        watchdogPhase = '4/5 aggregating…';
        const totals = aggregateActivities(allActivities);
        const tAggEnd = performance.now();
        console.log(`[charts] aggregated dur=${(tAggEnd - tMapEnd).toFixed(0)}ms`);

        watchdogPhase = '5/5 committing…';
        setRowsByDate(m);
        setActivityTotals(totals);
        console.log(`[charts] state set, awaiting React commit`);

        requestAnimationFrame(() => {
          clearInterval(watchdog);
          const tDone = performance.now();
          console.log(`[charts] rendered, total=${(tDone - tStart).toFixed(0)}ms`);
          setPerf(
            `${windowWeeks}w · done · ` +
            `q1 ${(tQ1End - tQ1Start).toFixed(0)} · ` +
            `q2 ${(tQ2End - tQ2Start).toFixed(0)} · ` +
            `agg ${(tAggEnd - tMapEnd).toFixed(0)} · ` +
            `render ${(tDone - tAggEnd).toFixed(0)} · ` +
            `total ${(tDone - tStart).toFixed(0)}ms`
          );
        });
      } catch (err) {
        clearInterval(watchdog);
        console.error('[charts] fetch error', err);
        setPerf(`${windowWeeks}w · error: ${String(err).slice(0, 80)}`);
      }
    };
    // Defer runQuery by 2 seconds. If the banner ticks during those
    // 2 seconds, the freeze happens IN the SQL invoke. If the banner
    // never ticks even during the 2-second delay, the freeze is in
    // the React commit / WebKit paint of the post-effect render.
    setTimeout(() => {
      if (cancelled) return;
      if (banner) banner.textContent = 'CHECKPOINT runQuery: about to call runQuery()';
      runQuery();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(watchdog);
      restoreTitle();
    };
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
        <span
          style={{
            marginLeft: 12,
            fontSize: 11,
            color: '#888',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {perf}
        </span>
      </div>
      {days.length > 200 ? (
        <div style={{ padding: 40, color: '#888', textAlign: 'center' }}>
          1y diagnostic — strips not rendered. Watching liveness banner.
        </div>
      ) : null}
      {days.length <= 200 && <MoodEnergyStrip
        days={days}
        rowsByDate={rowsByDate}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={handleHoverIndex}
      />}
      {days.length <= 200 && <SleepStrip
        days={days}
        rowsByDate={rowsByDate}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={handleHoverIndex}
      />}
      {days.length <= 200 && <ActivityStrip
        days={days}
        activityTotals={activityTotals}
        endDate={endDate}
        onBack={stepBack}
        onForward={stepForward}
        hoveredDayIndex={hoveredDayIndex}
        onHoverIndex={handleHoverIndex}
      />}
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

/** Left-edge percent for the crosshair overlay, centered on column
 *  `i` of `dayCount` columns. Mirrors the per-strip xFor math so the
 *  crosshair lines up with dots / bar centers exactly. */
function crosshairLeftPct(i: number, dayCount: number): number {
  const colVbox = (VBOX_W - 2 * PAD_X) / dayCount;
  const centerVbox = PAD_X + colVbox * (i + 0.5);
  return (centerVbox / VBOX_W) * 100;
}

interface CrosshairOverlayProps {
  hoveredDayIndex: number | null;
  dayCount: number;
}
function CrosshairOverlay({ hoveredDayIndex, dayCount }: CrosshairOverlayProps) {
  if (hoveredDayIndex == null || hoveredDayIndex < 0 || hoveredDayIndex >= dayCount) {
    return null;
  }
  const leftPct = crosshairLeftPct(hoveredDayIndex, dayCount);
  return (
    <div
      className="chart-crosshair-line"
      style={{ left: `${leftPct}%` }}
      aria-hidden="true"
    />
  );
}

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

  // Walk each day once and build mood + energy + wellness series in
  // parallel. Memoized on (days, rowsByDate) so that hover-induced
  // re-renders don't rebuild ~5,000 segment / point objects.
  // Segments only bridge consecutive days that both have a value for
  // the given metric, so missing days read as missing.
  type Segment = { x1: number; y1: number; x2: number; y2: number };
  type Point = { i: number; level: number; x: number; y: number };

  const {
    energySegments, energyPoints,
    moodSegments, moodPoints,
    wellnessSegments, wellnessPoints,
  } = useMemo(() => {
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

    return {
      energySegments, energyPoints,
      moodSegments, moodPoints,
      wellnessSegments, wellnessPoints,
    };
    // xFor/yFor/colW/plotH are derived from days.length, so days is
    // a sufficient dep for those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, rowsByDate]);

  const todayMs = useMemo(() => startOfLocalDay(new Date()).getTime(), []);

  // Skip per-day dots on long windows — at 1y each dot is sub-pixel-
  // tight against its neighbors, and 1,100 individual <circle>
  // elements is what was making 1y unresponsive in WebKit. The lines
  // alone read fine at 1y; users can switch to 24w to see daily marks.
  const showDots = days.length <= 200;

  // The heavy SVG body — memoized so hover-induced strip re-renders
  // get back the same React element reference and React's reconciler
  // bails out without diffing the children.
  const svgEl = useMemo(() => (
    days.length > 200 ? (
      <svg
        className="chart-svg"
        viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
        preserveAspectRatio="none"
        role="img"
      >
        <text x={VBOX_W / 2} y={VBOX_H / 2} fill="#666" fontSize="2" textAnchor="middle">
          1y diagnostic — chart disabled
        </text>
      </svg>
    ) :
    <svg
      className="chart-svg"
      viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Mood, energy and wellness"
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
      {days.length <= 200 && days.map((d, i) => (
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

      {/* Lines collapsed to one <path> per series — 1y view used
          to render ~1,000 <line> elements just for the line plots;
          this brings it down to 3. Dots stay individual since each
          has its own fill color (palette per value). Tooltips
          removed: the SVG has pointer-events:none anyway. */}
      {showWellness && wellnessSegments.length > 0 && (
        <path
          d={wellnessSegments.map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')}
          className="chart-wellness-line"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {showDots && showWellness && wellnessPoints.map((p) => (
        <circle
          key={`well-pt-${p.i}`}
          cx={p.x}
          cy={p.y}
          r={0.55}
          fill={WELLNESS_LINE_COLOR}
        />
      ))}

      {showMood && moodSegments.length > 0 && (
        <path
          d={moodSegments.map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')}
          className="chart-mood-line"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {showDots && showMood && moodPoints.map((p) => (
        <circle
          key={`mood-pt-${p.i}`}
          cx={p.x}
          cy={p.y}
          r={0.55}
          fill={moodColorForScore(p.level)}
        />
      ))}

      {showEnergy && energySegments.length > 0 && (
        <path
          d={energySegments.map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('')}
          className="chart-energy-line"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {showDots && showEnergy && energyPoints.map((p) => (
        <circle
          key={`energy-pt-${p.i}`}
          cx={p.x}
          cy={p.y}
          r={0.55}
          fill={ENERGY_COLORS[p.level - 1]}
        />
      ))}
    </svg>
    // colW, plotH, xFor, yFor are derived from `days`; deps below
    // capture everything that actually affects the SVG output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [
    days, todayMs,
    showMood, showEnergy, showWellness, showDots,
    moodSegments, moodPoints,
    energySegments, energyPoints,
    wellnessSegments, wellnessPoints,
  ]);

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
      <div className="chart-svg-wrap">
        {svgEl}
        <CrosshairOverlay hoveredDayIndex={hoveredDayIndex} dayCount={days.length} />
      </div>

        <DayRow days={days} todayMs={todayMs} />
      </div>
    </section>
  );
}

interface DayRowProps {
  days: Date[];
  todayMs: number;
}
/** Calendar strip beneath each chart. Renders only the cells that
 *  actually have content (the 1st of each month and today),
 *  absolutely positioned by percent. The previous version drew one
 *  div per day inside a `repeat(N, 1fr)` grid — at 1y that was 364
 *  cells per strip and WebKit's grid layout pass cost was material. */
const DayRow = memo(function DayRow({ days, todayMs }: DayRowProps) {
  const labels: { i: number; leftPct: number; label: string; isToday: boolean }[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const isFirstOfMonth = d.getDate() === 1;
    const isToday = startOfLocalDay(d).getTime() === todayMs;
    if (!isFirstOfMonth && !isToday) continue;
    // Same centered-column math as crosshairLeftPct so labels sit
    // under the correct day column.
    const colVbox = (VBOX_W - 2 * PAD_X) / days.length;
    const centerVbox = PAD_X + colVbox * (i + 0.5);
    labels.push({
      i,
      leftPct: (centerVbox / VBOX_W) * 100,
      label: isFirstOfMonth ? MONTH_SHORT_FMT.format(d) : '',
      isToday,
    });
  }
  return (
    <div className="chart-day-row">
      {labels.map((l) => (
        <div
          key={l.i}
          className={`chart-day-cell${l.isToday ? ' today' : ''}`}
          style={{ left: `${l.leftPct}%` }}
        >
          {l.label && <div className="chart-day-month">{l.label}</div>}
        </div>
      ))}
    </div>
  );
});


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

  const bars = useMemo(() => {
    return days.map((d, i) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, rowsByDate]);

  const todayMs = useMemo(() => startOfLocalDay(new Date()).getTime(), []);

  const svgEl = useMemo(() => (
    days.length > 200 ? (
      <svg className="chart-svg" viewBox={`0 0 ${VBOX_W} ${VBOX_H}`} preserveAspectRatio="none" role="img" />
    ) :
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

      {days.length <= 200 && days.map((d, i) => (
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

      {/* One <path> per quality color — collapses 364 <rect>s into
          ≤5 paths on the 1y view. Same rounded-corner look is lost
          (paths use straight rects), but the perf win at 1y matters
          more than the 0.1 viewBox-unit corner radius. */}
      {RATING_COLORS.map((color, qIdx) => {
        const q = qIdx + 1;
        let d = '';
        for (const b of bars) {
          if (b.quality !== q) continue;
          const x1 = b.x;
          const x2 = b.x + b.width;
          const y1 = b.y;
          const y2 = b.y + b.height;
          d += `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
        }
        if (!d) return null;
        return <path key={`sleep-q${q}`} d={d} fill={color} />;
      })}
      {/* Bars whose quality wasn't set still need to render — group
          them as the gray catch-all. */}
      {(() => {
        let d = '';
        for (const b of bars) {
          if (b.quality != null && b.quality >= 1 && b.quality <= 5) continue;
          const x1 = b.x;
          const x2 = b.x + b.width;
          const y1 = b.y;
          const y2 = b.y + b.height;
          d += `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
        }
        return d ? <path d={d} fill="#6B7280" /> : null;
      })()}
    </svg>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [days, todayMs, bars]);

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
      <div className="chart-svg-wrap">
        {svgEl}
        <CrosshairOverlay hoveredDayIndex={hoveredDayIndex} dayCount={days.length} />
      </div>

        <DayRow days={days} todayMs={todayMs} />
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
  // Memoized so hover updates don't rebuild ~1,800 bar segments.
  const segmentsByDay = useMemo(() => {
    return days.map((d, i) => {
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
    // hidden is captured via visibleTypes; deps below cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, activityTotals, hidden]);

  const todayMs = useMemo(() => startOfLocalDay(new Date()).getTime(), []);

  const svgEl = useMemo(() => (
    days.length > 200 ? (
      <svg className="chart-svg" viewBox={`0 0 ${VBOX_W} ${VBOX_H}`} preserveAspectRatio="none" role="img" />
    ) :
    <svg
      className="chart-svg"
      viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Activity mix per day, stacked by type"
    >
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

      {days.length <= 200 && days.map((d, i) => (
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

      {/* One <path> per activity type — collapses 1y's ~2,000
          <rect>s into ~10 path elements. Each subpath is one day's
          segment for that type drawn as four straight lines. */}
      {ACTIVITY_STACK_ORDER.map((type) => {
        const color = ACTIVITY_COLORS[type] ?? ACTIVITY_COLORS.other ?? '#767676';
        let d = '';
        for (const day of segmentsByDay) {
          for (const seg of day.segments) {
            if (seg.type !== type) continue;
            const x1 = day.x;
            const x2 = day.x + day.width;
            const y1 = seg.y;
            const y2 = seg.y + seg.h;
            d += `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
          }
        }
        if (!d) return null;
        return <path key={`act-${type}`} d={d} fill={color} />;
      })}
    </svg>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [days, todayMs, segmentsByDay]);

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
      <div className="chart-svg-wrap">
        {svgEl}
        <CrosshairOverlay hoveredDayIndex={hoveredDayIndex} dayCount={days.length} />
      </div>

        <DayRow days={days} todayMs={todayMs} />
      </div>
    </section>
  );
}
