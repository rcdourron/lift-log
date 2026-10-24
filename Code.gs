/** @OnlyCurrentDoc */
/**
 * Lift Log → Google Sheets sync (and optional Strava cardio).
 *
 * Paste this whole file into Extensions → Apps Script in your "Lift Log" Google Sheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Paste the Web app URL into Lift Log → Data → Google Sheets sync.
 *
 * Security: the first copy of Lift Log that connects registers a random key with this
 * script. After that, requests without that key are refused, even from someone who has the URL.
 * Strava credentials (if you connect Strava) are kept in this script's properties, never in the app.
 */

const TABS = { workouts: 'Workouts', sets: 'Sets', templates: 'Templates', cardio: 'Cardio' };
const WORKOUT_HEADER = ['id', 'date', 'name', 'source', 'template', 'minutes', 'sets', 'volume_lb', 'notes', 'updated_at', 'json'];
const SET_HEADER = ['workout_id', 'date', 'workout', 'exercise', 'set', 'type', 'weight_lb', 'reps', 'seconds', 'distance', 'rpe', 'note', 'source'];
const TEMPLATE_HEADER = ['id', 'order', 'name', 'summary', 'json'];
const CARDIO_HEADER = ['id', 'date', 'type', 'name', 'minutes', 'distance_mi', 'elevation_ft', 'avg_hr', 'effort', 'elapsed_min'];
const CARDIO_DAYS = 400;            // how far back the app receives cardio
const STRAVA_MIN_GAP_MS = 5 * 60e3; // don't call Strava more often than this

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

      let cardio = null;
      if (req.cardio !== false && props.getProperty('STRAVA_REFRESH')) {
        try { fetchStrava_(sh.cardio, !!req.forceCardio); props.deleteProperty('STRAVA_ERROR'); }
        catch (err) { props.setProperty('STRAVA_ERROR', String(err && err.message || err).slice(0, 300)); }
      }
      if (req.cardio !== false) cardio = readCardio_(sh.cardio);

      return { ok: true, wrote: all.length, templates: readTemplates_(sh.templates), cardio: cardio, strava: stravaStatus_() };
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
    cardio: get(TABS.cardio, CARDIO_HEADER, [1, 2])
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

function readCardio_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const cutoff = Utilities.formatDate(new Date(Date.now() - CARDIO_DAYS * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return sheet.getRange(2, 1, last - 1, CARDIO_HEADER.length).getValues()
    .filter(r => r[0] !== '' && String(r[1]) >= cutoff)
    .map(r => ({ id: String(r[0]), date: String(r[1]), type: String(r[2]), name: String(r[3]), minutes: Number(r[4]) || 0,
      miles: Number(r[5]) || 0, elev_ft: Number(r[6]) || 0, hr: r[7] === '' ? null : Number(r[7]), effort: r[8] === '' ? null : Number(r[8]) }));
}
