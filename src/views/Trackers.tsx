import { useEffect, useState } from 'react';
import {
  getCustomTrackingItems,
  getNoteEntries,
  type CustomTrackingItem,
  type Conn_,
} from '../db/queries';
import type { NoteEntry } from '../db/types';
import { aggregateTrackersForDay, normalizeType, type CustomTrackingValue } from './customTrackingParser';
import './Habits.css'; // reuse the row-stacked grid styles
import './Trackers.css';

interface Props {
  conn: Conn_;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 42;
const TRAFFIC_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#8BC34A', '#34C759'];

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

function thisOrNextSaturday(date: Date): Date {
  const result = startOfLocalDay(date);
  const offset = (6 - result.getDay() + 7) % 7;
  if (offset > 0) result.setDate(result.getDate() + offset);
  return result;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function renderTrackerCell(
  value: CustomTrackingValue | undefined,
  item: CustomTrackingItem,
): React.ReactNode {
  if (value === undefined) return null;
  const type = normalizeType(item.type, item.isNumeric);
  if (type === 'traffic_light') {
    if (typeof value !== 'number') return null;
    const level = Math.max(1, Math.min(5, Math.round(value)));
    return <span className="tracker-fill" style={{ backgroundColor: TRAFFIC_COLORS[level - 1] }} />;
  }
  if (type === 'toggle') {
    return value === true ? <span className="tracker-fill" style={{ backgroundColor: '#00CC55' }} /> : null;
  }
  if (type === 'sum' || type === 'count' || type === 'average' || type === 'itemized_list') {
    if (typeof value !== 'number') return null;
    const display = type === 'average'
      ? (Number.isInteger(value) ? value.toString() : value.toFixed(1))
      : Math.round(value).toString();
    return <span className="tracker-num">{display}</span>;
  }
  // text type — value is true (or 'negative')
  if (value === 'negative') return <span className="tracker-fill" style={{ backgroundColor: '#FF3B30' }} />;
  return <span className="tracker-fill" style={{ backgroundColor: '#0066CC' }} />;
}

export function Trackers({ conn }: Props) {
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));
  const [days, setDaysList] = useState<Date[]>([]);
  const [items, setItems] = useState<CustomTrackingItem[]>([]);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!days.length) return;
    let cancelled = false;
    setLoading(true);
    // Pull all notes through endMs (not just inside the window) so
    // toggle trackers can see prior on/off events for state at
    // window-start. Window-cap at endMs avoids fetching future notes.
    Promise.all([
      getCustomTrackingItems(conn),
      getNoteEntries(conn, 0, endMs),
    ])
      .then(([trackerItems, noteRows]) => {
        if (cancelled) return;
        setItems(trackerItems);
        setNotes(noteRows);
      })
      .catch((err) => console.error('[Trackers] fetch failed', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conn, days, startMs, endMs]);

  // Pre-compute (itemKey, dateKey) → value lookup for all visible
  // days. Done in one pass so each row render is just a Map.get.
  const valuesByItemAndDate = (() => {
    const out = new Map<string, Map<string, CustomTrackingValue>>();
    for (const d of days) {
      const dayStart = startOfLocalDay(d).getTime();
      const dayEnd = dayStart + MS_PER_DAY - 1;
      const k = dateKey(d);
      const dayValues = aggregateTrackersForDay(notes, dayStart, dayEnd, items);
      for (const [itemKey, value] of dayValues) {
        if (!out.has(itemKey)) out.set(itemKey, new Map());
        out.get(itemKey)!.set(k, value);
      }
    }
    return out;
  })();

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
    <div className="habits">
      <div className="habits-toolbar">
        <div className="habits-date-nav">
          <button type="button" onClick={stepBack}>‹</button>
          <span className="habits-date-range">
            {days.length > 0 ? `Week ${isoWeekNumber(days[days.length - 1])}` : ''}
          </span>
          <button type="button" onClick={stepForward}>›</button>
        </div>
        {loading && <span className="habits-loading">Loading…</span>}
      </div>

      <div className="habits-scroll">
        <div className="habits-day-head-row" role="row">
          {days.map((d) => {
            const isFirstOfMonth = d.getDate() === 1;
            const isToday = startOfLocalDay(d).getTime() === todayMs;
            const topLine = isFirstOfMonth
              ? d.toLocaleDateString(undefined, { month: 'short' })
              : WEEKDAY_LETTERS[d.getDay()];
            return (
              <div
                key={d.toISOString()}
                className={`habits-day-head${isToday ? ' today' : ''}`}
                title={d.toLocaleDateString(undefined, {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              >
                <div className={`habits-day-head-top${isFirstOfMonth ? ' month' : ''}`}>
                  {topLine}
                </div>
                <div className="habits-day-head-num">{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {items.length === 0 ? (
          <div className="habits-empty">
            No trackers yet. Define them in the iPhone app via Extras → Trackers.
          </div>
        ) : (
          items.map((item) => {
            const itemValues = valuesByItemAndDate.get(item.key) ?? new Map();
            return (
              <div key={item.id} className="habits-row-group">
                <div className="habits-row-label" title={item.label}>
                  {item.label}
                </div>
                <div className="habits-cells-row">
                  {days.map((d) => {
                    const k = dateKey(d);
                    const isPastOrToday = startOfLocalDay(d).getTime() <= todayMs;
                    const value = itemValues.get(k);
                    const content = renderTrackerCell(value, item);
                    return (
                      <div key={k} className="habits-cell">
                        {content ?? (isPastOrToday ? <span className="habits-empty-past" /> : null)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
