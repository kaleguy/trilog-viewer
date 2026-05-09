import type Database from '@tauri-apps/plugin-sql';
import type {
  ActivityEntry,
  EnergyEntry,
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
