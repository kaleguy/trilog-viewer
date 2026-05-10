import './LifeCalendar.css';

const COLS = 100; // years
const ROWS = 52;  // weeks per year (close enough for 100 years)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface Props {
  birthdate: string;          // 'YYYY-MM-DD' or '' if unset
  focusHorizonYears: number | null;
  onOpenSettings: () => void;
}

export function LifeCalendar({ birthdate, focusHorizonYears, onOpenSettings }: Props) {
  if (!birthdate) {
    return (
      <div className="life-empty">
        <h2>Life Calendar</h2>
        <p>
          Each square is one week of your life. The grid spans 100 years
          (5,200 weeks total): each column is a year, each row is a week
          within the year. Lived weeks are filled in.
        </p>
        <p>
          Set your birthdate in <strong>Settings</strong> to start.
        </p>
        <button type="button" className="life-edit-btn" onClick={onOpenSettings}>
          Open Settings
        </button>
        <p className="life-privacy">
          Stored locally in this app's storage; never written to the bundle
          or shared anywhere.
        </p>
      </div>
    );
  }

  // Parse birthdate as local-midnight so timezone math doesn't slip a day.
  const [y, m, d] = birthdate.split('-').map(Number);
  const birth = new Date(y, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  const weeksLived = Math.max(
    0,
    Math.floor((now.getTime() - birth.getTime()) / WEEK_MS)
  );
  const totalCells = COLS * ROWS;
  const yearsLived = Math.floor(weeksLived / ROWS);

  // Horizon: cells whose column index is >= horizon are dimmed. null
  // means no horizon set, so nothing dims.
  const horizon = focusHorizonYears != null && focusHorizonYears > 0
    ? Math.floor(focusHorizonYears)
    : null;

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = col * ROWS + row;
      let className = 'life-cell';
      if (i < weeksLived) className += ' lived';
      else if (i === weeksLived) className += ' current';
      if (horizon != null && col >= horizon) className += ' beyond-horizon';
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
            {horizon != null && (
              <>
                {' '}· focus through age {horizon}
              </>
            )}
          </p>
        </div>
        <button type="button" className="life-edit-btn" onClick={onOpenSettings}>
          Edit
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
