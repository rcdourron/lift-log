# AGENTS.md — notes for AI agents and developers

Lift Log is a static, offline-first PWA. There is no build step, package manager, framework or backend. Read this before changing anything.

## Ground rules

1. **Bump the version on every change.** Edit `VERSION` at the top of `sw.js` and `APP_VERSION` near the top of the script in `index.html` (same value, format `YYYY-MM-DD.N`). Phones only pick up new code when `sw.js` changes byte-for-byte.
2. **Keep it one file.** All app markup, CSS and JS live in `index.html`. Don't add a bundler or npm dependencies. The only external resource is Google Fonts, with system-font fallbacks.
3. **Never commit personal data.** This repo is public. No real workouts, Strong exports, sheet URLs, Apps Script URLs or tokens. `seed.json` stays generic; personal templates belong in the user's Google Sheet.
4. **Don't break stored data.** Users' workouts live in `localStorage` on their phones. If you change a data shape, read old shapes too, or migrate under a new key.
5. **Add new cached files to `ASSETS` in `sw.js`.** A missing file there makes the app fail offline; a listed file that doesn't exist makes the service worker install fail.

## Files

- `index.html` — the app. A plain-JS state object `S`, string-template rendering into `<main id="main">`, and one delegated click handler keyed on `data-act` attributes. Tabs: Workout, History, Progress, Data.
- `sw.js` — cache-first for same-origin files, stale-while-revalidate for Google Fonts. A new version installs in the background and waits; the page shows the update toast; tapping it posts `{type:'SKIP_WAITING'}`, the old caches are deleted in `activate`, and the page reloads on `controllerchange`.
- `manifest.json` — standalone display, relative `start_url`/`scope` (`./`), so it works under any GitHub Pages sub-path.
- `seed.json` — `{"templates": [...]}` (and optionally `"strong": {...}`), read once on first launch if `localStorage` is empty.
- `Code.gs` — Google Apps Script web app for Sheets sync (see below).

## Storage (localStorage keys)

| Key | Contents |
| --- | --- |
| `ll.workouts.v1` | Object map `{ [workoutId]: Workout }` of workouts logged in Lift Log, including one in progress. |
| `ll.strong.v1` | `{ workouts: Workout[], meta: {source, file, importedAt, workouts, first, last} }` from the last Strong CSV import. Each workout has `sid` as its id. Replaced wholesale on re-import. |
| `ll.templates.v1` | `Template[]` |
| `ll.sync.v1` | Sheets sync state: `{url, token, pend: [ids], dels: [ids], strong: bool, last, err}` |
| `ll.rest` | Default rest-timer length in seconds. |

## Data model

```jsonc
// Workout
{
  "name": "Push Day",
  "startedAt": "2026-10-24T14:00:00.000Z",   // ISO 8601
  "endedAt": "2026-10-24T15:05:00.000Z",
  "finished": true,                            // false while in progress
  "template": "push-a",                        // optional template id
  "plan": "Template-level note shown at the top",
  "notes": "Free-text workout notes",
  "updatedAt": "…",
  "exercises": [
    {
      "name": "Bench Press (Barbell)",         // Strong's naming: "Lift (Equipment)"
      "unit": "sec",                           // optional: "sec" | "m"; default is reps
      "rest": 150,                             // optional rest seconds
      "note": "Coaching note",
      "sets": [
        { "w": 135, "r": 5, "done": true, "t": "W" },   // t: "W" warm-up, "D" drop, "F" failure
        { "w": 185, "r": 5, "done": true, "rpe": 8 },
        { "w": 0, "sec": 45, "done": true },             // timed set (unit "sec")
        { "w": 50, "dist": 40, "done": true }            // distance set (unit "m")
      ]
    }
  ]
}
```

- Weights are in pounds. `w: 0` means bodyweight. `tw` / `tr` on a set are template targets shown as placeholder hints.
- Warm-up sets (`t: "W"`) are excluded from bests and estimated 1RM (Epley: `w × (1 + r/30)`).
- Only `done: true` sets are kept when a workout is finished.

```jsonc
// Template
{
  "id": "push-a", "order": 1, "name": "Push A",
  "summary": "Bench, press, triceps · ~60 min",
  "note": "Shown at the top of the session",
  "exercises": [
    { "name": "Bench Press (Barbell)", "rest": 150, "note": "…",
      "sets": [ { "w": 95, "r": 10, "t": "W" }, { "w": 155, "r": 8 }, { "w": 155, "r": 8 } ] },
    { "name": "Plank", "unit": "sec", "rest": 30, "sets": [ { "w": 0, "r": 45 } ] }   // r = seconds when unit is "sec", meters when "m"
  ]
}
```

## Strong CSV import

Parsed in the browser by `strongFromCSV()`. Expects Strong's columns `Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE` (comma or semicolon delimited). `Rest Timer` rows are skipped. Workout ids are `strong-YYYYMMDDTHHMMSS` from the `Date` column, so re-imports are stable.

## Google Sheets sync protocol

The app POSTs JSON (sent as `text/plain` to avoid a CORS preflight) to the Apps Script web app URL:

```jsonc
{
  "op": "sync",
  "token": "random hex the app generated when connecting",
  "upserts": [ { "id": "…", "wrow": [/* Workouts row */], "srows": [[/* Sets rows */]] } ],
  "deletes": ["workoutId", …],
  "strong": [ /* same shape as upserts; when present, replaces ALL source=strong rows */ ],
  "templates": [ /* written only if the sheet's Templates tab is empty */ ]
}
```

Response: `{ ok: true, wrote: n, templates: [...] }` or `{ ok: false, error: "bad_token" | "no_token" | "bad_json" | "unknown_op" | message }`. The app replaces its local templates with the sheet's whenever they differ, so the sheet is the source of truth for templates once it has any.

The first token a script sees is stored in Script Properties as `TOKEN`; later requests must match it.

### Sheet layout

- **Workouts:** `id, date, name, source, template, minutes, sets, volume_lb, notes, updated_at, json` (`json` = full workout).
- **Sets:** `workout_id, date, workout, exercise, set, type, weight_lb, reps, seconds, distance, rpe, note, source` — one row per completed set. Best tab for analysis.
- **Templates:** `id, order, name, summary, json`. Edit the `json` cell to change a template; it reaches the phone on its next sync.

`date` is local time `YYYY-MM-DD HH:MM`. `source` is `lift-log` or `strong`. Rows are kept sorted by date.

## Testing changes

- Serve the folder over HTTP locally (for example `python3 -m http.server 8000`) and open `http://localhost:8000/`. Service workers work on `localhost` without HTTPS.
- Use a private window or clear site data to test first launch; DevTools → Application shows `localStorage`, the service worker and the caches.
- To test the update toast: load the page, bump `VERSION` in `sw.js`, then reload. The toast appears once the new worker has installed.
- Phones need HTTPS for the service worker, which GitHub Pages provides.
