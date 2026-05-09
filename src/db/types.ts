export type MoodType = 'happy' | 'neutral' | 'sad' | 'anxious' | 'upset';

export interface MoodEntry {
  id: string;
  timestamp: number;
  type: MoodType;
  notes: string | null;
  endTimestamp: number | null;
}

export interface EnergyEntry {
  id: string;
  timestamp: number;
  level: 1 | 2 | 3 | 4 | 5;
  notes: string | null;
  endTimestamp: number | null;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: string;
  duration: number; // minutes
  notes: string | null;
  endTimestamp: number | null;
  fillGaps: boolean; // extend forward to next activity start
  isGapFiller: boolean; // synthetic entry created to fill a gap
}

export interface NoteEntry {
  id: string;
  timestamp: number;
  text: string;
  isMeal: boolean;
  isHealth: boolean;
  isCycle: boolean;
  cycleColor: string | null;
  calories: number | null;
}

export interface HistoricalWeather {
  dateKey: string;
  timestamp: number;
  temperature: number | null;
  temperatureUnit: string | null; // 'F' or 'C'
  precipProb: number | null;
  shortForecast: string;
  isDaytime: boolean;
}

// Cycle color names → muted hex values, copied from the iOS chart's
// `getCycleColorStyle`. Keep in sync if the iPhone palette changes.
export const CYCLE_COLOR_MAP: Record<string, string> = {
  red: '#D95550',
  orange: '#E0944A',
  yellow: '#D9BF4A',
  green: '#4AAE6A',
  lightgreen: '#7DC98A',
  blue: '#4A90C2',
  lightblue: '#7AB8D4',
  purple: '#9A6EB8',
  pink: '#D96088',
  brown: '#A08060',
  gray: '#8A8A90',
  black: '#2A2A2A',
};

export function cycleColor(name?: string | null): string {
  if (!name) return '#4A90C2';
  return CYCLE_COLOR_MAP[name.toLowerCase()] ?? name;
}

export const MOOD_COLORS: Record<MoodType, string> = {
  anxious: '#FF9500',
  sad: '#2E6BC7',
  neutral: '#767676',
  happy: '#00CC55',
  upset: '#FF0000',
};

export const ENERGY_COLORS: Record<number, string> = {
  1: '#3D0000',
  2: '#990000',
  3: '#E04400',
  4: '#FFAA00',
  5: '#FFFF44',
};

export const ACTIVITY_COLORS: Record<string, string> = {
  sleep: '#4A4A4A',
  work: '#2E6BC7',
  school: '#CC3333',
  exercise: '#FF8800',
  leisure: '#9932CC',
  socialize: '#00CC55',
  transit: '#5BA3FF',
  other: '#767676',
  recovery: '#CD5C5C',
  'morning routine': '#40E0D0',
};

export function activityColor(type: string): string {
  return ACTIVITY_COLORS[type.toLowerCase()] ?? ACTIVITY_COLORS.other;
}
