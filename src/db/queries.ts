import type Database from '@tauri-apps/plugin-sql';
import type {
  ActivityEntry,
  DayEntryRow,
  EnergyEntry,
  HistoricalWeather,
  MoodEntry,
  NoteEntry,
} from './types';

type Conn = Awaited<ReturnType<typeof Database.load>>;

export async function getMoodEntries(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<MoodEntry[]> {
  return conn.select<MoodEntry[]>(
    `SELECT id, timestamp, type, notes, endTimestamp
     FROM mood_entries
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
}

export async function getEnergyEntries(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<EnergyEntry[]> {
  return conn.select<EnergyEntry[]>(
    `SELECT id, timestamp, level, notes, endTimestamp
     FROM energy_entries
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
}

export async function getActivityEntries(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<ActivityEntry[]> {
  // Only the columns aggregateActivities actually reads. Trims the
  // Tauri IPC payload from ~8 to 3 fields per row — at 1y that drops
  // the activity payload from ~500KB to ~150KB, which was enough to
  // unblock the IPC bridge on WebKit.
  const rows = await conn.select<{ timestamp: number; type: string; fillGaps: number }[]>(
    `SELECT timestamp, type, fillGaps
     FROM activity_entries
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
  return rows.map((r) => ({
    id: '',
    timestamp: r.timestamp,
    type: r.type,
    duration: 0,
    notes: null,
    endTimestamp: null,
    fillGaps: !!r.fillGaps,
    isGapFiller: false,
  }));
}

export async function getNoteEntries(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<NoteEntry[]> {
  const rows = await conn.select<any[]>(
    `SELECT id, timestamp, text, isMeal, isHealth, isCycle, cycleColor, calories
     FROM note_entries
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
  return rows.map((r) => ({
    ...r,
    isMeal: !!r.isMeal,
    isHealth: !!r.isHealth,
    isCycle: !!r.isCycle,
  }));
}

/**
 * Cycle notes only — used to draw the cycle phase strip above the chart.
 * Pulled separately (and with a wider window than the visible chart) so
 * a phase that started before the visible range still gets rendered for
 * its remaining days.
 */
export async function getCycleNotes(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<NoteEntry[]> {
  const rows = await conn.select<any[]>(
    `SELECT id, timestamp, text, isMeal, isHealth, isCycle, cycleColor, calories
     FROM note_entries
     WHERE isCycle = 1 AND timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
  return rows.map((r) => ({
    ...r,
    isMeal: !!r.isMeal,
    isHealth: !!r.isHealth,
    isCycle: !!r.isCycle,
  }));
}

export async function getDayEntriesRange(
  conn: Conn,
  startDateKey: string,
  endDateKey: string
): Promise<DayEntryRow[]> {
  // `screenTimeMinutes` and `hkDietaryCalories` are recent
  // migrations. Some older bundles won't have those columns — fall
  // back to the legacy column list if SELECTing them errors out, so
  // the rest of the metrics still load.
  try {
    return await conn.select<DayEntryRow[]>(
      `SELECT
         dateKey, mood, moodValues, energy, onLevel, wellnessLevel,
         steps, restingHeartRate, avgBodyWeight, hrv,
         sleepQuality, sleepOnset, sleepWakeFeel, sleepWakeUps,
         sleepDurationHours, sleepDurationMinutes, sleepInsomniaMinutes,
         hkSleepDuration, hkDeepSleep, hkRemSleep, screenTimeMinutes,
         hkDietaryCalories,
         pressureData, pollenData, airQualityData, uvData
       FROM day_entries
       WHERE dateKey >= ? AND dateKey <= ?`,
      [startDateKey, endDateKey]
    );
  } catch {
    return conn.select<DayEntryRow[]>(
      `SELECT
         dateKey, mood, moodValues, energy, onLevel, wellnessLevel,
         steps, restingHeartRate, avgBodyWeight, hrv,
         sleepQuality, sleepOnset, sleepWakeFeel, sleepWakeUps,
         sleepDurationHours, sleepDurationMinutes, sleepInsomniaMinutes,
         hkSleepDuration, hkDeepSleep, hkRemSleep,
         pressureData, pollenData, airQualityData, uvData
       FROM day_entries
       WHERE dateKey >= ? AND dateKey <= ?`,
      [startDateKey, endDateKey]
    );
  }
}

/**
 * Daily calorie totals from meal-flagged notes (`isMeal = 1`).
 * Mirrors the iPhone WeekView's note-aggregation path — HealthKit
 * calories aren't exported (they're refetched at render time on iOS),
 * so this is the source of truth in the viewer.
 */
export async function getDailyCaloriesRange(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<{ dateKey: string; calories: number }[]> {
  try {
    // SQLite's `date(timestamp/1000, 'unixepoch', 'localtime')` groups
    // millisecond timestamps into local YYYY-MM-DD keys.
    return await conn.select<{ dateKey: string; calories: number }[]>(
      `SELECT
         date(timestamp/1000, 'unixepoch', 'localtime') AS dateKey,
         COALESCE(SUM(calories), 0) AS calories
       FROM note_entries
       WHERE isMeal = 1
         AND calories IS NOT NULL
         AND timestamp >= ?
         AND timestamp < ?
       GROUP BY dateKey`,
      [sinceMs, untilMs]
    );
  } catch (err) {
    console.warn('[Queries] getDailyCaloriesRange failed', err);
    return [];
  }
}

/**
 * Pomodoro completions per day. The pomodoro_entries table may be
 * absent on older bundles — fall back to an empty array.
 */
export async function getPomodoroCountsRange(
  conn: Conn,
  sinceMs: number,
  untilMs: number
): Promise<{ dateKey: string; count: number }[]> {
  try {
    // Schema: pomodoro_entries(id, startTime, endTime, focusText).
    // One row per completed pomodoro; we tally by start-time's
    // local-date.
    const rows = await conn.select<{ id: string; startTime: number }[]>(
      `SELECT id, startTime FROM pomodoro_entries
       WHERE startTime >= ? AND startTime < ?`,
      [sinceMs, untilMs]
    );
    const tally = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.startTime);
      const k =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    return Array.from(tally.entries()).map(([dateKey, count]) => ({ dateKey, count }));
  } catch {
    return [];
  }
}

export async function getHistoricalWeatherRange(
  conn: Conn,
  startDateKey: string,
  endDateKey: string
): Promise<HistoricalWeather[]> {
  // `humidityPercent` was added later — fall back without it on
  // older bundles where the column doesn't exist.
  try {
    const rows = await conn.select<any[]>(
      `SELECT dateKey, timestamp, temperature, temperatureUnit, precipProb, shortForecast, isDaytime, humidityPercent
       FROM historical_weather
       WHERE dateKey >= ? AND dateKey <= ?
       ORDER BY dateKey ASC`,
      [startDateKey, endDateKey]
    );
    return rows.map((r) => ({ ...r, isDaytime: !!r.isDaytime }));
  } catch {
    try {
      const rows = await conn.select<any[]>(
        `SELECT dateKey, timestamp, temperature, temperatureUnit, precipProb, shortForecast, isDaytime
         FROM historical_weather
         WHERE dateKey >= ? AND dateKey <= ?
         ORDER BY dateKey ASC`,
        [startDateKey, endDateKey]
      );
      return rows.map((r) => ({ ...r, isDaytime: !!r.isDaytime, humidityPercent: null }));
    } catch {
      return [];
    }
  }
}

/**
 * Custom trackers defined by the user (one row per tracker key).
 * `type` drives how a day's value is aggregated + rendered.
 */
export type TrackerType =
  | 'text'
  | 'count'
  | 'sum'
  | 'average'
  | 'traffic_light'
  | 'itemized_list'
  | 'toggle'
  | 'non_numeric'
  | 'currency';

export interface CustomTrackingItem {
  id: string;
  key: string;
  label: string;
  isNumeric: number;
  type: TrackerType | null;
  color: string;
  createdAt: number;
  category: string | null;
  listItems: string | null;
}

export async function getCustomTrackingItems(conn: Conn): Promise<CustomTrackingItem[]> {
  // `category` and `listItems` are recent ALTER TABLE columns. Older
  // bundles won't have them — fall back without if SELECT fails.
  try {
    return await conn.select<CustomTrackingItem[]>(
      `SELECT id, key, label, isNumeric, type, color, createdAt, category, listItems
       FROM custom_tracking_items
       ORDER BY createdAt ASC`,
    );
  } catch {
    try {
      const rows = await conn.select<Omit<CustomTrackingItem, 'category' | 'listItems'>[]>(
        `SELECT id, key, label, isNumeric, type, color, createdAt
         FROM custom_tracking_items
         ORDER BY createdAt ASC`,
      );
      return rows.map((r) => ({ ...r, category: null, listItems: null }));
    } catch {
      return [];
    }
  }
}

/**
 * Habits / day-todo items defined by the user. One row per habit;
 * completions live in a separate table (`day_todo_completions`).
 */
export interface DayTodoItem {
  id: string;
  label: string;
  notes: string | null;
  createdAt: number;
}

export async function getDayTodoItems(conn: Conn): Promise<DayTodoItem[]> {
  try {
    return await conn.select<DayTodoItem[]>(
      `SELECT id, label, notes, createdAt FROM day_todo_items ORDER BY createdAt ASC`
    );
  } catch {
    return [];
  }
}

/**
 * Completion rows for the given local-date range. Each row marks
 * one habit done on one day (unique on (todoItemId, dateKey)).
 */
export async function getDayTodoCompletionsRange(
  conn: Conn,
  startDateKey: string,
  endDateKey: string,
): Promise<{ todoItemId: string; dateKey: string }[]> {
  try {
    return await conn.select<{ todoItemId: string; dateKey: string }[]>(
      `SELECT todoItemId, dateKey FROM day_todo_completions
       WHERE dateKey >= ? AND dateKey <= ?`,
      [startDateKey, endDateKey],
    );
  } catch {
    return [];
  }
}

/**
 * Read the `app_settings` snapshot the iOS app writes into the DB at
 * export time. Returns an empty object if the table doesn't exist
 * (older bundles) or any rows are missing.
 */
export async function getAppSettings(conn: Conn): Promise<Record<string, string>> {
  try {
    const rows = await conn.select<{ key: string; value: string | null }[]>(
      'SELECT key, value FROM app_settings'
    );
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r.value != null) out[r.key] = r.value;
    }
    return out;
  } catch {
    // Table likely doesn't exist on bundles exported before app_settings
    // was introduced. Caller should fall back to defaults.
    return {};
  }
}

export async function getOverallTimeRange(
  conn: Conn
): Promise<{ minMs: number; maxMs: number } | null> {
  const rows = await conn.select<{ minMs: number | null; maxMs: number | null }[]>(
    `SELECT
       MIN(t) AS minMs,
       MAX(t) AS maxMs
     FROM (
       SELECT timestamp AS t FROM mood_entries
       UNION ALL SELECT timestamp FROM energy_entries
       UNION ALL SELECT timestamp FROM activity_entries
       UNION ALL SELECT timestamp FROM note_entries
     )`
  );
  const r = rows[0];
  if (!r || r.minMs == null || r.maxMs == null) return null;
  return { minMs: r.minMs, maxMs: r.maxMs };
}

export type Conn_ = Conn;
