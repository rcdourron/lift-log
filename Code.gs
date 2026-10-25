/** @OnlyCurrentDoc */
/**
 * Lift Log → Google Sheets sync (and optional Strava cardio).
 *
 * Easiest setup: open Lift Log's setup guide (the app's address + #setup) and follow it.
 * By hand: paste this whole file into Extensions → Apps Script in a Google Sheet, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), and paste the
 * Web app URL into Lift Log → Data → Google Sheets sync. In the sheet, the Lift Log menu →
 * "Connect a phone" shows a code your phone can scan.
 *
 * Security: the first copy of Lift Log that connects registers a random key with this
 * script. After that, requests without that key are refused, even from someone who has the URL.
 * Strava credentials (if you connect Strava) are kept in this script's properties, never in the app.
 */

const TABS = { workouts: 'Workouts', sets: 'Sets', templates: 'Templates', cardio: 'Cardio', body: 'Body', insights: 'Insights', plan: 'Plan' };
const WORKOUT_HEADER = ['id', 'date', 'name', 'source', 'template', 'minutes', 'sets', 'volume_lb', 'notes', 'updated_at', 'json'];
const SET_HEADER = ['workout_id', 'date', 'workout', 'exercise', 'set', 'type', 'weight_lb', 'reps', 'seconds', 'distance', 'rpe', 'note', 'source'];
const TEMPLATE_HEADER = ['id', 'order', 'name', 'summary', 'json'];
const CARDIO_HEADER = ['id', 'date', 'type', 'name', 'minutes', 'distance_mi', 'elevation_ft', 'avg_hr', 'effort', 'elapsed_min'];
const BODY_HEADER = ['date', 'weight_lb'];
// Insights are written by Claude (for example a scheduled task with the Google Sheets connector), one row per activity.
const INSIGHT_HEADER = ['id', 'kind', 'date', 'insight', 'created_at'];
// Training plan as setting/value rows. The app writes it when you change the plan; Claude (or you) can edit the value column.
const PLAN_HEADER = ['setting', 'value', 'notes'];
const PLAN_NOTES = {
  block_name: 'Name of the training block',
  block_start: 'First day of week 1, YYYY-MM-DD (a Monday). Blank = not started',
  block_weeks: 'Length of the block in weeks',
  ski_trips: 'Trip start dates, YYYY-MM-DD, comma separated. The week before each is a deload',
  phases: 'JSON: [{"weeks":"1-2","name":"Rebuild","note":"..."},{"weeks":"8","name":"Deload","deload":true}]. Blank = default',
  easy_pace: 'Easy runs should be slower than this, min:sec per mile',
  easy_run_start_min: 'Easy run minutes in week 1',
  easy_run_step_min: 'Minutes added each step',
  easy_run_every_weeks: 'Weeks between steps',
  easy_run_max_min: 'Easy run cap, minutes',
  intervals_start_rounds: 'Interval rounds in week 1 (0 = no intervals)',
  intervals_step_rounds: 'Rounds added each step',
  intervals_every_weeks: 'Weeks between steps',
  intervals_max_rounds: 'Interval rounds cap',
  interval_work_sec: 'Hard part of each round, seconds',
  interval_rest_sec: 'Easy part of each round, seconds',
  lifts_per_week: 'Weekly lifting goal',
  cardio_per_week: 'Weekly cardio goal'
};
// Where the Lift Log app lives. Used for the phone-connection link and QR code.
const APP_URL = 'https://rcdourron.github.io/lift-log/';
const CARDIO_DAYS = 400;            // how far back the app receives cardio
const STRAVA_MIN_GAP_MS = 5 * 60e3; // don't call Strava more often than this

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lift Log')
    .addItem('Connect a phone…', 'showPhoneLink')
    .addItem('Setup guide', 'showSetupGuide')
    .addToUi();
}

function showSetupGuide() {
  const html = '<div style="font:14px/1.5 Arial,sans-serif">'
    + '<p>To sync this sheet with the Lift Log app:</p><ol>'
    + '<li>Click <b>Extensions → Apps Script</b>.</li>'
    + '<li>Click <b>Deploy → New deployment</b>, click the gear, choose <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Click <b>Deploy</b>.</li>'
    + '<li>Click <b>Authorize access</b>. On "Google hasn\'t verified this app", click <b>Advanced → Go to … (unsafe) → Allow</b>. It\'s your own copy.</li>'
    + '<li>Copy the <b>Web app URL</b>, then use <b>Lift Log → Connect a phone…</b> in this sheet.</li></ol>'
    + '<p>Full guide with pictures of each step: <a target="_blank" href="' + APP_URL + '#setup">' + APP_URL + '#setup</a></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(380), 'Lift Log setup');
}

function showPhoneLink() {
  setup_(SpreadsheetApp.getActive());
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!/\/exec$/.test(url)) url = '';
  const html = '<div style="font:14px/1.5 Arial,sans-serif">'
    + '<p>Paste this sheet\'s <b>Web app URL</b> (Extensions → Apps Script → Deploy → Manage deployments → Copy), then scan the code with your phone\'s Camera.</p>'
    + '<input id="u" style="width:100%;padding:8px;box-sizing:border-box" placeholder="https://script.google.com/macros/s/…/exec" value="' + url + '">'
    + '<div id="qr" style="margin:14px auto;width:220px;height:220px"></div>'
    + '<p style="word-break:break-all;font-size:12px" id="l"></p>'
    + '<p style="font-size:12px;color:#555">On the phone: tap the link, then <b>Copy connection</b>, open Lift Log from your home screen → Data → <b>Paste connection</b>.</p></div>'
    + '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>'
    + '<script>var A=' + JSON.stringify(APP_URL) + ';function d(){var v=document.getElementById("u").value.trim();var q=document.getElementById("qr");q.innerHTML="";var l=document.getElementById("l");'
    + 'if(!/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[A-Za-z0-9_-]+\\/exec$/.test(v)){l.textContent=v?"That isn\'t a Web app URL yet.":"";return}'
    + 'var t=A+"#connect="+encodeURIComponent(v);l.textContent=t;new QRCode(q,{text:t,width:220,height:220})}'
    + 'document.getElementById("u").addEventListener("input",d);window.onload=d;</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(380).setHeight(560), 'Connect a phone');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.code && p.state) return stravaCallback_(p);
  if (p.strava === 'setup') return stravaSetupPage_(p.state || '');
  return respond_(handle_({ op: 'ping', token: p.token || '' }));
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return respond_({ ok: false, error: 'bad_json' }); }
  return respond_(handle_(req));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty('TOKEN');
    if (!req.token) return { ok: false, error: 'no_token' };
    if (!saved) props.setProperty('TOKEN', req.token);
    else if (saved !== req.token) return { ok: false, error: 'bad_token' };

    const ss = SpreadsheetApp.getActive();
    const sh = setup_(ss);

    if (req.op === 'ping') return { ok: true, templates: readTemplates_(sh.templates), strava: stravaStatus_() };

    if (req.op === 'strava_link') {
      const state = Utilities.getUuid().replace(/-/g, '');
      props.setProperty('STRAVA_STATE', state);
      props.setProperty('STRAVA_STATE_AT', String(Date.now()));
      return { ok: true, url: ScriptApp.getService().getUrl() + '?strava=setup&state=' + state };
    }

    if (req.op === 'strava_disconnect') {
      ['STRAVA_REFRESH', 'STRAVA_ACCESS', 'STRAVA_EXPIRES', 'STRAVA_LAST', 'STRAVA_ERROR'].forEach(k => props.deleteProperty(k));
      return { ok: true, strava: stravaStatus_() };
    }

    if (req.op === 'sync') {
      const upserts = req.upserts || [];
      const strong = Array.isArray(req.strong) ? req.strong : null;
      const drop = {};
      (req.deletes || []).forEach(id => drop[id] = true);
      upserts.forEach(u => drop[u.id] = true);

      const keep = (row, idCol, srcCol) => !drop[String(row[idCol])] && !(strong && row[srcCol] === 'strong');
      const all = upserts.concat(strong || []);
      if (all.length || (req.deletes || []).length) {
        rewrite_(sh.workouts, WORKOUT_HEADER.length, r => keep(r, 0, 3), all.map(u => u.wrow), 1);
        rewrite_(sh.sets, SET_HEADER.length, r => keep(r, 0, 12), [].concat.apply([], all.map(u => u.srows || [])), 1);
      }

      const sheetTemplates = readTemplates_(sh.templates);
      if (Array.isArray(req.templates) && (req.replaceTemplates || (req.templates.length && sheetTemplates.length === 0))) {
        writeTemplates_(sh.templates, req.templates);
      }

      if (Array.isArray(req.body)) {
        const rows = req.body.filter(b => b && b.date && b.lb > 0).map(b => [String(b.date), Number(b.lb)]);
        rewrite_(sh.body, BODY_HEADER.length, () => false, rows, 0);
      }

      if (Array.isArray(req.plan)) writePlan_(sh.plan, req.plan);

      let cardio = null;
      if (req.cardio !== false && props.getProperty('STRAVA_REFRESH')) {
        try { fetchStrava_(sh.cardio, !!req.forceCardio); props.deleteProperty('STRAVA_ERROR'); }
        catch (err) { props.setProperty('STRAVA_ERROR', String(err && err.message || err).slice(0, 300)); }
      }
      if (req.cardio !== false) cardio = readCardio_(sh.cardio);

      return { ok: true, wrote: all.length, templates: readTemplates_(sh.templates), cardio: cardio, insights: readInsights_(sh.insights), plan: readPlan_(sh.plan), strava: stravaStatus_() };
    }
    return { ok: false, error: 'unknown_op' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function setup_(ss) {
  const get = (name, header, textCols) => {
    let s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      s.setFrozenRows(1);
      textCols.forEach(c => s.getRange(1, c, s.getMaxRows(), 1).setNumberFormat('@'));
    }
    return s;
  };
  const out = {
    workouts: get(TABS.workouts, WORKOUT_HEADER, [1, 2, 10, 11]),
    sets: get(TABS.sets, SET_HEADER, [1, 2, 5]),
    templates: get(TABS.templates, TEMPLATE_HEADER, [1, 5]),
    cardio: get(TABS.cardio, CARDIO_HEADER, [1, 2]),
    body: get(TABS.body, BODY_HEADER, [1]),
    insights: get(TABS.insights, INSIGHT_HEADER, [1]),
    plan: get(TABS.plan, PLAN_HEADER, [1, 2])
  };
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return out;
}

// Keep the rows that pass, add the new ones, keep everything sorted by date (column `dateCol`).
function rewrite_(sheet, width, keepFn, newRows, dateCol) {
  const last = sheet.getLastRow();
  let rows = last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
  rows = rows.filter(keepFn).concat(newRows.map(r => pad_(r, width)));
  rows.sort((a, b) => String(a[dateCol]).localeCompare(String(b[dateCol])));
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) {
    if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
  }
}

function pad_(row, width) {
  const r = row.slice(0, width).map(v => v === null || v === undefined ? '' : v);
  while (r.length < width) r.push('');
  return r;
}

function readTemplates_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, TEMPLATE_HEADER.length).getValues()
    .map(r => { try { const t = JSON.parse(r[4]); t.id = String(r[0] || t.id); return t; } catch (e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function writeTemplates_(sheet, templates) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, TEMPLATE_HEADER.length).clearContent();
  if (!templates.length) return;
  const rows = templates.map(t => [t.id, t.order || 0, t.name || '', t.summary || '', JSON.stringify(t)]);
  sheet.getRange(2, 1, rows.length, TEMPLATE_HEADER.length).setValues(rows);
}

/* ---------------- Strava ---------------- */

function stravaStatus_() {
  const p = PropertiesService.getScriptProperties();
  return {
    connected: !!p.getProperty('STRAVA_REFRESH'),
    hasApp: !!(p.getProperty('STRAVA_CLIENT_ID') && p.getProperty('STRAVA_CLIENT_SECRET')),
    last: p.getProperty('STRAVA_LAST') ? new Date(Number(p.getProperty('STRAVA_LAST'))).toISOString() : null,
    error: p.getProperty('STRAVA_ERROR') || null
  };
}

function stateOk_(state) {
  const p = PropertiesService.getScriptProperties();
  const s = p.getProperty('STRAVA_STATE'), at = Number(p.getProperty('STRAVA_STATE_AT') || 0);
  return !!state && state === s && Date.now() - at < 30 * 60e3;
}

function page_(title, body) {
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px -apple-system,system-ui,sans-serif;max-width:520px;margin:24px auto;padding:0 16px;color:#13171c}' +
    'h1{font-size:24px}input{width:100%;font:16px monospace;padding:10px;margin:4px 0 12px;box-sizing:border-box;border:1px solid #ccd;border-radius:8px}' +
    'a.btn,button{display:inline-block;background:#fc5200;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:600;text-decoration:none;font-size:16px}' +
    'code{background:#eef;padding:1px 5px;border-radius:4px}.muted{color:#5a646e;font-size:14px}</style></head><body>' +
    '<h1>' + title + '</h1>' + body + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function authorizeUrl_(state) {
  const id = PropertiesService.getScriptProperties().getProperty('STRAVA_CLIENT_ID');
  return 'https://www.strava.com/oauth/authorize?client_id=' + encodeURIComponent(id) +
    '&response_type=code&approval_prompt=auto&scope=activity:read_all' +
    '&redirect_uri=' + encodeURIComponent(ScriptApp.getService().getUrl()) + '&state=' + encodeURIComponent(state);
}

function stravaSetupPage_(state) {
  if (!stateOk_(state)) return page_('Link expired', '<p>Open <b>Data → Strava → Connect Strava</b> in Lift Log again to get a fresh link.</p>');
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('STRAVA_CLIENT_ID') && p.getProperty('STRAVA_CLIENT_SECRET')) {
    return page_('Connect Strava', '<p>Your Strava API app is saved. Approve Lift Log on Strava to finish.</p>' +
      '<p><a class="btn" target="_top" href="' + authorizeUrl_(state) + '">Continue to Strava</a></p>');
  }
  const cb = ScriptApp.getService().getUrl().replace(/^https:\/\/([^/]+).*$/, '$1');
  return page_('Connect Strava',
    '<p>1. On Strava, open <b>Settings → My API Application</b> (strava.com/settings/api) and create an app. ' +
    'Set <b>Authorization Callback Domain</b> to <code>' + cb + '</code>. Any name, category and website work.</p>' +
    '<p>2. Paste its Client ID and Client Secret here. They are saved in your Google Sheet\'s script, not in the app.</p>' +
    '<label>Client ID<input id="cid" inputmode="numeric" autocomplete="off"></label>' +
    '<label>Client Secret<input id="sec" autocomplete="off"></label>' +
    '<button id="go">Save</button><p id="msg" class="muted"></p>' +
    '<script>document.getElementById("go").onclick=function(){var m=document.getElementById("msg");m.textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(u){m.innerHTML="Saved. <a class=\\"btn\\" target=\\"_top\\" href=\\""+u+"\\">Continue to Strava</a>";})' +
    '.withFailureHandler(function(e){m.textContent=e.message;}).saveStravaApp(' + JSON.stringify(state) + ',document.getElementById("cid").value,document.getElementById("sec").value);};</script>');
}

// Called from the setup page.
function saveStravaApp(state, clientId, clientSecret) {
  if (!stateOk_(state)) throw new Error('This link expired. Get a new one from Lift Log.');
  clientId = String(clientId || '').trim(); clientSecret = String(clientSecret || '').trim();
  if (!/^\d+$/.test(clientId) || clientSecret.length < 20) throw new Error('Check the Client ID (a number) and Client Secret (a long code).');
  const p = PropertiesService.getScriptProperties();
  p.setProperty('STRAVA_CLIENT_ID', clientId);
  p.setProperty('STRAVA_CLIENT_SECRET', clientSecret);
  return authorizeUrl_(state);
}

function stravaCallback_(params) {
  if (!stateOk_(params.state)) return page_('Link expired', '<p>Start again from <b>Data → Strava</b> in Lift Log.</p>');
  if (params.error) return page_('Not connected', '<p>Strava said: ' + String(params.error).replace(/[<>&]/g, '') + '</p>');
  if (String(params.scope || '').indexOf('activity:read') < 0) return page_('Not connected', '<p>Lift Log needs permission to view your activities. Start again and leave that box ticked.</p>');
  const p = PropertiesService.getScriptProperties();
  const tok = stravaTokenRequest_({ grant_type: 'authorization_code', code: params.code });
  p.deleteProperty('STRAVA_STATE');
  p.deleteProperty('STRAVA_LAST');
  return page_('Strava connected', '<p>Done' + (tok.athlete && tok.athlete.firstname ? ', ' + String(tok.athlete.firstname).replace(/[<>&]/g, '') : '') +
    '. Go back to Lift Log and tap <b>Sync now</b> on the Data tab to bring in your last year of cardio.</p>');
}

function stravaTokenRequest_(extra) {
  const p = PropertiesService.getScriptProperties();
  const payload = Object.assign({ client_id: p.getProperty('STRAVA_CLIENT_ID'), client_secret: p.getProperty('STRAVA_CLIENT_SECRET') }, extra);
  const res = UrlFetchApp.fetch('https://www.strava.com/oauth/token', { method: 'post', payload: payload, muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.access_token) throw new Error('Strava sign-in failed (' + res.getResponseCode() + '). Reconnect Strava from Lift Log.');
  p.setProperty('STRAVA_ACCESS', body.access_token);
  p.setProperty('STRAVA_REFRESH', body.refresh_token);
  p.setProperty('STRAVA_EXPIRES', String(body.expires_at * 1000));
  return body;
}

function stravaAccess_() {
  const p = PropertiesService.getScriptProperties();
  if (Number(p.getProperty('STRAVA_EXPIRES') || 0) - Date.now() > 120e3) return p.getProperty('STRAVA_ACCESS');
  return stravaTokenRequest_({ grant_type: 'refresh_token', refresh_token: p.getProperty('STRAVA_REFRESH') }).access_token;
}

function fetchStrava_(sheet, force) {
  const p = PropertiesService.getScriptProperties();
  const lastRun = Number(p.getProperty('STRAVA_LAST') || 0);
  if (!force && Date.now() - lastRun < STRAVA_MIN_GAP_MS) return;
  const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CARDIO_HEADER.length).getValues() : [];
  // Re-read the last 7 days on each run so edits and late uploads land; first run reads a year.
  const newest = existing.reduce((m, r) => (String(r[1]) > m ? String(r[1]) : m), '');
  const afterMs = newest ? Date.parse(newest.replace(' ', 'T') + ':00') - 7 * 864e5 : Date.now() - 365 * 864e5;
  const token = stravaAccess_();
  const got = [];
  for (let page = 1; page <= 5; page++) {
    const url = 'https://www.strava.com/api/v3/athlete/activities?per_page=100&page=' + page + '&after=' + Math.floor(afterMs / 1000);
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() === 429) throw new Error('Strava rate limit reached; it will try again on a later sync.');
    if (res.getResponseCode() !== 200) throw new Error('Strava returned ' + res.getResponseCode() + '. Reconnect Strava if this keeps happening.');
    const list = JSON.parse(res.getContentText() || '[]');
    got.push.apply(got, list);
    if (list.length < 100) break;
  }
  const rows = got.filter(a => (a.sport_type || a.type) !== 'WeightTraining').map(a => [
    String(a.id),
    String(a.start_date_local || '').slice(0, 16).replace('T', ' '),
    a.sport_type || a.type || '',
    a.name || '',
    Math.round((a.moving_time || 0) / 6) / 10,
    Math.round((a.distance || 0) / 16.09344) / 100,
    Math.round((a.total_elevation_gain || 0) * 3.28084),
    a.average_heartrate ? Math.round(a.average_heartrate) : '',
    a.suffer_score != null ? a.suffer_score : '',
    Math.round((a.elapsed_time || 0) / 6) / 10
  ]);
  const fresh = {};
  rows.forEach(r => fresh[r[0]] = true);
  rewrite_(sheet, CARDIO_HEADER.length, r => r[0] !== '' && !fresh[String(r[0])], rows, 1);
  p.setProperty('STRAVA_LAST', String(Date.now()));
}

function writePlan_(sheet, rows) {
  const clean = rows.filter(r => Array.isArray(r) && r[0]).slice(0, 60)
    .map(r => [String(r[0]).slice(0, 60), String(r[1] == null ? '' : r[1]).slice(0, 5000), PLAN_NOTES[r[0]] || '']);
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, PLAN_HEADER.length).clearContent();
  sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@');
  if (clean.length) sheet.getRange(2, 1, clean.length, PLAN_HEADER.length).setValues(clean);
}

function readPlan_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return { rows: [], rev: '' };
  const tz = Session.getScriptTimeZone();
  const rows = sheet.getRange(2, 1, last - 1, 2).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => {
      let v = r[1];
      if (v instanceof Date) v = v.getFullYear() < 1901 ? Utilities.formatDate(v, tz, 'H:mm') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      return [String(r[0]).trim(), String(v == null ? '' : v).trim()];
    });
  const json = JSON.stringify(rows);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) | 0;
  return { rows: rows, rev: String(h >>> 0) };
}

function readInsights_(sheet) {
  const last = sheet.getLastRow();
  const out = {};
  if (last < 2) return out;
  sheet.getRange(2, 1, last - 1, INSIGHT_HEADER.length).getValues().forEach(r => {
    const id = String(r[0]).trim();
    if (!id || !String(r[3]).trim()) return;
    out[id] = { text: String(r[3]).slice(0, 1200), at: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || '') };
  });
  return out;
}

function readCardio_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const cutoff = Utilities.formatDate(new Date(Date.now() - CARDIO_DAYS * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return sheet.getRange(2, 1, last - 1, CARDIO_HEADER.length).getValues()
    .filter(r => r[0] !== '' && String(r[1]) >= cutoff)
    .map(r => ({ id: String(r[0]), date: String(r[1]), type: String(r[2]), name: String(r[3]), minutes: Number(r[4]) || 0,
      miles: Number(r[5]) || 0, elev_ft: Number(r[6]) || 0, hr: r[7] === '' ? null : Number(r[7]), effort: r[8] === '' ? null : Number(r[8]), elapsed: Number(r[9]) || 0 }));
}
