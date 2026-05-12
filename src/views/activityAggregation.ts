import type { ActivityEntry } from '../db/types';

export interface ActivityTotals {
  // type lowercased → hours
  byType: Map<string, number>;
}

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
 * Per-day hours-by-type, mirroring the iPhone WeekView's per-cell
 * duration math. Activity entries don't carry a meaningful `duration`
 * field anymore (always stored as 1 as a stub); the real span of each
 * entry is the gap to the next entry, capped at 1h baseline, extended
 * to next when `next.fillGaps` is set.
 *
 * Each entry's effective interval is then split across calendar days
 * so that e.g. sleep from 23:00 to 07:00 contributes 1 h to the start
 * day and 7 h to the next.
 */
export function aggregateActivities(activities: ActivityEntry[]): Map<string, ActivityTotals> {
  const out = new Map<string, ActivityTotals>();
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const sorted = [...activities].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const next: ActivityEntry | undefined = sorted[i + 1];
    const start = entry.timestamp;
    let end: number;
    if (next) {
      const gap = next.timestamp - start;
      if (gap < HOUR_MS) {
        end = next.timestamp;
      } else if (next.fillGaps) {
        end = next.timestamp;
      } else {
        end = start + HOUR_MS;
      }
    } else {
      end = start + HOUR_MS;
    }
    if (end <= start) continue;

    const type = entry.type.toLowerCase();
    let cursor = start;
    while (cursor < end) {
      const dayStart = startOfLocalDay(new Date(cursor)).getTime();
      const dayEnd = dayStart + DAY_MS;
      const sliceEnd = Math.min(end, dayEnd);
      const hours = (sliceEnd - cursor) / HOUR_MS;
      const k = dateKey(new Date(cursor));
      let bucket = out.get(k);
      if (!bucket) {
        bucket = { byType: new Map() };
        out.set(k, bucket);
      }
      bucket.byType.set(type, (bucket.byType.get(type) ?? 0) + hours);
      cursor = sliceEnd;
    }
  }
  return out;
}
