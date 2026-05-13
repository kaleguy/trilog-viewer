import type { ActivityEntry } from '../db/types';

export interface ActivityTotals {
  // type lowercased → hours
  byType: Map<string, number>;
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
      // Compute "start of NEXT local day" via calendar arithmetic,
      // NOT cursor + 24*hours. On DST fall-back days the local day
      // is 25 hours long, so dayStart + 24h lands inside the same
      // local day — cursor never advances and the loop spins forever.
      const cursorDate = new Date(cursor);
      const nextDayDate = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
      );
      const dayEnd = nextDayDate.getTime();
      const sliceEnd = Math.min(end, dayEnd);
      if (sliceEnd <= cursor) {
        // Defensive guard in case the timezone arithmetic still
        // doesn't advance for some pathological input. Bail rather
        // than freeze the renderer.
        break;
      }
      const hours = (sliceEnd - cursor) / HOUR_MS;
      const k = dateKey(cursorDate);
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
