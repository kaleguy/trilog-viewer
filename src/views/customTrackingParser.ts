import type { CustomTrackingItem, TrackerType } from '../db/queries';
import type { NoteEntry } from '../db/types';

/**
 * Parser for the iPhone WeekView's "t <key> [value] [notes]" note
 * format — ported from `utils/customTrackingParser.ts` in the iPhone
 * app. Keep the shape in lockstep.
 */

export interface ParsedTrackingNote {
  key: string;
  value: number | null;
  isNegative: boolean;
}

export type CustomTrackingValue = number | boolean | 'negative';

function normalizeType(t: TrackerType | null, isNumeric: number): TrackerType {
  let type: TrackerType = t ?? (isNumeric ? 'sum' : 'text');
  if (type === 'non_numeric') type = 'text';
  if (type === 'currency') type = 'sum';
  return type;
}

const TRACKER_REGEX = /^\s*(?:t|track)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(-?[\d]+(?:\.[\d]+)?))?/gim;

function parseNote(text: string, labelToKey: Map<string, string>): ParsedTrackingNote[] {
  const out: ParsedTrackingNote[] = [];
  if (!text) return out;
  const regex = new RegExp(TRACKER_REGEX); // fresh state per call
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const keyOrLabel = (match[1] || '').toLowerCase();
    const valueStr = match[2];
    const value = valueStr ? parseFloat(valueStr) : null;
    const key = labelToKey.get(keyOrLabel) || keyOrLabel;
    let isNegative = false;
    if (valueStr === undefined) {
      const remainder = text.slice(regex.lastIndex).replace(/^\s+/, '');
      if (remainder.startsWith('-')) {
        const lookahead = remainder.slice(1).trimStart();
        if (!/^\d/.test(lookahead)) isNegative = true;
      }
    }
    out.push({
      key,
      value: value !== null && !isNaN(value) ? value : null,
      isNegative,
    });
  }
  return out;
}

/**
 * Aggregate one day's tracker values from raw notes. Mirrors the
 * iPhone's `getCustomTrackingForDay` semantics:
 *   • sum/count/average: numeric
 *   • text: true | 'negative'
 *   • traffic_light: average 1..5
 *   • itemized_list: count
 *   • toggle: true when most recent event on-or-before dayEnd is ON
 */
export function aggregateTrackersForDay(
  allNotes: NoteEntry[],
  dayStartMs: number,
  dayEndMs: number,
  items: CustomTrackingItem[],
): Map<string, CustomTrackingValue> {
  const result = new Map<string, CustomTrackingValue>();
  if (!allNotes.length || !items.length) return result;

  const itemsByKey = new Map<string, CustomTrackingItem>();
  const labelToKey = new Map<string, string>();
  for (const item of items) {
    if (item.key) itemsByKey.set(item.key.toLowerCase(), item);
    if (item.label) labelToKey.set(item.label.toLowerCase(), item.key.toLowerCase());
  }

  const dayNotes = allNotes.filter((n) => n.timestamp >= dayStartMs && n.timestamp <= dayEndMs);

  // Temporary maps for per-day average calculations.
  const trafficLight = new Map<string, { sum: number; count: number }>();
  const average = new Map<string, { sum: number; count: number }>();

  for (const note of dayNotes) {
    if (!note?.text) continue;
    const parsed = parseNote(note.text, labelToKey);
    for (const entry of parsed) {
      const item = itemsByKey.get(entry.key.toLowerCase());
      if (!item) continue;
      const type = normalizeType(item.type, item.isNumeric);
      switch (type) {
        case 'text': {
          const current = result.get(item.key);
          if (entry.isNegative) result.set(item.key, 'negative');
          else if (current === undefined) result.set(item.key, true);
          break;
        }
        case 'count':
        case 'itemized_list': {
          const current = (result.get(item.key) as number) || 0;
          result.set(item.key, current + 1);
          break;
        }
        case 'sum': {
          if (entry.value !== null) {
            const current = (result.get(item.key) as number) || 0;
            result.set(item.key, current + entry.value);
          }
          break;
        }
        case 'average': {
          if (entry.value !== null) {
            const cur = average.get(item.key) || { sum: 0, count: 0 };
            average.set(item.key, { sum: cur.sum + entry.value, count: cur.count + 1 });
          }
          break;
        }
        case 'traffic_light': {
          if (entry.value !== null) {
            const cur = trafficLight.get(item.key) || { sum: 0, count: 0 };
            trafficLight.set(item.key, { sum: cur.sum + entry.value, count: cur.count + 1 });
          }
          break;
        }
      }
    }
  }

  trafficLight.forEach((d, k) => { if (d.count) result.set(k, d.sum / d.count); });
  average.forEach((d, k) => { if (d.count) result.set(k, d.sum / d.count); });

  // Toggle items: state at end-of-day comes from the most recent
  // matching note with timestamp <= dayEndMs across ALL notes (not
  // just today's). isNegative parser flag → OFF; otherwise ON.
  const toggleItems = items.filter((i) => normalizeType(i.type, i.isNumeric) === 'toggle');
  if (toggleItems.length) {
    const toggleKeys = new Set(toggleItems.map((i) => i.key.toLowerCase()));
    const latest = new Map<string, { isNegative: boolean; timestamp: number }>();
    for (const note of allNotes) {
      if (!note?.text || note.timestamp > dayEndMs) continue;
      for (const entry of parseNote(note.text, labelToKey)) {
        const k = entry.key.toLowerCase();
        if (!toggleKeys.has(k)) continue;
        const existing = latest.get(k);
        if (!existing || note.timestamp > existing.timestamp) {
          latest.set(k, { isNegative: entry.isNegative, timestamp: note.timestamp });
        }
      }
    }
    for (const item of toggleItems) {
      const e = latest.get(item.key.toLowerCase());
      if (e && !e.isNegative) result.set(item.key, true);
    }
  }

  return result;
}

export { normalizeType };
