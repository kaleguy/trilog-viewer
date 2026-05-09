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
