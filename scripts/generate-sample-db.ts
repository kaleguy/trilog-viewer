/**
 * Generate samples/sample-journal.db — a self-contained SQLite file
 * the viewer can open, with ~6 weeks of realistic-looking data so
 * screenshots and demos have something to render.
 *
 * Routine modeled into the data:
 *   • Sleep 11pm–7am every night
 *   • Morning routine 7–8am
 *   • Weekdays: work 9am–5pm, transit ~30 min each way
 *   • Tue/Thu 6–7am: exercise
 *   • Weekends: leisure mornings, socialize afternoons
 *   • 2–4 mood + 2–3 energy snapshots per day
 *   • 1 day_entry per day with sleep + wellness + steps + mood values
 *   • Daily weather (temp + humidity + short forecast)
 *   • 3 habits with realistic completion rates
 *   • 3 trackers (caffeine sum, mood traffic-light, "broke vegan" toggle)
 *   • Snapshot of WeekView visibility settings into `app_settings`
 *
 * Usage:
 *   bun run scripts/generate-sample-db.ts
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_PATH = resolve(__dirname, '../samples/sample-journal.db');
const DAYS = 45;

// -- deterministic PRNG so successive runs produce identical output
let _seed = 0xc0ffee;
function rand(): number {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}
function randInt(min: number, max: number): number { return Math.floor(rand() * (max - min + 1)) + min; }
function pick<T>(xs: readonly T[]): T { return xs[Math.floor(rand() * xs.length)]; }
function chance(p: number): boolean { return rand() < p; }
function id(prefix: string, ts: number): string { return `${prefix}-${ts}-${Math.floor(rand() * 1e6)}`; }

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function at(day: Date, h: number, m: number = 0): number {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// -- Anchor the window so the rightmost cell is "the upcoming Saturday".
//    Matches the viewer's default window position.
function thisOrNextSaturday(date: Date): Date {
  const r = startOfLocalDay(date);
  const offset = (6 - r.getDay() + 7) % 7;
  if (offset > 0) r.setDate(r.getDate() + offset);
  return r;
}

const today = startOfLocalDay(new Date());
const windowEnd = thisOrNextSaturday(today);
const windowStart = new Date(windowEnd);
windowStart.setDate(windowStart.getDate() - (DAYS - 1));

// -- Set up the DB
mkdirSync(dirname(OUT_PATH), { recursive: true });
try { rmSync(OUT_PATH); } catch { /* fresh */ }
const db = new Database(OUT_PATH);

// Schema mirrors the iPhone app's createTables() + ALTER TABLE chain.
db.exec(`
CREATE TABLE mood_entries (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  notes TEXT,
  endTimestamp INTEGER,
  isGapFiller INTEGER DEFAULT 0,
  fillGaps INTEGER DEFAULT 0
);
CREATE TABLE energy_entries (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  level INTEGER NOT NULL,
  notes TEXT,
  endTimestamp INTEGER,
  isGapFiller INTEGER DEFAULT 0,
  fillGaps INTEGER DEFAULT 0
);
CREATE TABLE activity_entries (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  type_id INTEGER,
  duration REAL NOT NULL,
  notes TEXT,
  exerciseType TEXT,
  workoutId TEXT,
  endTimestamp INTEGER,
  isGapFiller INTEGER DEFAULT 0,
  fillGaps INTEGER DEFAULT 1
);
CREATE TABLE note_entries (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  text TEXT NOT NULL,
  isMeal INTEGER DEFAULT 0,
  isHealth INTEGER DEFAULT 0,
  isCycle INTEGER DEFAULT 0,
  cycleColor TEXT,
  calories INTEGER
);
CREATE TABLE pomodoro_entries(
  id TEXT PRIMARY KEY NOT NULL,
  startTime INTEGER NOT NULL,
  endTime INTEGER NOT NULL,
  focusText TEXT
);
CREATE TABLE day_entries(
  dateKey TEXT PRIMARY KEY NOT NULL,
  task1 TEXT, task2 TEXT, task3 TEXT,
  task1Complete INTEGER DEFAULT 0,
  task2Complete INTEGER DEFAULT 0,
  task3Complete INTEGER DEFAULT 0,
  journalEntry TEXT,
  mood TEXT,
  energy INTEGER,
  onLevel INTEGER,
  steps INTEGER,
  pressureData TEXT,
  pollenData TEXT,
  airQualityData TEXT,
  uvData TEXT,
  screenTimeMinutes INTEGER,
  hkDietaryCalories INTEGER,
  moodValues TEXT,
  sleepQuality INTEGER,
  sleepOnset INTEGER,
  sleepWakeFeel INTEGER,
  sleepWakeUps TEXT,
  sleepDurationHours INTEGER,
  sleepDurationMinutes INTEGER,
  sleepInsomniaMinutes INTEGER,
  sleepNotes TEXT,
  wellnessLevel INTEGER,
  symptoms TEXT,
  restingHeartRate INTEGER,
  photoUri TEXT,
  photoAssetId TEXT,
  avgBodyWeight REAL,
  hrv INTEGER,
  hkSleepDuration INTEGER,
  hkDeepSleep INTEGER,
  hkRemSleep INTEGER
);
CREATE TABLE historical_weather(
  dateKey TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  temperature INTEGER,
  temperatureUnit TEXT,
  precipProb REAL,
  shortForecast TEXT NOT NULL,
  detailedForecast TEXT,
  isDaytime INTEGER DEFAULT 1,
  humidityPercent INTEGER
);
CREATE TABLE custom_tracking_items(
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  isNumeric INTEGER DEFAULT 0,
  type TEXT DEFAULT 'non_numeric',
  color TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  category TEXT DEFAULT 'general',
  listItems TEXT
);
CREATE TABLE day_todo_items(
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  notes TEXT,
  createdAt INTEGER NOT NULL
);
CREATE TABLE day_todo_completions(
  id TEXT PRIMARY KEY NOT NULL,
  todoItemId TEXT NOT NULL,
  dateKey TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  UNIQUE(todoItemId, dateKey)
);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`);

// -- Statements
const insMood = db.prepare(`INSERT INTO mood_entries (id, timestamp, type) VALUES (?, ?, ?)`);
const insEnergy = db.prepare(`INSERT INTO energy_entries (id, timestamp, level) VALUES (?, ?, ?)`);
const insActivity = db.prepare(`INSERT INTO activity_entries (id, timestamp, type, duration, fillGaps) VALUES (?, ?, ?, ?, 1)`);
const insNote = db.prepare(`INSERT INTO note_entries (id, timestamp, text, isMeal, isHealth, isCycle, calories) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insPomo = db.prepare(`INSERT INTO pomodoro_entries (id, startTime, endTime, focusText) VALUES (?, ?, ?, ?)`);
const insDay = db.prepare(`INSERT INTO day_entries (
  dateKey, mood, moodValues, energy, onLevel, steps,
  wellnessLevel, sleepQuality, sleepOnset, sleepWakeFeel, sleepWakeUps,
  sleepDurationHours, sleepDurationMinutes,
  hkDietaryCalories, screenTimeMinutes
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insWeather = db.prepare(`INSERT INTO historical_weather (
  dateKey, timestamp, temperature, temperatureUnit, precipProb, shortForecast, detailedForecast, isDaytime, humidityPercent
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insTracker = db.prepare(`INSERT INTO custom_tracking_items (id, key, label, isNumeric, type, color, createdAt, category, listItems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insTodoItem = db.prepare(`INSERT INTO day_todo_items (id, label, notes, createdAt) VALUES (?, ?, ?, ?)`);
const insTodoCompletion = db.prepare(`INSERT INTO day_todo_completions (id, todoItemId, dateKey, timestamp) VALUES (?, ?, ?, ?)`);
const insSetting = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`);

// -- Habits + trackers (need IDs reusable across days)
const habits = [
  { id: 'habit-water',  label: 'Drink water',   notes: 'aim for 8 glasses',     completion: 0.85 },
  { id: 'habit-read',   label: 'Read 20 minutes', notes: null,                 completion: 0.60 },
  { id: 'habit-medit',  label: 'Meditate',      notes: '5-10 min in the morning', completion: 0.75 },
  { id: 'habit-walk',   label: 'Walk after dinner', notes: null,               completion: 0.50 },
];
for (const h of habits) {
  insTodoItem.run(h.id, h.label, h.notes, windowStart.getTime() - 30 * 86400000);
}

const trackers = [
  { id: 'trk-caf',  key: 'caf',   label: 'Caffeine mg', type: 'sum',          color: '#FF9500' },
  { id: 'trk-mood', key: 'fog',   label: 'Brain Fog',   type: 'traffic_light', color: '#FFCC00' },
  { id: 'trk-vegan', key: 'vegan', label: 'Vegan day',   type: 'toggle',       color: '#00CC55' },
];
for (const t of trackers) {
  insTracker.run(t.id, t.key, t.label, t.type === 'sum' ? 1 : 0, t.type, t.color, windowStart.getTime() - 60 * 86400000, 'general', null);
}

// -- Per-day generation
db.transaction(() => {
  // Vegan-toggle ON for the first week of the window, then OFF mid-window via a "t vegan -" note
  const veganOffDate = new Date(windowStart);
  veganOffDate.setDate(veganOffDate.getDate() + 7);
  insNote.run(id('note', windowStart.getTime() + 10 * 3600000), windowStart.getTime() + 10 * 3600000, 't vegan starting fresh', 0, 0, 0, null);
  insNote.run(id('note', veganOffDate.getTime() + 13 * 3600000), veganOffDate.getTime() + 13 * 3600000, 't vegan - had ice cream at lunch', 0, 0, 0, null);

  for (let i = 0; i < DAYS; i++) {
    const day = new Date(windowStart);
    day.setDate(day.getDate() + i);
    const isFuture = day.getTime() > today.getTime();
    if (isFuture) continue; // leave future days blank (matches user behavior)
    const dow = day.getDay(); // 0=Sun
    const isWeekend = dow === 0 || dow === 6;
    const dk = dateKey(day);

    // -- Sleep activity: 11pm previous day through 7am today (8 h)
    const sleepStart = at(day, 0, 0) - 1 * 3600000; // 11pm prev day
    insActivity.run(id('act-sleep', sleepStart), sleepStart, 'sleep', 8);

    // -- Morning routine 7-8am
    insActivity.run(id('act-mr', at(day, 7)), at(day, 7), 'morning routine', 1);

    // -- Tue / Thu exercise 6-7am
    if (!isWeekend && (dow === 2 || dow === 4)) {
      insActivity.run(id('act-exercise', at(day, 6)), at(day, 6), 'exercise', 1);
    }

    if (!isWeekend) {
      // Weekday: transit, work, transit, leisure, dinner-then-leisure
      insActivity.run(id('act-transit', at(day, 8, 30)), at(day, 8, 30), 'transit', 0.5);
      insActivity.run(id('act-work', at(day, 9)), at(day, 9), 'work', 8);
      insActivity.run(id('act-transit', at(day, 17)), at(day, 17), 'transit', 0.5);
      insActivity.run(id('act-leisure', at(day, 17, 30)), at(day, 17, 30), 'leisure', 3.5);

      // Pomodoros during work day
      for (let p = 0; p < randInt(2, 5); p++) {
        const pomStart = at(day, 9 + p * 2, randInt(0, 30));
        const pomEnd = pomStart + 25 * 60000;
        insPomo.run(id('pomo', pomStart), pomStart, pomEnd, pick(['Deep work', 'Review', 'Writing', 'Planning']));
      }
    } else {
      // Weekend: leisure morning, socialize afternoon, leisure evening
      insActivity.run(id('act-leisure', at(day, 8)), at(day, 8), 'leisure', 5);
      insActivity.run(id('act-socialize', at(day, 13)), at(day, 13), 'socialize', 4);
      insActivity.run(id('act-leisure', at(day, 17)), at(day, 17), 'leisure', 6);
    }

    // -- Moods through the day (2-4 events). Drifts slightly anxious early week,
    //    happier on weekends.
    const moodPool = isWeekend
      ? (['happy','happy','happy','neutral'] as const)
      : (['happy','neutral','neutral','anxious','happy'] as const);
    const moodCount = randInt(2, 4);
    for (let m = 0; m < moodCount; m++) {
      const ts = at(day, 8 + Math.floor((m / moodCount) * 12), randInt(0, 59));
      insMood.run(id('mood', ts + m), ts, pick(moodPool));
    }

    // -- Energy entries (2-3 / day)
    const energyDay = randInt(3, 5);
    for (let e = 0; e < randInt(2, 3); e++) {
      const ts = at(day, 9 + e * 4, randInt(0, 30));
      const variance = randInt(-1, 1);
      const lvl = Math.max(1, Math.min(5, energyDay + variance));
      insEnergy.run(id('energy', ts + e), ts, lvl);
    }

    // -- Day entry
    const moodValues = isWeekend
      ? JSON.stringify([1, 1, 1, 3, 6])     // mostly happy
      : JSON.stringify([1, 3, 2, 3, 4]);    // mixed weekday
    const dayMood = isWeekend ? 'happy' : (chance(0.6) ? 'neutral' : 'happy');
    const sleepQ = randInt(3, 5);
    const sleepO = randInt(3, 5);
    const sleepW = randInt(3, 5);
    const sleepWakeUps = chance(0.6) ? 'None' : (chance(0.7) ? '1' : '2');
    const wellness = chance(0.85) ? randInt(4, 5) : randInt(2, 3);
    const onLevel = isWeekend ? randInt(4, 5) : randInt(3, 5);
    const steps = isWeekend ? randInt(6000, 12000) : randInt(4500, 9500);
    const hkCals = randInt(1800, 2400);
    const screen = isWeekend ? randInt(180, 360) : randInt(90, 240);

    insDay.run(
      dk, dayMood, moodValues, energyDay, onLevel, steps,
      wellness, sleepQ, sleepO, sleepW, sleepWakeUps,
      7 + (chance(0.3) ? 1 : 0), randInt(0, 59),
      hkCals, screen,
    );

    // -- Meal notes (lunch + dinner) so the calorie sum has something to fall back on
    insNote.run(id('note', at(day, 12, 30)), at(day, 12, 30), 'lunch salad and bread', 1, 0, 0, randInt(450, 700));
    insNote.run(id('note', at(day, 19)), at(day, 19), 'dinner pasta', 1, 0, 0, randInt(600, 900));

    // -- Weather
    const tempBase = 60 + Math.sin((i / DAYS) * Math.PI * 2) * 12;
    const temperature = Math.round(tempBase + randInt(-5, 5));
    const forecast = pick(['Sunny', 'Partly Cloudy', 'Mostly Sunny', 'Cloudy', 'Light Rain', 'Showers']);
    const humidity = randInt(40, 78);
    insWeather.run(
      dk, at(day, 12), temperature, 'F', chance(0.25) ? 0.4 : 0.05,
      forecast, `${forecast} throughout the day with light winds.`, 1, humidity,
    );

    // -- Habit completions
    for (const h of habits) {
      if (chance(h.completion)) {
        const ts = at(day, randInt(8, 22), randInt(0, 59));
        insTodoCompletion.run(id('todo-c', ts), h.id, dk, ts);
      }
    }

    // -- Tracker notes
    // Caffeine: 1-3 entries totaling ~80-300mg
    const caffeineDoses = randInt(1, 3);
    for (let c = 0; c < caffeineDoses; c++) {
      const ts = at(day, 8 + c * 4, randInt(0, 59));
      const amt = pick([60, 80, 100, 120, 150, 200]);
      insNote.run(id('note', ts + c), ts, `t caf ${amt}`, 0, 0, 0, null);
    }
    // Brain fog rating once midday
    if (chance(0.7)) {
      const ts = at(day, 14, randInt(0, 59));
      const level = chance(0.7) ? randInt(1, 3) : randInt(4, 5);
      insNote.run(id('note', ts), ts, `t fog ${level}`, 0, 0, 0, null);
    }
  }
})();

// -- App settings snapshot (mirrors what the iPhone export writes)
const settings: Record<string, string> = {
  exportedAt: String(Date.now()),
  exportVersion: '1',
  theme: 'dark',
  showMoonPhases: 'true',
  showCycles: 'false',
  showWeather: 'true',
  showRestingHeartRate: 'false',
  showAvgBodyWeight: 'false',
  showHRV: 'false',
  showSleepDuration: 'true',
  showDeepSleep: 'false',
  showRemSleep: 'false',
  showTrackersView: 'true',
  showHabitsView: 'true',
  weekViewVisibleRows: JSON.stringify({
    Mood: true, Energy: true, Wellness: true, On: true, Steps: true,
    'Resting HR': false, 'Avg Weight': false, HRV: false,
    'Screen Time': true,
    'HK Sleep': false, 'HK Deep': false, 'HK REM': false,
    Weather: true, Temp: true, Humidity: true,
    Pressure: false, Barom: false, Pollen: false, 'Air Quality': false, UV: false,
    Calories: true, Cycles: false,
    'Sleep Quality': true, 'Sleep Onset': false, 'Sleep Wake Feel': false,
    'Sleep Wake-ups': false, 'Sleep Duration': true,
    Pomodoro: true, Sleep: false,
    Work: true, School: false, Exercise: true, Leisure: true,
    Socialize: true, Transit: true, Other: false,
  }),
  weekViewIconMode: 'false',
  customTrackingVisibility: '{}',
  latitude: '40.7128',
  longitude: '-74.0060',
  zip: '10001',
};
for (const [k, v] of Object.entries(settings)) insSetting.run(k, v);

db.close();

const fmt = new Intl.NumberFormat();
const { default: { statSync } } = await import('node:fs');
const size = statSync(OUT_PATH).size;
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${fmt.format(DAYS)} days`);
console.log(`  ${fmt.format(size)} bytes`);
console.log(`  window: ${dateKey(windowStart)} → ${dateKey(windowEnd)}`);
