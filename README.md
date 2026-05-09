# TriLog Viewer

Native Mac viewer for TriLog data exports. Reads the `journal.db` SQLite
file produced by TriLog's "Export Database + Photos" bundle and lets you
browse the data offline with the same conventions as the iPhone app, but
laid out for a wider screen.

Built with Tauri 2 + React + Vite.

## Prerequisites

- Rust (`rustup` toolchain)
- Bun (or npm/pnpm — replace `bun` below if using a different one)
- Xcode command-line tools (macOS)

## Develop

```
bun install
bun run tauri dev
```

The first `cargo` build pulls and compiles a few hundred crates, so the
initial dev launch takes a few minutes. Subsequent runs are incremental
and much faster.

## Build a release `.app`

```
bun run tauri build
```

Output lands in `src-tauri/target/release/bundle/macos/`.

## Project layout

```
src/                                React frontend
  App.tsx                           Shell: open DB + tab nav
  views/                            One file per tab
    MoodChart.tsx / .css            Punch-card chart
    Placeholder.tsx                 Stub for unimplemented tabs
  db/types.ts                       Row types + color palettes
  db/queries.ts                     SQL helpers (date-range queries)
src-tauri/                          Rust shell, plugin config, build settings
  src/lib.rs                        Plugin registration
  capabilities/default.json         What the frontend is allowed to do
  tauri.conf.json                   Window + bundle config
```

## Current state

### Open Database flow

Pick a `journal.db` via the native file dialog. The viewer opens it
read-only via `tauri-plugin-sql` and switches to the tabbed shell.
"Close" returns to the picker.

### Tabs

- **Mood Chart** — implemented (see below).
- **Metrics**, **Habits**, **Trackers** — placeholder stubs.

### Mood Chart

The TriLog "punch card" chart, ported to the desktop. Days run left to
right along the bottom, hours of day run top to bottom (midnight to
midnight). For each day the chart shows three sub-tracks (mood, energy,
activity) when "All" is selected, or a single full-width track when
filtered.

Toolbar:

- **All / Mood / Energy / Activity** toggle group. "All" shows 30 days
  with three sub-columns each; the single-metric modes show 90 days
  with one sub-column each, so per-sub-column width stays the same.
- **Notes** checkbox — overlays a marker per `note_entries` row at its
  timestamp.
- **‹ ›** date navigation steps back/forward by the visible window size
  and clamps the right edge to today.

Per-day rendering:

- **Activity bars** — 1/3-of-day-column wide, colored by activity type
  using the iOS palette.
- **Mood / Energy circles** — 14px filled dots centered in their
  sub-columns, colored by mood type (`MOOD_COLORS`) or energy level
  (`ENERGY_COLORS`).
- **Note markers** — 16px white tiles (rounded square in single-view,
  circle in "All" view) pinned over the right-most visible sub-column,
  with a Lucide icon picked from the note's flags
  (`Utensils` / `HeartPulse` / `Droplet` / `BarChart3` / `FileText`).
- **Sub-column background** — `#0f0f0f` base with a daylight tint
  gradient (`rgba(255,255,255,0.06)` solid 6am-6pm, with 30-min twilight
  fades at sunrise / sunset). Today's column swaps in a green tint.
- **Reference lines** — thin horizontal lines at 3am, noon, and 6pm
  span the full chart, matching the iPhone app.

Data handling:

- **Fill in Gaps assumed on**: every activity is extended forward to
  the start time of the next activity (the per-entry `fillGaps` and the
  natural-duration end are both ignored unless the activity is the last
  in the series). Gated by a TODO for when we add a viewer settings
  menu.
- **Cross-day activities** (e.g. sleep from 11pm to 7am) are placed on
  every day they overlap and clamped to that day's boundaries when
  drawn.

### Not yet implemented

- Click an entry → side panel with notes / details.
- Real sunrise / sunset times (currently uses the iOS app's 6am-6pm
  fallback regardless of date or location).
- Hamburger menu for viewer settings (Fill in Gaps toggle, light theme,
  etc.).
- Photo lookup from the `images/` folder bundled alongside `journal.db`.
- Metrics / Habits / Trackers tabs.
