# Lift Log

A free, offline-first lifting tracker you install on your phone's home screen. No app store, no account, no server of your own.

**Live example:** https://rcdourron.github.io/lift-log/ (it opens empty — your data stays on your own phone).

## What it does

- **Log workouts at the gym, offline.** Sets, reps and weight, with last session's numbers shown as hints so you can tap ✓ to repeat them.
- **Templates.** Start a planned session with exercises, warm-up sets, start weights, rest times and coaching notes filled in.
- **Rest timer** that starts when you check off a set, using each exercise's own rest time.
- **Plate math** for barbell lifts (plates per side on a 45 lb bar).
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

The sheet gets three tabs: **Workouts** (one row per session), **Sets** (one row per set) and **Templates** (one row per template, with its full definition as JSON).

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
