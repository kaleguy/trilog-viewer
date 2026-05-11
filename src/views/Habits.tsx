import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  getDayTodoItems,
  getDayTodoCompletionsRange,
  type DayTodoItem,
  type Conn_,
} from '../db/queries';
import './Habits.css';

interface Props {
  conn: Conn_;
}

const DEFAULT_DAYS = 42; // 6 weeks, Sun → Sat

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

/** Saturday of the week containing `date`, or `date` itself if it's
 *  already Saturday. Anchors the window so leftmost column = Sunday. */
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

export function Habits({ conn }: Props) {
  const [endDate, setEndDate] = useState<Date>(() => thisOrNextSaturday(new Date()));
  const [days, setDaysList] = useState<Date[]>([]);
  const [items, setItems] = useState<DayTodoItem[]>([]);
  const [completedByItem, setCompletedByItem] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(false);

  // Build the visible day window. Always exactly DEFAULT_DAYS columns
  // ending on `endDate` (a Saturday); leftmost is the Sunday 41 days
  // earlier. Future days render as empty columns.
  useEffect(() => {
    const list: Date[] = [];
    for (let i = DEFAULT_DAYS - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      list.push(d);
    }
    setDaysList(list);
  }, [endDate]);

  const startDateKey = days[0] ? dateKey(days[0]) : '';
  const endDateKey = days.length ? dateKey(days[days.length - 1]) : '';

  useEffect(() => {
    if (!days.length) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getDayTodoItems(conn),
      getDayTodoCompletionsRange(conn, startDateKey, endDateKey),
    ])
      .then(([habitItems, completions]) => {
        if (cancelled) return;
        const byItem = new Map<string, Set<string>>();
        for (const c of completions) {
          if (!byItem.has(c.todoItemId)) byItem.set(c.todoItemId, new Set());
          byItem.get(c.todoItemId)!.add(c.dateKey);
        }
        setItems(habitItems);
        setCompletedByItem(byItem);
      })
      .catch((err) => console.error('[Habits] fetch failed', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [conn, days, startDateKey, endDateKey]);

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
        {/* Day-head row matches Metrics: letter (or month abbr on the
            1st of a month) above the date number, sticky on the
            vertical axis. */}
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
            No habits yet. Define them in the iPhone app via Extras → Habits.
          </div>
        ) : (
          items.map((item) => {
            const completedSet = completedByItem.get(item.id) ?? new Set<string>();
            return (
              <div key={item.id} className="habits-row-group">
                <div className="habits-row-label" title={item.notes ?? undefined}>
                  {item.label}
                </div>
                <div className="habits-cells-row">
                  {days.map((d) => {
                    const k = dateKey(d);
                    const isCompleted = completedSet.has(k);
                    const isPastOrToday = startOfLocalDay(d).getTime() <= todayMs;
                    let cell: React.ReactNode = null;
                    if (isCompleted) {
                      cell = <Check size={16} color="#00CC55" strokeWidth={3} />;
                    } else if (isPastOrToday) {
                      cell = <span className="habits-empty-past" />;
                    }
                    return (
                      <div key={k} className="habits-cell">
                        {cell}
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
