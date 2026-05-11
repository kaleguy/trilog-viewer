# Sample data

`sample-journal.db` is a synthesized SQLite file in the same schema
the iPhone TriLog app exports. Open it from the viewer's
"Open Database…" button to populate every tab with realistic-looking
data — useful for screenshots, demos, or trying the app without
running the iPhone export flow.

## What's in it

~6 weeks ending on the upcoming Saturday relative to when the file
was generated. Per day:

- Sleep 11pm–7am (8 h)
- Morning routine 7–8am
- Weekdays: transit 30 min, work 9–5, transit 30 min, leisure
- Weekends: leisure mornings, socialize afternoons, leisure evenings
- 2–4 mood snapshots (mostly happy on weekends, some anxious on
  weekdays)
- 2–3 energy snapshots
- Tue/Thu morning exercise
- 2 meal notes with calorie estimates
- 2–5 pomodoros on weekdays
- 3 trackers: `caf` (caffeine mg, sum), `fog` (brain fog 1–5,
  traffic-light), `vegan` (toggle — ON for the first week, OFF
  thereafter via a `t vegan - ...` note)
- 4 habits with varying completion rates (50–85%)
- Daily weather: temperature, short forecast, humidity %

`app_settings` carries the row-visibility snapshot so most rows
default to visible, with Cycles, Other, and several extras hidden
to keep the grid uncluttered.

## Regenerating

The data is deterministic — same input seed every run — but the
window slides to today, so re-run if you want fresh-looking dates:

```
bun run scripts/generate-sample-db.ts
```

This rewrites `sample-journal.db` in place.

## Not synthesized

A few things the script leaves out because the viewer either hides
them by default or they'd take more room than they're worth here:

- HK Sleep / HK Deep / HK REM (Pro-only rows, hidden by default)
- Resting HR, HRV, avg body weight (Pro-only, hidden)
- Cycles (no women's-cycle data in the sample profile)
- Pressure / Pollen / Air Quality / UV (Pro-only environmental rows)
- Journal entries (left empty)
- Photos (no `images/` folder)

Add these by editing `scripts/generate-sample-db.ts` if you need them
in a screenshot.
