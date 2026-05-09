/**
 * Lunar age + sprite-sheet positioning.
 *
 * Lunar age math is ported from `constants/moon-phases.ts` in the iOS app.
 *
 * The sprite sheet is the iOS `moon_sprite_dark.svg` asset (copied into
 * `public/moon_sprite.svg`), a 544×576 grid of 6 cols × 5 rows = 30
 * phases. Each sprite is a 72px-radius circle drawn around a center
 * point; the cells are spaced 88px (col) and 112px (row) apart so per-
 * cell labels can sit underneath. We crop a 72×72 box around each
 * sprite's center.
 */

const SYNODIC_MONTH = 29.53;
const SHEET_W = 544;
const SHEET_H = 576;
const SPRITE_NATURAL = 72; // diameter of one cropped sprite cell
const COL_STEP = 88;
const ROW_STEP = 112;
const FIRST_TOPLEFT_X = 16; // top-left of the (0,0) sprite cell
const FIRST_TOPLEFT_Y = 56;
const COLS = 6;

function calculateLunarAge(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  let c = 0;
  let jd = 0;

  if (month < 3) {
    const yearAdjusted = year - 1;
    const monthAdjusted = month + 12;
    c = Math.floor(yearAdjusted / 100);
    jd =
      Math.floor(365.25 * yearAdjusted) +
      Math.floor(30.6001 * (monthAdjusted + 1)) +
      day +
      1720994.5;
  } else {
    c = Math.floor(year / 100);
    jd =
      Math.floor(365.25 * year) +
      Math.floor(30.6001 * (month + 1)) +
      day +
      1720994.5;
  }

  if (jd > 2299160) {
    const b = 2 - c + Math.floor(c / 4);
    jd = jd + b;
  }

  const daysSinceNew = jd - 2451549.5;
  const newMoons = daysSinceNew / SYNODIC_MONTH;
  const phase = (newMoons - Math.floor(newMoons)) * SYNODIC_MONTH;
  return phase;
}

export function getMoonPhaseSpriteIndex(date: Date): number {
  const phase = calculateLunarAge(date);
  const index = Math.floor(phase);
  return Math.max(0, Math.min(29, index));
}

export function moonSpriteStyle(date: Date, size: number): React.CSSProperties {
  const index = getMoonPhaseSpriteIndex(date);
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  // Scale the entire sheet so one natural-size sprite cell maps to the
  // requested display size, then offset to the top-left of the target
  // sprite cell (in scaled pixels).
  const scale = size / SPRITE_NATURAL;
  const sheetW = SHEET_W * scale;
  const sheetH = SHEET_H * scale;
  const tlx = FIRST_TOPLEFT_X + col * COL_STEP;
  const tly = FIRST_TOPLEFT_Y + row * ROW_STEP;
  return {
    width: size,
    height: size,
    backgroundImage: "url('/moon_sprite.svg')",
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${sheetW}px ${sheetH}px`,
    backgroundPosition: `${-tlx * scale}px ${-tly * scale}px`,
  };
}
