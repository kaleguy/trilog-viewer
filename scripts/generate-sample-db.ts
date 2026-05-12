/**
 * Generate samples/sample-journal.db — a self-contained SQLite file
 * the viewer can open. One year (52 weeks) of synthesized but
 * realistic data with seasonal variation in environmental fields:
 *
 *   • Activities — sleep 11pm–7am, work 9–5 weekdays, weekend leisure
 *   • Mood, energy, wellness — light winter dip baked in
 *   • Sleep duration + quality, HK sleep stages
 *   • Pomodoros on weekdays
 *   • Daily weather: temperature, humidity, short forecast (seasonal)
 *   • Pressure JSON with rising/falling trend
 *   • Pollen JSON — spring + fall peaks
 *   • Air Quality JSON — 30–90 most days with occasional spikes
 *   • UV index JSON — peaks in summer
 *   • Body weight — slow drift across the year
 *   • Resting HR + HRV — daily noise
 *   • Habits (4) and trackers (3, including a toggle)
 *
 * Usage:
 *   bun run scripts/generate-sample-db.ts
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_PATH = resolve(__dirname, '../samples/sample-journal.db');
const DAYS = 52 * 7; // exactly 52 weeks for clean Sun-anchored alignment

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
function clamp(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)); }

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
function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
}
/** 0 = mid-winter (late Dec), 1 = mid-summer (late Jun). Northern
 *  hemisphere — temperature, humidity, UV all peak near day 172. */
function seasonFactor(date: Date): number {
  return 0.5 + 0.5 * Math.sin(((dayOfYear(date) - 80) * 2 * Math.PI) / 365);
}

// -- Anchor: rightmost = upcoming Saturday, then 363 days back.
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
  humidityPercent INTEGER,
  humidityForecastPercent INTEGER
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
  hkDietaryCalories, screenTimeMinutes,
  pressureData, pollenData, airQualityData, uvData,
  avgBodyWeight, restingHeartRate, hrv,
  hkSleepDuration, hkDeepSleep, hkRemSleep
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insWeather = db.prepare(`INSERT INTO historical_weather (
  dateKey, timestamp, temperature, temperatureUnit, precipProb, shortForecast, detailedForecast, isDaytime, humidityPercent, humidityForecastPercent
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insTracker = db.prepare(`INSERT INTO custom_tracking_items (id, key, label, isNumeric, type, color, createdAt, category, listItems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insTodoItem = db.prepare(`INSERT INTO day_todo_items (id, label, notes, createdAt) VALUES (?, ?, ?, ?)`);
const insTodoCompletion = db.prepare(`INSERT INTO day_todo_completions (id, todoItemId, dateKey, timestamp) VALUES (?, ?, ?, ?)`);
const insSetting = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`);

// -- Habits + trackers
const habits = [
  { id: 'habit-water', label: 'Drink water', notes: 'aim for 8 glasses', completion: 0.85 },
  { id: 'habit-read', label: 'Read 20 minutes', notes: null, completion: 0.60 },
  { id: 'habit-medit', label: 'Meditate', notes: '5-10 min in the morning', completion: 0.75 },
  { id: 'habit-walk', label: 'Walk after dinner', notes: null, completion: 0.50 },
];
for (const h of habits) {
  insTodoItem.run(h.id, h.label, h.notes, windowStart.getTime() - 30 * 86400000);
}

const trackers = [
  { id: 'trk-caf', key: 'caf', label: 'Caffeine mg', type: 'sum', color: '#FF9500' },
  { id: 'trk-fog', key: 'fog', label: 'Brain Fog', type: 'traffic_light', color: '#FFCC00' },
  { id: 'trk-vegan', key: 'vegan', label: 'Vegan day', type: 'toggle', color: '#00CC55' },
];
for (const t of trackers) {
  insTracker.run(t.id, t.key, t.label, t.type === 'sum' ? 1 : 0, t.type, t.color, windowStart.getTime() - 60 * 86400000, 'general', null);
}

// -- AQI color picker (rough EPA bucket colors)
function aqiColor(aqi: number): string {
  if (aqi <= 50) return '#00E400';      // good
  if (aqi <= 100) return '#FFFF00';     // moderate
  if (aqi <= 150) return '#FF7E00';     // unhealthy for sensitive
  if (aqi <= 200) return '#FF0000';     // unhealthy
  return '#8F3F97';                      // very unhealthy
}
function uvColor(uv: number): string {
  if (uv <= 2) return '#3EA72D';        // low green
  if (uv <= 5) return '#FFF300';        // moderate yellow
  if (uv <= 7) return '#F18B00';        // high orange
  if (uv <= 10) return '#E53210';       // very high red
  return '#B567A4';                      // extreme purple
}

// -- Per-day generation
db.transaction(() => {
  // Body weight slowly drifts from 170 down to 162 over the year.
  // Each day stays within ±1 lb of the prior day's "true" value.
  let weightTrue = 170;
  const targetWeight = 162;

  // Pressure walks a random-walk around 1015 hPa with ±2 hPa daily.
  // Trend computed by comparing 24h delta.
  let pressurePrev = 1015;

  // Toggle entries that demonstrate the on/off pattern. Multiple
  // vegan stretches across the year.
  const veganEvents: { day: number; on: boolean; comment: string }[] = [
    { day: 5, on: true, comment: 'committing to vegan this month' },
    { day: 32, on: false, comment: 'broke for birthday cake' },
    { day: 90, on: true, comment: 'back on it' },
    { day: 110, on: false, comment: 'travel week, off the wagon' },
    { day: 200, on: true, comment: 'fall reset' },
    { day: 240, on: false, comment: 'pizza night' },
  ];

  for (let i = 0; i < DAYS; i++) {
    const day = new Date(windowStart);
    day.setDate(day.getDate() + i);
    const isFuture = day.getTime() > today.getTime();
    if (isFuture) continue;
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dk = dateKey(day);
    const season = seasonFactor(day); // 0 winter → 1 summer
    const month = day.getMonth();     // 0=Jan ... 11=Dec

    // -- Activities (sleep, work, weekend leisure, exercise Tue/Thu)
    const sleepStart = at(day, 0, 0) - 1 * 3600000;
    insActivity.run(id('act-sleep', sleepStart), sleepStart, 'sleep', 8);
    insActivity.run(id('act-mr', at(day, 7)), at(day, 7), 'morning routine', 1);

    if (!isWeekend && (dow === 2 || dow === 4)) {
      insActivity.run(id('act-exercise', at(day, 6)), at(day, 6), 'exercise', 1);
    }
    if (!isWeekend) {
      insActivity.run(id('act-transit', at(day, 8, 30)), at(day, 8, 30), 'transit', 0.5);
      insActivity.run(id('act-work', at(day, 9)), at(day, 9), 'work', 8);
      insActivity.run(id('act-transit', at(day, 17)), at(day, 17), 'transit', 0.5);
      insActivity.run(id('act-leisure', at(day, 17, 30)), at(day, 17, 30), 'leisure', 3.5);
      for (let p = 0; p < randInt(2, 5); p++) {
        const pomStart = at(day, 9 + p * 2, randInt(0, 30));
        const pomEnd = pomStart + 25 * 60000;
        insPomo.run(id('pomo', pomStart), pomStart, pomEnd, pick(['Deep work', 'Review', 'Writing', 'Planning']));
      }
    } else {
      insActivity.run(id('act-leisure', at(day, 8)), at(day, 8), 'leisure', 5);
      insActivity.run(id('act-socialize', at(day, 13)), at(day, 13), 'socialize', 4);
      insActivity.run(id('act-leisure', at(day, 17)), at(day, 17), 'leisure', 6);
    }

    // -- Mood / energy / wellness — base value modulated by season
    // (mild winter dip) and weekend boost.
    const winterDip = (1 - season) * 0.6; // 0..0.6 worse in winter
    const weekendBoost = isWeekend ? 0.5 : 0;
    const moodBase = 3.6 + weekendBoost - winterDip;
    const energyBase = 3.5 + weekendBoost - winterDip * 0.5;

    const moodPool = isWeekend
      ? (['happy', 'happy', 'happy', 'neutral'] as const)
      : (['happy', 'neutral', 'neutral', 'anxious', 'happy'] as const);
    const moodCount = randInt(2, 4);
    for (let m = 0; m < moodCount; m++) {
      const ts = at(day, 8 + Math.floor((m / moodCount) * 12), randInt(0, 59));
      insMood.run(id('mood', ts + m), ts, pick(moodPool));
    }

    const energyDay = clamp(Math.round(energyBase + (rand() - 0.5) * 1.5), 1, 5);
    for (let e = 0; e < randInt(2, 3); e++) {
      const ts = at(day, 9 + e * 4, randInt(0, 30));
      const lvl = clamp(energyDay + randInt(-1, 1), 1, 5);
      insEnergy.run(id('energy', ts + e), ts, lvl);
    }

    // -- moodValues 5-tuple: warmer in summer + weekends, cooler in winter
    const happyShare = clamp(Math.round(4 + weekendBoost * 2 - winterDip * 2), 1, 8);
    const neutralShare = clamp(Math.round(3 + winterDip * 1), 1, 6);
    const sadShare = clamp(Math.round(1 + winterDip * 2), 0, 4);
    const anxiousShare = clamp(Math.round(1 + winterDip * 1.5), 0, 4);
    const upsetShare = clamp(Math.round(winterDip * 0.8), 0, 2);
    const moodValues = JSON.stringify([upsetShare, anxiousShare, sadShare, neutralShare, happyShare]);
    const dayMood = happyShare > Math.max(neutralShare, sadShare, anxiousShare, upsetShare) ? 'happy' : 'neutral';

    // -- Sleep
    const sleepQ = clamp(Math.round(moodBase + randInt(-1, 1)), 1, 5);
    const sleepO = clamp(sleepQ + randInt(-1, 1), 1, 5);
    const sleepW = clamp(sleepQ + randInt(-1, 1), 1, 5);
    const sleepWakeUps = chance(0.65) ? 'None' : (chance(0.7) ? '1' : '2');
    const sleepHours = clamp(7 + (chance(0.4) ? 1 : 0) + (chance(0.2) ? -1 : 0), 5, 9);
    const sleepMins = randInt(0, 59);
    const hkSleepMin = sleepHours * 60 + sleepMins + randInt(-15, 10);
    const hkDeepMin = Math.round(hkSleepMin * (0.18 + (rand() - 0.5) * 0.06));
    const hkRemMin = Math.round(hkSleepMin * (0.22 + (rand() - 0.5) * 0.06));

    // -- Wellness (1-5)
    const wellness = clamp(Math.round(4 - winterDip + (rand() - 0.5)), 1, 5);

    // -- Steps + calories + screen time
    const onLevel = clamp(Math.round(energyBase + (isWeekend ? 0.5 : 0) + (rand() - 0.5)), 1, 5);
    const steps = isWeekend ? randInt(6000, 12000) : randInt(4500, 9500);
    const hkCals = randInt(1800, 2400);
    const screen = isWeekend ? randInt(180, 360) : randInt(90, 240);

    // -- Body weight (slow drift toward target with daily noise)
    weightTrue += (targetWeight - weightTrue) * 0.003 + (rand() - 0.5) * 0.2;
    const weightShown = Math.round(weightTrue * 10) / 10;

    // -- Resting HR + HRV — slight inverse correlation
    const rhrBase = 60 - (energyDay - 3) * 1.2;
    const restingHeartRate = clamp(Math.round(rhrBase + randInt(-4, 4)), 48, 78);
    const hrvBase = 45 + (energyDay - 3) * 5;
    const hrv = clamp(Math.round(hrvBase + randInt(-8, 8)), 25, 80);

    // -- Pressure with trend
    const pressureNow = pressurePrev + (rand() - 0.5) * 4;
    const trend = pressureNow - pressurePrev > 1.5
      ? 'rising' : pressureNow - pressurePrev < -1.5
        ? 'falling' : 'steady';
    pressurePrev = pressureNow;
    const pressureData = JSON.stringify({
      pressure_mean_hPa: Math.round(pressureNow * 10) / 10,
      pressure_trend: trend,
    });

    // -- Pollen: spring (Mar-May) peaks high, fall (Sep-Oct) moderate, else low
    let pollenLevel: number;
    if (month >= 2 && month <= 4) pollenLevel = clamp(3 + randInt(-1, 2), 1, 5);
    else if (month === 8 || month === 9) pollenLevel = clamp(2 + randInt(-1, 1), 0, 4);
    else pollenLevel = randInt(0, 1);
    const pollenData = JSON.stringify({ overall: pollenLevel });

    // -- Air Quality: 30-80 most days, occasional spike
    const aqi = chance(0.05)
      ? randInt(110, 180)
      : clamp(Math.round(45 + season * 25 + (rand() - 0.5) * 30), 15, 95);
    const airQualityData = JSON.stringify({ aqi, aqiColor: aqiColor(aqi) });

    // -- UV: peaks summer, dips winter
    const uvIndex = clamp(Math.round(1 + season * 9 + (rand() - 0.5) * 2), 0, 11);
    const uvData = JSON.stringify({ uvIndex, uvColor: uvColor(uvIndex) });

    insDay.run(
      dk, dayMood, moodValues, energyDay, onLevel, steps,
      wellness, sleepQ, sleepO, sleepW, sleepWakeUps,
      sleepHours, sleepMins,
      hkCals, screen,
      pressureData, pollenData, airQualityData, uvData,
      weightShown, restingHeartRate, hrv,
      hkSleepMin, hkDeepMin, hkRemMin,
    );

    // -- Meal notes
    insNote.run(id('note', at(day, 12, 30)), at(day, 12, 30), 'lunch salad and bread', 1, 0, 0, randInt(450, 700));
    insNote.run(id('note', at(day, 19)), at(day, 19), 'dinner pasta', 1, 0, 0, randInt(600, 900));

    // -- Weather (seasonal temp + humidity)
    const tempBase = 32 + season * 50; // 32-82°F seasonal swing
    const temperature = Math.round(tempBase + (rand() - 0.5) * 12);
    const humidityBase = 45 + season * 25; // 45-70% seasonal
    const humidity = clamp(Math.round(humidityBase + (rand() - 0.5) * 20), 25, 95);
    const humidityForecast = clamp(humidity + randInt(-5, 8), 25, 100);
    // Forecast picks differ by season — winter has fewer rain showers
    const winterForecasts = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Cold', 'Snow Likely', 'Light Snow'];
    const summerForecasts = ['Sunny', 'Partly Cloudy', 'Mostly Sunny', 'Hot', 'Showers', 'Thunderstorms', 'Humid'];
    const shoulderForecasts = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Showers', 'Breezy'];
    const forecastPool = season < 0.25 ? winterForecasts : season > 0.75 ? summerForecasts : shoulderForecasts;
    const forecast = pick(forecastPool);
    insWeather.run(
      dk, at(day, 12), temperature, 'F',
      chance(0.25) ? 0.4 : 0.05,
      forecast,
      `${forecast} throughout the day with light winds.`,
      1, humidity, humidityForecast,
    );

    // -- Habit completions
    for (const h of habits) {
      if (chance(h.completion)) {
        const ts = at(day, randInt(8, 22), randInt(0, 59));
        insTodoCompletion.run(id('todo-c', ts), h.id, dk, ts);
      }
    }

    // -- Tracker notes
    const caffeineDoses = randInt(1, 3);
    for (let c = 0; c < caffeineDoses; c++) {
      const ts = at(day, 8 + c * 4, randInt(0, 59));
      const amt = pick([60, 80, 100, 120, 150, 200]);
      insNote.run(id('note', ts + c), ts, `t caf ${amt}`, 0, 0, 0, null);
    }
    if (chance(0.5)) {
      const ts = at(day, 14, randInt(0, 59));
      const fogLevel = chance(0.7) ? randInt(1, 3) : randInt(4, 5);
      insNote.run(id('note', ts), ts, `t fog ${fogLevel}`, 0, 0, 0, null);
    }

    // -- Vegan toggle events on specific days
    const veganEvent = veganEvents.find((v) => v.day === i);
    if (veganEvent) {
      const ts = at(day, 10, randInt(0, 30));
      const text = veganEvent.on ? `t vegan ${veganEvent.comment}` : `t vegan - ${veganEvent.comment}`;
      insNote.run(id('note', ts), ts, text, 0, 0, 0, null);
    }
  }
})();

// -- App settings snapshot. Enable all the new rows so the demo
// surfaces the env data (pollen, AQ, UV, pressure, etc.) the new
// generator now produces.
const settings: Record<string, string> = {
  exportedAt: String(Date.now()),
  exportVersion: '1',
  theme: 'dark',
  showMoonPhases: 'true',
  showCycles: 'false',
  showWeather: 'true',
  showRestingHeartRate: 'true',
  showAvgBodyWeight: 'true',
  showHRV: 'true',
  showSleepDuration: 'true',
  showDeepSleep: 'true',
  showRemSleep: 'true',
  showTrackersView: 'true',
  showHabitsView: 'true',
  weekViewVisibleRows: JSON.stringify({
    Mood: true, Energy: true, Wellness: true, On: true, Steps: true,
    'Resting HR': true, 'Avg Weight': true, HRV: true,
    'Screen Time': true,
    'HK Sleep': true, 'HK Deep': true, 'HK REM': true,
    Weather: true, Temp: true, Humidity: true,
    Pressure: true, Barom: true, Pollen: true, 'Air Quality': true, UV: true,
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
console.log(`  ${fmt.format(DAYS)} days (${DAYS / 7} weeks)`);
console.log(`  ${fmt.format(size)} bytes`);
console.log(`  window: ${dateKey(windowStart)} → ${dateKey(windowEnd)}`);
