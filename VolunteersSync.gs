/**
 * Volunteers tab sync (standalone — add this file alongside Code.gs or in a separate Apps Script project
 * bound to the same spreadsheet).
 *
 * When column AQ on "Sign Up Form" is TRUE, that row is listed on the "Volunteers" tab with:
 * Name, Phone, Email (from sheet headers), plus Last Contact Date and Notes from columns D and E.
 */

var VOLUNTEERS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var VOLUNTEERS_SYNC_TARGET_SHEET = 'Volunteers';

/** Column AQ — volunteer flag (TRUE = volunteer). */
var VOLUNTEER_COL_INDEX = 43;

/** Fixed columns per your sheet: D = last contact, E = notes. */
var LAST_CONTACT_FIXED_COL = 4;
var NOTES_FIXED_COL = 5;

var VOLUNTEERS_HEADER_ROW = [
  'Sign-up row',
  'Name',
  'Phone',
  'Email',
  'Last Contact Date',
  'Notes'
];

/**
 * Finds column indices from row 1 headers (same idea as the main dashboard parser).
 */
function volunteersSync_buildColumnMap_(headers) {
  var lower = [];
  for (var i = 0; i < headers.length; i++) {
    lower[i] = String(headers[i] != null ? headers[i] : '').toLowerCase();
  }
  function col(needle) {
    var n = needle.toLowerCase();
    for (var j = 0; j < lower.length; j++) {
      if (lower[j].indexOf(n) !== -1) return j;
    }
    return -1;
  }
  return {
    firstName: col('first name'),
    lastName: col('last name'),
    email: col('email'),
    phone: col('phone number')
  };
}

function volunteersSync_isVolunteerTrue_(cellValue) {
  if (cellValue === true) return true;
  var s = String(cellValue != null ? cellValue : '').trim();
  return s.toUpperCase() === 'TRUE';
}

function volunteersSync_formatCell_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  }
  return String(v);
}

function volunteersSync_fullName_(row, map) {
  var fn = map.firstName >= 0 && map.firstName < row.length ? row[map.firstName] : '';
  var ln = map.lastName >= 0 && map.lastName < row.length ? row[map.lastName] : '';
  fn = fn != null ? String(fn).trim() : '';
  ln = ln != null ? String(ln).trim() : '';
  if (fn && ln) return fn + ' ' + ln;
  return fn || ln || '';
}

/**
 * Rebuilds the entire "Volunteers" tab from "Sign Up Form".
 * Safe to run manually (Run → syncVolunteersFromSignUpForm) or from onEdit.
 */
function syncVolunteersFromSignUpForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(VOLUNTEERS_SYNC_SOURCE_SHEET);
  if (!src) {
    throw new Error('Sheet "' + VOLUNTEERS_SYNC_SOURCE_SHEET + '" not found.');
  }

  var lastRow = src.getLastRow();
  var lastCol = Math.max(src.getLastColumn(), VOLUNTEER_COL_INDEX);
  if (lastRow < 2) {
    var emptyTgt = volunteersSync_ensureTargetSheet_(ss);
    var nc = VOLUNTEERS_HEADER_ROW.length;
    emptyTgt.getRange(1, 1, 1, nc).setValues([VOLUNTEERS_HEADER_ROW]);
    var lrEmpty = emptyTgt.getLastRow();
    if (lrEmpty > 1) {
      /** getRange(row, col, numRows, numCols) — third arg is row COUNT, not last row index. */
      emptyTgt.getRange(2, 1, lrEmpty - 1, nc).clearContent();
    }
    return;
  }

  var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = volunteersSync_buildColumnMap_(headers);

  var data = src.getRange(2, 1, lastRow, lastCol).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var aqIdx = VOLUNTEER_COL_INDEX - 1;
    if (!volunteersSync_isVolunteerTrue_(row[aqIdx])) continue;

    var sheetRow = i + 2;
    var name = volunteersSync_fullName_(row, map);
    var phoneIdx = map.phone;
    var emailIdx = map.email;
    var phone = phoneIdx >= 0 && phoneIdx < row.length ? row[phoneIdx] : '';
    var email = emailIdx >= 0 && emailIdx < row.length ? row[emailIdx] : '';

    var lastContactIdx = LAST_CONTACT_FIXED_COL - 1;
    var notesIdx = NOTES_FIXED_COL - 1;
    var lastContact = lastContactIdx < row.length ? row[lastContactIdx] : '';
    var notes = notesIdx < row.length ? row[notesIdx] : '';

    out.push([
      sheetRow,
      name,
      phone != null ? String(phone) : '',
      email != null ? String(email) : '',
      volunteersSync_formatCell_(lastContact),
      notes != null ? String(notes) : ''
    ]);
  }

  var tgt = volunteersSync_ensureTargetSheet_(ss);
  var numCols = VOLUNTEERS_HEADER_ROW.length;
  tgt.getRange(1, 1, 1, numCols).setValues([VOLUNTEERS_HEADER_ROW]);
  if (out.length) {
    /** getRange(row, col, numRows, numCols) — use out.length rows starting at row 2. */
    tgt.getRange(2, 1, out.length, numCols).setValues(out);
  }
  var clearFrom = out.length + 2;
  var prevLast = tgt.getLastRow();
  if (prevLast >= clearFrom) {
    var numClearRows = prevLast - clearFrom + 1;
    tgt.getRange(clearFrom, 1, numClearRows, numCols).clearContent();
  }
}

function volunteersSync_ensureTargetSheet_(ss) {
  var sh = ss.getSheetByName(VOLUNTEERS_SYNC_TARGET_SHEET);
  if (!sh) {
    sh = ss.insertSheet(VOLUNTEERS_SYNC_TARGET_SHEET);
  }
  return sh;
}

/**
 * Sync whenever someone edits the sign-up sheet (manual edits only; Form rows may not fire this—use onChange).
 */
function onEditVolunteersSync(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== VOLUNTEERS_SYNC_SOURCE_SHEET) return;
  syncVolunteersFromSignUpForm();
}

/**
 * Recommended for Google Form responses: new rows + edits. Skips FORMAT-only changes.
 * Wire this to an installable trigger: Spreadsheet → On change.
 */
function onChangeVolunteersSync(e) {
  if (!e) return;
  if (e.changeType === SpreadsheetApp.ChangeType.FORMAT) return;
  syncVolunteersFromSignUpForm();
}

/**
 * TRIGGER SETUP (Apps Script UI)
 * 1. Open the spreadsheet → Extensions → Apps Script.
 * 2. Left sidebar: clock icon “Triggers”.
 * 3. “Add Trigger” (bottom right).
 * 4. Primary flow (new Form rows):
 *    - Function: onChangeVolunteersSync
 *    - Event source: From spreadsheet
 *    - Event type: On change
 * 5. Optional second trigger (manual cell edits on Sign Up Form only):
 *    - Function: onEditVolunteersSync
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 6. Save. First run may prompt authorization.
 */
