# TriLog Viewer

Native Mac viewer for TriLog data exports. Open a `journal.db` bundle
exported from the iPhone app and browse mood, energy, activity, notes,
weather, cycles, moon phases, daily metrics, habits, and custom
trackers — laid out for a desktop screen. Built with Tauri 2 + React +
Vite.

The viewer is read-only. It never writes to the bundle, never phones
home, and stores nothing besides a few preferences in localStorage
(birthdate, focus horizon, appearance toggles).

## Prerequisites

You need three things on your Mac:

- **Rust** (the Tauri shell compiles to native code)

  ```
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  ```

- **Bun** (the JS toolchain — replace with npm/pnpm if you'd rather)

  ```
  curl -fsSL https://bun.sh/install | bash
  ```

- **Xcode command-line tools**

  ```
  xcode-select --install
  ```

## Run from source (dev)

```
git clone <this repo>
cd trilog-viewer
bun install
bun run tauri dev
```

The first `cargo` build pulls and compiles a few hundred crates — give
it a few minutes. Subsequent runs are incremental and fast.

## Build a release `.app`

```
bun run tauri build
```

Output lands in `src-tauri/target/release/bundle/macos/`. The `.app`
runs without a Gatekeeper warning on the machine that built it (signed
with the local ad-hoc cert). For distribution to others without a
warning you'd need to sign + notarize with an Apple Developer ID; not
configured here.

For a universal binary that runs on both Apple Silicon and Intel:

```
bun run tauri build --target universal-apple-darwin
```

## Get a bundle to open

In the iPhone app: **Settings → expand "Backup" → "Export Bundle (.zip)"**.
AirDrop the zip to your Mac, unzip, and the viewer's "Open Database…"
button can point at the resulting `journal.db`.

## Tabs

- **Mood Chart** — the iOS punch-card chart, redrawn for the wider
  screen. 30-day window in "All" mode (mood / energy / activity all
  shown), 90-day window in single-metric mode. Optional cycle strip,
  weather strip, and moon-phase row toggleable from Settings. Hours
  axis with 12 AM / 12 PM labels and 3 AM / noon / 6 PM reference
  lines. Hover any element for time + type + notes.
- **Metrics** — full per-day metrics grid. 6-week Sun-anchored
  window, week-by-week navigation (Saturday-end so the weekday
  layout stays put across navigation). Day-head shows the day-of-week
  letter with month abbreviation replacing the letter on the 1st;
  navigator reads "Week N" (ISO). Rows mirror the iPhone WeekView
  top-to-bottom (Thrive first, Pomodoro last) with the same cell
  renderers: mood proportional-segment bar, Thrive signal-bars,
  Wellness tinted Lucide icon, traffic-light squares, activity hours
  colored by type, weather icon, etc. Row visibility and icon mode
  seed from the iPhone bundle's `app_settings`. Customize button
  lets you toggle any row locally for the session.
- **Habits** — 42-column row-stacked grid (no left label column;
  labels go above each row). Green check for completed days, faint
  bordered square for past uncompleted, blank for future.
- **Trackers** — same row-stacked layout. Per-type cell rendering
  matches the iPhone: numeric chips for sum/count/average/itemized,
  traffic-light colored square, toggle green square, text blue
  (or red for "−" prefix).
- **Life Calendar** — optional, off by default. 100-year × 52-week
  grid filled in week by week. Set your birthdate and an optional
  "focus horizon" age in Settings; cells past the horizon dim so the
  active years stand out.

## Header menu

The hamburger in the top-right opens a small menu with two items:

- **Settings** — Mood Chart strip toggles, Appearance toggles, Life
  Calendar birthdate + focus horizon. Mood-chart toggles seed from
  the bundle's `app_settings` snapshot the iPhone app writes at
  export time; the rest are viewer-local and persist in
  localStorage.
- **About** — version + license.

## Project layout

```
src/                                React frontend
  App.tsx                           Shell: open DB + tab nav + header menu
  version.ts                        APP_VERSION (bump per release)
  views/
    MoodChart.tsx + css             Punch-card chart
    Metrics.tsx + css               Per-day metrics grid
    MetricsCustomize.tsx + css      Row visibility editor
    Habits.tsx + css                Habit grid (label + 42-col row)
    Trackers.tsx + css              Custom-tracker grid (per-type cells)
    customTrackingParser.ts         Tracker-note parser (mirrors iPhone)
    LifeCalendar.tsx + css          Life-week grid
    SettingsModal.tsx + css         Viewer settings
    AboutModal.tsx + css            Version / license
    ErrorBoundary.tsx               Wraps the active tab
    Placeholder.tsx                 Stub (unused now that all tabs ship)
    moonPhase.ts                    Lunar age + sprite math
    weatherIcon.tsx                 Forecast → Lucide icon
  db/
    types.ts                        Row types + palette constants
    queries.ts                      All SQL helpers
public/
  moon_sprite.svg                   Lunar phase sprite sheet (from iOS)
src-tauri/                          Rust shell, plugin config, build settings
  src/lib.rs                        Plugin registration
  capabilities/default.json         What the frontend is allowed to do
  tauri.conf.json                   Window + bundle config
```

## What the bundle carries

The iPhone app writes an `app_settings` snapshot table into the
exported DB so the viewer can mirror the iPhone's state on open:

- Per-row WeekView visibility (`weekViewVisibleRows` JSON)
- Icon mode (`weekViewIconMode`)
- Mood-chart appearance toggles (cycles / weather / moon phases)
- Lat / lon / zip for context

The bundle also carries derived columns the viewer reads directly:

- `day_entries.hkDietaryCalories` — HealthKit dietary energy when
  the user has it enabled on iPhone.
- `day_entries.screenTimeMinutes` — Daily Screen Time total
  (DeviceActivity report extension writes through App Group; main
  app mirrors to the DB).
- `historical_weather.humidityPercent` — Pro/Google currentConditions
  humidity, captured alongside pressure.

Older bundles missing any of these columns fall back gracefully.

## Not yet implemented

- Click an entry → side panel with notes / details.
- Real sunrise / sunset times (currently uses 6 AM-6 PM fallback
  regardless of date or location).
- Photo lookup from the `images/` folder alongside `journal.db`.
- Cross-tracker correlations, environmental analysis, stretch-
  comparison adaptation analysis.

## License

MIT. See the About dialog for the user-facing notice.
