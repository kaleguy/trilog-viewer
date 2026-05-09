import { useState } from 'react';
import './LifeCalendar.css';

const STORAGE_KEY = 'trilog.viewer.birthdate';
const COLS = 100; // years
const ROWS = 52;  // weeks per year (close enough for 100 years)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function LifeCalendar() {
  const [birthdate, setBirthdate] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  // Three separate fields beat <input type="date"> for typing a far-away
  // year on Webkit (Tauri's webview) — the date picker forces a scroll
  // widget for years. Stored as raw strings so the user can type/clear
  // freely; we validate on submit.
  const [yearStr, setYearStr] = useState('');
  const [monthStr, setMonthStr] = useState('');
  const [dayStr, setDayStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const y = Number(yearStr);
    const m = Number(monthStr);
    const d = Number(dayStr);
    const today = new Date();
    if (
      !Number.isInteger(y) || y < 1900 || y > today.getFullYear() ||
      !Number.isInteger(m) || m < 1 || m > 12 ||
      !Number.isInteger(d) || d < 1 || d > 31
    ) {
      setError('Enter a valid year (1900+), month (1-12), and day (1-31).');
      return;
    }
    // Sanity-check the resulting Date isn't in the future and didn't roll
    // over (e.g. Feb 30 → Mar 2).
    const candidate = new Date(y, m - 1, d);
    if (
      candidate.getFullYear() !== y ||
      candidate.getMonth() !== m - 1 ||
      candidate.getDate() !== d
    ) {
      setError('That date doesn’t exist (e.g. Feb 30).');
      return;
    }
    if (candidate.getTime() > today.getTime()) {
      setError('Birthdate can’t be in the future.');
      return;
    }
    const value = `${y}-${pad2(m)}-${pad2(d)}`;
    localStorage.setItem(STORAGE_KEY, value);
    setBirthdate(value);
  };

  const handleEdit = () => {
    if (birthdate) {
      const [y, m, d] = birthdate.split('-');
      setYearStr(y);
      setMonthStr(String(Number(m)));
      setDayStr(String(Number(d)));
    }
    setBirthdate(null);
  };

  if (!birthdate) {
    return (
      <div className="life-empty">
        <h2>Life Calendar</h2>
        <p>
          Each square is one week of your life. The grid spans 100 years
          (5,200 weeks total): each column is a year, each row is a week
          within the year. Lived weeks are filled in.
        </p>
        <form className="life-form" onSubmit={handleSave}>
          <span className="life-label">Your birthdate</span>
          <input
            type="number"
            placeholder="YYYY"
            value={yearStr}
            onChange={(e) => setYearStr(e.target.value)}
            min={1900}
            max={new Date().getFullYear()}
            className="life-year"
            autoFocus
          />
          <span className="life-sep">/</span>
          <input
            type="number"
            placeholder="MM"
            value={monthStr}
            onChange={(e) => setMonthStr(e.target.value)}
            min={1}
            max={12}
            className="life-md"
          />
          <span className="life-sep">/</span>
          <input
            type="number"
            placeholder="DD"
            value={dayStr}
            onChange={(e) => setDayStr(e.target.value)}
            min={1}
            max={31}
            className="life-md"
          />
          <button type="submit">Save</button>
        </form>
        {error && <p className="life-error">{error}</p>}
        <p className="life-privacy">
          Stored locally in this app's storage; never written to the bundle
          or shared anywhere.
        </p>
      </div>
    );
  }

  // Birthdate is YYYY-MM-DD (date input format). Parse as local-midnight
  // so the math doesn't slip a day across timezones.
  const [y, m, d] = birthdate.split('-').map(Number);
  const birth = new Date(y, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  const weeksLived = Math.max(
    0,
    Math.floor((now.getTime() - birth.getTime()) / WEEK_MS)
  );
  const totalCells = COLS * ROWS;
  const yearsLived = Math.floor(weeksLived / ROWS);

  // Cells are rendered row-by-row so the grid's default placement order
  // (left-to-right, top-to-bottom) matches the (col, row) interpretation
  // and each row of the DOM corresponds to one chart row.
  const cells: React.ReactNode[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = col * ROWS + row;
      let className = 'life-cell';
      if (i < weeksLived) className += ' lived';
      else if (i === weeksLived) className += ' current';
      cells.push(
        <div
          key={`${col}-${row}`}
          className={className}
          title={`Age ${col}, week ${row + 1}`}
        />
      );
    }
  }

  // Axis labels: every 10 years across the top, every 10 weeks down the
  // left. Empty placeholders fill the rest so the grid columns/rows stay
  // aligned with the cell grid.
  const yearLabels = Array.from({ length: COLS }, (_, c) => (
    <div key={`y-${c}`} className="life-year-label">
      {c % 10 === 0 ? c : ''}
    </div>
  ));
  const weekLabels = Array.from({ length: ROWS }, (_, r) => (
    <div key={`w-${r}`} className="life-week-label">
      {(r + 1) % 10 === 0 ? `W${r + 1}` : ''}
    </div>
  ));

  return (
    <div className="life-calendar">
      <header className="life-header">
        <div>
          <h2>Life Calendar</h2>
          <p className="life-stats">
            Born {birth.toLocaleDateString(undefined, {
              year: 'numeric', month: 'long', day: 'numeric',
            })} · {weeksLived.toLocaleString()} weeks · {yearsLived} years ·
            {' '}{(totalCells - weeksLived).toLocaleString()} weeks remain
          </p>
        </div>
        <button type="button" className="life-edit-btn" onClick={handleEdit}>
          Edit birthdate
        </button>
      </header>

      <div className="life-axis-top">
        <div className="life-corner" />
        <div className="life-year-row">{yearLabels}</div>
      </div>
      <div className="life-body">
        <div className="life-week-col">{weekLabels}</div>
        <div className="life-grid">{cells}</div>
      </div>
    </div>
  );
}
