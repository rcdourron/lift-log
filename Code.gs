/**
 * Lift Log → Google Sheets sync.
 *
 * Paste this whole file into Extensions → Apps Script in your "Lift Log" Google Sheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Paste the Web app URL into Lift Log → Data → Google Sheets sync.
 *
 * Security: the first copy of Lift Log that connects registers a random key with this
 * script. After that, requests without that key are refused, even from someone who has the URL.
 */

const TABS = { workouts: 'Workouts', sets: 'Sets', templates: 'Templates' };
const WORKOUT_HEADER = ['id', 'date', 'name', 'source', 'template', 'minutes', 'sets', 'volume_lb', 'notes', 'updated_at', 'json'];
const SET_HEADER = ['workout_id', 'date', 'workout', 'exercise', 'set', 'type', 'weight_lb', 'reps', 'seconds', 'distance', 'rpe', 'note', 'source'];
const TEMPLATE_HEADER = ['id', 'order', 'name', 'summary', 'json'];

function doGet(e) {
  const token = (e && e.parameter && e.parameter.token) || '';
  return respond_(handle_({ op: 'ping', token: token }));
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

    if (req.op === 'ping') return { ok: true, templates: readTemplates_(sh.templates) };

    if (req.op === 'sync') {
      const upserts = req.upserts || [];
      const strong = Array.isArray(req.strong) ? req.strong : null;
      const drop = {};
      (req.deletes || []).forEach(id => drop[id] = true);
      upserts.forEach(u => drop[u.id] = true);

      const keep = (row, idCol, srcCol) => !drop[String(row[idCol])] && !(strong && row[srcCol] === 'strong');
      const all = upserts.concat(strong || []);
      rewrite_(sh.workouts, WORKOUT_HEADER.length, r => keep(r, 0, 3), all.map(u => u.wrow), 1);
      rewrite_(sh.sets, SET_HEADER.length, r => keep(r, 0, 12), [].concat.apply([], all.map(u => u.srows || [])), 1);

      if (Array.isArray(req.templates) && req.templates.length && readTemplates_(sh.templates).length === 0) {
        writeTemplates_(sh.templates, req.templates);
      }
      return { ok: true, wrote: all.length, templates: readTemplates_(sh.templates) };
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
    templates: get(TABS.templates, TEMPLATE_HEADER, [1, 5])
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
  const rows = templates.map(t => [t.id, t.order || 0, t.name || '', t.summary || '', JSON.stringify(t)]);
  sheet.getRange(2, 1, rows.length, TEMPLATE_HEADER.length).setValues(rows);
}
