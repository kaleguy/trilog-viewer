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
  const rows = await conn.select<any[]>(
    `SELECT id, timestamp, type, duration, notes, endTimestamp, fillGaps, isGapFiller
     FROM activity_entries
     WHERE timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs]
  );
  return rows.map((r) => ({
    ...r,
    fillGaps: !!r.fillGaps,
    isGapFiller: !!r.isGapFiller,
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
  return conn.select<DayEntryRow[]>(
    `SELECT
       dateKey, mood, energy, onLevel, wellnessLevel,
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
    const rows = await conn.select<{ id: string; timestamp: number }[]>(
      `SELECT id, timestamp FROM pomodoro_entries
       WHERE timestamp >= ? AND timestamp < ?`,
      [sinceMs, untilMs]
    );
    const tally = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.timestamp);
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
  try {
    const rows = await conn.select<any[]>(
      `SELECT dateKey, timestamp, temperature, temperatureUnit, precipProb, shortForecast, isDaytime
       FROM historical_weather
       WHERE dateKey >= ? AND dateKey <= ?
       ORDER BY dateKey ASC`,
      [startDateKey, endDateKey]
    );
    return rows.map((r) => ({ ...r, isDaytime: !!r.isDaytime }));
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
