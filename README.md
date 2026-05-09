# TriLog Viewer

Native Mac viewer for TriLog data exports. Reads the `journal.db` SQLite
file produced by TriLog's "Export Database + Photos" bundle and lets you
browse entries (and eventually photos) offline.

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
src/             React frontend (the UI)
src-tauri/       Rust shell, plugin config, build settings
src-tauri/capabilities/default.json   what the frontend is allowed to do
```

## Current state

Smoke test only — opens a file picker, loads the chosen `journal.db`,
runs three `COUNT(*)` queries against the `day_entries` table, and shows
the totals. UI for browsing entries and photos comes next.
