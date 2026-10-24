# Lift Log

A free, offline-first lifting tracker you install on your phone's home screen. No app store, no account, no server of your own.

**Live example:** https://rcdourron.github.io/lift-log/ (it opens empty — your data stays on your own phone).

## What it does

- **Log workouts at the gym, offline.** Sets, reps and weight, with last session's numbers shown as hints so you can tap ✓ to repeat them.
- **Templates.** Build them in the app (**+ Template**), or save any finished workout as one. Each holds exercises, warm-up sets, target weights and reps, rest times, coaching notes and supersets.
- **Smart progression.** When every working set hit its target reps at RPE 8 or less last time, the app suggests adding 5 lb (10 lb for squats, deadlifts, leg press and hip thrusts) and pre-fills it. Otherwise it suggests holding the weight.
- **Exercise history and PRs.** Tap an exercise name for your records and recent sessions. Beating your best estimated 1-rep max or heaviest set flags the set as a PR.
- **Supersets.** Link exercises from the ••• menu; the rest timer starts only after the last exercise in the group.
- **Strava cardio (optional).** Runs, rides and other activities show up in History and count toward a weekly goal shown on the start screen.
- **Training blocks.** Set a block name, start date, length and ski trips (Data tab). The start screen shows "Week 3 of 8 · Build", the last week and the week before each trip are deloads (template sets are halved automatically), and it sets that week's cardio targets: an easy run that grows 5 minutes every two weeks (ticked off automatically from Strava) and interval rounds that grow by one.
- **Easy-pace check.** Runs faster than your easy pace are flagged.
- **Next-day check-in.** The day after a session the app asks whether you feel better, the same or worse. "Worse" makes the next few days' suggested weights about 10% lighter.
- **Finish summary**: duration, sets, volume against your last comparable session, and new PRs.
- **Rest timer** that starts when you check off a set, using each exercise's own rest time, with a beep (toggle on the Data tab) and auto-scroll to the next set.
- **Plate math** for any bar: pick the bar per exercise in its ••• menu (45 lb by default for barbell lifts, 55 for trap bar, plates only for landmine).
- **How-to diagrams (online only).** An exercise's history sheet shows images, a muscle map and a description from the open [wger](https://wger.de) exercise database when it has a match, plus a link to form videos.
- **Adjust a workout mid-session with Claude.** Tap **Adjust with Claude**, say what's going on ("back feels tight", "hotel gym, dumbbells only"). Lift Log copies a prompt with what you've done and what's left and opens Claude. Copy Claude's reply back, preview the changes and apply them. Finished sets are never touched, and there's an Undo.
- **Workout and activity details.** Tap anything in History for every set (with estimated 1RM and PRs), comparisons with the last time you did that workout or exercise, and for Strava activities pace, heart rate and how they compare with your recent ones.
- **Claude's take (optional).** Each detail page shows a short insight written by Claude. Claude writes these into an **Insights** tab of your sheet (for example from a scheduled task with the Google Sheets connector) and the app picks them up on sync. Without it, the page offers "Ask Claude about this now".
- **Swap exercise** from any exercise's ••• menu, with similar movements listed first. Reps carry over, finished sets stay.
- **Body weight log** with a trend line, synced to the sheet.
- **Ask Claude.** Opens Claude with a ready-made prompt (weekly check-in, plan the next session, review a workout). Paste a Claude Project link on the Data tab to send prompts there instead, so conversations and plans stay in one place.
- **Timed and distance sets** (planks, wall sits, carries) alongside regular reps.
- **History and progress charts**: estimated one-rep max over time, heaviest set, PR tags, 3-month / 1-year / all-time ranges.
- **Strong import.** Load your full history from the Strong app's CSV export, and re-import later without duplicates.
- **Backups.** Export everything to a JSON file and restore it on any device.
- **Optional Google Sheets sync** so your log lives in a spreadsheet you own — and an AI assistant (or you) can read and analyze it.
- **Self-updating.** When you publish a new version, the app shows "New features available! [Tap to Update]".

Units are pounds. Everything is plain HTML, CSS and JavaScript in one file — no build step, no dependencies.

## Make your own copy (about 10 minutes)

You need a free GitHub account. The site must be served over HTTPS, which GitHub Pages does for you.

1. **Fork this repo** (or create a new public repo and upload these files, keeping the `icons/` folder).
2. In your repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
3. Wait a minute, then open `https://YOUR-USERNAME.github.io/REPO-NAME/` in **Safari** (iPhone) or **Chrome** (Android).
4. iPhone: **Share → Add to Home Screen.** Android: **⋮ → Install app.**
5. Open Lift Log from the home-screen icon from now on. It works with no signal once it has loaded once.

### Bring your Strong history (optional)

In Strong: **Settings → Export Strong Data**, save the CSV to Files. In Lift Log: **Data → Import Strong export** and pick the file. Re-importing a newer export replaces your Strong history and never touches workouts you logged in Lift Log.

### Add templates

Templates come from either place:
- **`seed.json`** in your repo, loaded on a phone's first launch (see [AGENTS.md](AGENTS.md) for the format), or
- the **Templates** tab of your Google Sheet, if you set up sync (it flows down to the app on every sync).

Keep personal plans out of a public repo; the Sheet is private to your Google account.

## Google Sheets sync (optional)

`Code.gs` is a small Google Apps Script that receives workouts from the app and writes them to your sheet. It is **not** part of the website.

1. Create a blank Google Sheet (e.g. "Lift Log").
2. **Extensions → Apps Script.** Delete the starter code, paste all of `Code.gs`, **Save**.
3. **Deploy → New deployment → ⚙ → Web app.** Execute as: **Me**. Who has access: **Anyone**. **Deploy**, then allow the permissions. Google warns the app is unverified because it's your own script: **Advanced → Go to (project) → Allow**.
4. Copy the **Web app URL** (ends in `/exec`).
5. In Lift Log: **Data → Google Sheets sync →** paste the URL → **Connect sheet**.

The first sync sends your Strong history, templates and every finished workout. After that each finished workout syncs within seconds when you're online, or queues until you are.

"Anyone" only means the URL works without a Google sign-in. The first copy of Lift Log that connects registers a random secret with the script; requests without it are refused. To link a different phone or start over, delete the `TOKEN` entry under **Apps Script → Project Settings → Script Properties**.

The sheet gets these tabs: **Workouts** (one row per session), **Sets** (one row per set), **Templates** (one row per template, with its full definition as JSON), **Cardio** (Strava, if connected), **Body** (body-weight log) and **Insights** (Claude's notes on each activity: `id, kind, date, insight, created_at`; anything that can write to your sheet can fill it).

### Strava cardio (optional, needs Sheets sync)

The sync script fetches Strava itself, so your Strava keys stay in your Google account, not on the phone.

1. Make sure your sheet has the latest `Code.gs` deployed (see "Updating the script" below).
2. In Lift Log: **Data → Strava cardio → Connect Strava → Open Strava setup.**
3. The setup page tells you the callback domain to use. On Strava, open **Settings → My API Application** (strava.com/settings/api), create an app with that **Authorization Callback Domain** (any name, category and website), then paste its **Client ID** and **Client Secret** into the setup page.
4. Tap **Continue to Strava**, approve, and when you see "Strava connected", go back to Lift Log and tap **Refresh**. The first fetch brings in the last year.

After that, each sync checks Strava for new activities (at most every 5 minutes). Strava's weight-training entries are skipped so they don't double-count your lifts. Activities land in a **Cardio** tab in your sheet.

### Updating the script

When `Code.gs` changes: paste the new version into Apps Script, **Save**, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same. If Google asks you to authorize again (new features such as Strava need new permissions), approve it.

## Updating your copy

Edit the files, then **bump `VERSION` at the top of `sw.js`** (e.g. `2026-10-24.2` → `2026-10-24.3`) and commit. That change is what makes phones download the new version and show the update banner. Bump `APP_VERSION` in `index.html` to match so the Data tab shows it.

## Your data

- Workouts live in the phone's browser storage (`localStorage`) for the Lift Log site. **Deleting the home-screen icon deletes them.**
- Use **Data → Export backup** every week or two and keep the file in Files / iCloud Drive / Google Drive.
- Nothing personal ships in this repo: `seed.json` is an empty starter.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app: markup, styles and script. |
| `sw.js` | Service worker: offline caching and the update flow. |
| `manifest.json` | Home-screen name, colors and icons. |
| `seed.json` | Starter templates loaded on first launch. Empty by default. |
| `icons/` | App icons (192, 512, maskable 512, Apple touch 180). |
| `Code.gs` | Optional Google Apps Script for Sheets sync. Paste into Apps Script; not served by the site. |
| `AGENTS.md` | Technical notes for AI coding agents and developers. |

## License

MIT — see [LICENSE](LICENSE).
