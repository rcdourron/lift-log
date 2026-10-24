# Lift Log (offline app)

Files: index.html, manifest.json, sw.js, seed.json, icons/. Keep them together in one folder.
Code.gs is the Google Sheets sync script. It contains no secrets; you paste it into Apps Script (see below).

## Put it online for free (GitHub Pages)
1. Create a free GitHub account and a new public repository, e.g. `lift-log`.
2. Add file → Upload files → select everything in this folder (keep the icons folder) → Commit.
3. Settings → Pages → Source: "Deploy from a branch" → Branch: main, folder: / (root) → Save.
4. After a minute, open https://YOUR-USERNAME.github.io/lift-log/ in Safari on your iPhone.
5. Share → Add to Home Screen. Open Lift Log from the icon from now on.

## Updating
Change the files, bump VERSION at the top of sw.js (e.g. 2026-10-24.2), upload again.
Next time you open the app online, it shows "New features available! [Tap to Update]".

## Your data
Everything is stored on the phone (localStorage). Deleting the home-screen icon deletes it.
Use Data → Export backup every week or two, and keep the file in Files or iCloud Drive.
No personal data ships with this code: seed.json is an empty starter. Load a Strong history with Data → Import Strong export, and templates sync in from the Templates tab of your Google Sheet.

## Google Sheets sync (so Claude can read your lifts)
Code.gs is NOT part of the website. It goes inside your Google Sheet:
1. Create a blank Google Sheet named "Lift Log".
2. Extensions → Apps Script. Delete what's there, paste all of Code.gs, Save.
3. Deploy → New deployment → gear icon → Web app.
   Execute as: Me. Who has access: Anyone. Deploy, then allow the permissions.
4. Copy the Web app URL (https://script.google.com/macros/s/…/exec).
5. In Lift Log: Data → Google Sheets sync → paste the URL → Connect sheet.
The first sync sends your Strong history, templates and every finished workout.
After that, each finished workout syncs within seconds when you have signal,
or the next time you're online. Templates edited in the sheet's Templates tab flow back to the app.
