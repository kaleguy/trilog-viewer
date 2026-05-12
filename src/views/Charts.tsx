import { useEffect, useMemo, useState } from 'react';
import { getDayEntriesRange, type Conn_ } from '../db/queries';
import { ENERGY_COLORS, type DayEntryRow } from '../db/types';
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
      <EnergyStrip
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

interface EnergyStripProps {
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

function EnergyStrip({ days, rowsByDate, endDate, onBack, onForward }: EnergyStripProps) {
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

  // Build the line as a series of line segments only where two
  // consecutive days both have a value. Don't bridge gaps — we
  // don't want to imply data we didn't collect.
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let prev: { i: number; y: number } | null = null;
  const points: { i: number; level: number; x: number; y: number }[] = [];
  days.forEach((d, i) => {
    const row = rowsByDate.get(dateKey(d));
    const level = row?.energy ?? null;
    if (level == null || level < 1 || level > 5) {
      prev = null;
      return;
    }
    const x = xFor(i);
    const y = yFor(level);
    points.push({ i, level, x, y });
    if (prev) {
      segments.push({ x1: xFor(prev.i), y1: prev.y, x2: x, y2: y });
    }
    prev = { i, y };
  });

  const todayMs = startOfLocalDay(new Date()).getTime();

  return (
    <section className="chart-strip">
      <header className="chart-strip-head">
        <h3 className="chart-strip-title">Energy</h3>
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

          {/* Energy line — yellow, broken across gaps. preserveAspectRatio
              is "none" so we scale x/y independently; vector-effect on the
              path keeps the stroke crisp. */}
          {segments.map((s, i) => (
            <line
              key={`seg-${i}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              className="chart-energy-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Dots — color per ENERGY_COLORS (matches iPhone palette) */}
          {points.map((p) => (
            <circle
              key={`pt-${p.i}`}
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
