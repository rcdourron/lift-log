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
| `ll.cardio.v1` | Cardio rows from the sheet's Cardio tab (see sync protocol), last ~400 days. Read-only in the app. |
| `ll.strava.v1` | Last Strava status from the script: `{connected, hasApp, last, error}`. |
| `ll.goal` | Weekly goal `{lifts, cardio}`. |
| `ll.exnotes.v1` | Pinned per-exercise notes `{ [exerciseName]: text }`. |
| `ll.block` | Training block `{name, start: 'YYYY-MM-DD'|null, weeks, trips: ['YYYY-MM-DD'], phases?: [{from, to, name, note, deload?}]}`. Without `phases` the defaults are weeks 1–2 Rebuild, 3…n-1 Build, last week Deload (`phasesOf()`). A week with a trip in the next 7 days is also a deload. |
| `ll.cfg` | `{sound, easyPace: 'M:SS', runBase, runStep, runEvery, runMax, intBase, intStep, intEvery, intMax, intWork, intRest, claudeUrl}`, merged over `CFG0` defaults. Easy-run minutes = `runBase + runStep × floor((week-1)/runEvery)`, capped at `runMax`; interval rounds likewise. |
| `ll.checkins` | `{ [workoutId]: {v: 'better'|'same'|'worse', at} }`. A "worse" in the last 72 h makes `suggestFor()` return ~90% of last top weight. |
| `ll.body` | Body-weight log `[{date: 'YYYY-MM-DD', lb}]`, sorted. |
| `ll.bars` | Per-exercise bar weight for plate math `{ [exerciseName]: lb | 0 (plates only) | null (none) }`. Defaults in `barFor()`. |
| `ll.intdone` | Interval session ticked off, keyed by the Monday of the week. |
| `ll.insights.v1` | `{ [workoutId or Strava id]: {text, at} }` from the sheet's Insights tab. Read-only in the app. |
| `ll.undo` | Snapshot `{id, exercises, plan, at}` taken before the last Claude adjustment or swap, for Undo. Cleared on finish. |
| `ll.howto.v2` / `ll.howto.pick` / `ll.wger.idx` | wger lookup cache, manual picks, and the cached wger name index (see External services). |

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
      "ss": "g1",                              // optional superset group id shared by adjacent exercises
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
- `pr: true` marks a set that beat the exercise's best estimated 1RM or heaviest weight when it was logged.
- Smart progression (`suggestFor()`): looks at last session's working sets at the top weight. With template targets (`tr`), it suggests +5 lb (+10 for lifts matching `BIGSTEP`) when every one hit the target at RPE ≤ 8 (or no RPE logged), otherwise "stay". Without targets it only suggests an increase when every top set has RPE ≤ 8 logged.

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
  "templates": [ /* written if replaceTemplates is true, or if the sheet's Templates tab is empty */ ],
  "replaceTemplates": false,    // true after the user edits templates in the app
  "cardio": true,               // ask for Cardio rows back (and fetch Strava if connected)
  "forceCardio": false,         // fetch Strava now even if fetched in the last 5 minutes
  "body": [ {"date": "YYYY-MM-DD", "lb": 180.2} ]   // optional; when present, replaces the Body tab
}
```

Response: `{ ok: true, wrote: n, templates: [...], cardio: [{id, date, type, name, minutes, miles, elev_ft, hr, effort, elapsed}], insights: {[id]: {text, at}}, strava: {connected, hasApp, last, error} }` or `{ ok: false, error: "bad_token" | "no_token" | "bad_json" | "unknown_op" | message }`. The app replaces its local templates with the sheet's whenever they differ, so the sheet is the source of truth for templates once it has any.

The first token a script sees is stored in Script Properties as `TOKEN`; later requests must match it.

Other ops: `{op:"strava_link"}` returns `{url}` for a one-time Strava setup page (30-minute state); `{op:"strava_disconnect"}` forgets the Strava tokens. The script's `doGet` serves that setup page (`?strava=setup&state=…`) and Strava's OAuth callback (`?code=…&state=…`).

Script Properties used: `TOKEN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_ACCESS`, `STRAVA_REFRESH`, `STRAVA_EXPIRES`, `STRAVA_LAST`, `STRAVA_ERROR`, `STRAVA_STATE`, `STRAVA_STATE_AT`. Never put any of these in the repo or the app.

### Sheet layout

- **Workouts:** `id, date, name, source, template, minutes, sets, volume_lb, notes, updated_at, json` (`json` = full workout).
- **Sets:** `workout_id, date, workout, exercise, set, type, weight_lb, reps, seconds, distance, rpe, note, source` — one row per completed set. Best tab for analysis.
- **Templates:** `id, order, name, summary, json`. Edit the `json` cell to change a template; it reaches the phone on its next sync (unless the phone has unsynced template edits, which win).
- **Cardio:** `id, date, type, name, minutes, distance_mi, elevation_ft, avg_hr, effort, elapsed_min` — one row per Strava activity except WeightTraining, upserted by id.
- **Body:** `date, weight_lb` — the app's body-weight log, replaced wholesale on each change.
- **Plan:** `setting, value, notes` rows (`PLAN_ROWS` in the app lists the keys: `block_name`, `block_start`, `block_weeks`, `ski_trips`, `phases` (JSON or blank), `easy_pace`, `easy_run_start_min`, `easy_run_step_min`, `easy_run_every_weeks`, `easy_run_max_min`, `intervals_start_rounds`, `intervals_step_rounds`, `intervals_every_weeks`, `intervals_max_rounds`, `interval_work_sec`, `interval_rest_sec`, `lifts_per_week`, `cardio_per_week`). The app sends `plan: [[key, value], …]` after any plan change and the script rewrites the tab; every sync response carries `plan: {rows, rev}` (`rev` is a hash of the rows), and when `rev` differs from the last one the app saw and it has no unsent changes, the app applies the sheet's plan. So anyone can edit the value column and the phone follows. An empty tab makes the app push its current plan.
- **Insights:** `id, kind, date, insight, created_at` — written by Claude or any other tool, never by the app. `id` matches a Workouts `id` (Lift Log or `strong-…`) or a Cardio `id` (Strava activity id); `kind` is `lift` or `cardio`. The sync response includes them as `insights: { [id]: {text, at} }` and the app shows them on that activity's detail page.

`date` is local time `YYYY-MM-DD HH:MM`. `source` is `lift-log` or `strong`. Rows are kept sorted by date.

## External services (all optional, online only)

- **wger.de** (`loadHowto()`): on first use the app downloads a name index of all English exercises (`exercise-translation`, `exerciseimage` and `exercise` lists, about 1.3 MB) and keeps a compact copy in `ll.wger.idx` for 30 days. `howMatch()` fuzzy-matches the Lift Log name against it: names are normalized (`HOW_SYN` handles plurals, pull-up/pullup, RDL and so on), the words outside the equipment in parentheses must match, extra words in the wger name cost points (modifiers like incline or seated cost more), equipment that matches gains points and conflicting equipment loses them, and entries with images are preferred. `HOW_ALIAS` maps a few names straight to a wger name. Then `/api/v2/exerciseinfo/{id}/` supplies images, muscles (relative URLs are made absolute with `wabs()`) and the description. Results are cached in `ll.howto.v2` (misses are retried after 14 days). Users can pick the right wger exercise by hand ("Wrong exercise? Pick another"), stored in `ll.howto.pick` as `{ [name]: wgerExerciseId }`. Images are CC-BY-SA and similar, so keep the attribution line.
- **Claude:** "Ask Claude" opens `https://claude.ai/new?q=<prompt>` (prompt capped at 1800 chars, and it contains no workout numbers — Claude reads them from the sheet). If the user saved a project link in `ll.cfg.claudeUrl`, the prompt is copied to the clipboard and the project opens instead.
- The service worker only caches same-origin files and Google Fonts; these requests go straight to the network.

## Live adjustments (Claude change blocks)

"Adjust with Claude" copies `livePrompt()` (the in-progress workout as numbered exercises with done/left sets) to the clipboard and opens Claude. Claude answers with a block the user pastes back; `parseChanges()` reads it and `planChanges()` turns it into a new exercise list for preview:

```
LIFTLOG-CHANGES
{"changes":[
  {"op":"swap",   "ex":1, "to":"Goblet Squat (Dumbbell)", "sets":[{"w":50,"r":10}], "unit":"sec|m (optional)", "rest":90, "note":"…"},
  {"op":"sets",   "ex":2, "sets":[{"w":135,"r":8}]},      // replaces the sets not yet done
  {"op":"remove", "ex":3},                                 // drops remaining sets; removes the exercise if none were done
  {"op":"add",    "after":4, "name":"Dead Bug", "sets":[{"r":10}], "rest":60},   // after:0 = first, omitted = last
  {"op":"note",   "text":"…"}                              // appended to the workout plan note
]}
```

`ex`/`after` are 1-based numbers from the prompt, resolved before anything moves. Done sets are never changed; swapping an exercise with done sets keeps it (done sets only) and inserts the new one after it. New sets become targets (`tw`/`tr`), so the user still confirms each one. Changed exercises get `adj: 1`, which turns off smart-progression suggestions for them. The menu's **Swap exercise** uses the same code (`op: swap` without `sets`: reps carry over, weights clear). `altsFor()` lists similar movements using the `ALT` pattern groups.

## Plan blocks (Plan with Claude)

The Data tab's **Plan with Claude** copies `planPrompt()` (the current plan as JSON) and opens Claude. Claude replies with:

```
LIFTLOG-PLAN
{"block":{"name":"Winter 27","start":"2026-11-02","weeks":8,"trips":["2027-01-15"],
  "phases":[{"weeks":"1-2","name":"Rebuild","note":"…"},{"weeks":"3-7","name":"Build","note":"…"},{"weeks":"8","name":"Deload","deload":true}]},
 "cardio":{"easyPace":"10:20","easyRun":{"start":35,"step":5,"every":2,"max":50},"intervals":{"start":6,"step":1,"every":2,"max":10,"work":60,"rest":60}},
 "goal":{"lifts":2,"cardio":2}}
```

`parsePlanBlock()` reads it, `mergePlan()` validates and clamps every field (anything left out keeps its current value), `planDesc()` renders the preview and `commitPlan()` saves it and marks it for sync. The same object shape is built from the sheet's Plan tab by `planFromRows()`.

## Testing changes

- Everything is in one script scope, so a new `function foo()` silently replaces an existing one with the same name. Before committing, check for duplicates: `grep -oE "function [A-Za-z_$][A-Za-z0-9_$]*\(" index.html | sort | uniq -d` should print nothing.

- Serve the folder over HTTP locally (for example `python3 -m http.server 8000`) and open `http://localhost:8000/`. Service workers work on `localhost` without HTTPS.
- Use a private window or clear site data to test first launch; DevTools → Application shows `localStorage`, the service worker and the caches.
- To test the update toast: load the page, bump `VERSION` in `sw.js`, then reload. The toast appears once the new worker has installed.
- Phones need HTTPS for the service worker, which GitHub Pages provides.
