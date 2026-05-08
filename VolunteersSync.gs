/**
 * Volunteers tab sync (standalone — add this file alongside Code.gs or in a separate Apps Script project
 * bound to the same spreadsheet).
 *
 * When column AQ on "Sign Up Form" is TRUE, that row is listed on the "Volunteers" tab:
 * Col A–D: sign-up row, name, phone, email; Col E: Last Contact Date (from Sign Up Form column AR);
 * Col F: Notes — left blank for new rows; existing manual notes are kept when re-syncing.
 */

var VOLUNTEERS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var VOLUNTEERS_SYNC_TARGET_SHEET = 'Volunteers';

/** Column AQ — volunteer flag (TRUE = volunteer). */
var VOLUNTEER_COL_INDEX = 43;

/** Column AR on Sign Up Form — per-person last contact date (matches staff tracking). */
var LAST_CONTACT_SIGNUP_COL = 44;

/** Volunteers sheet: column index for Notes (F); manual entry, preserved across syncs when possible. */
var VOLUNTEERS_NOTES_COL = 6;

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
  var lastCol = Math.max(src.getLastColumn(), VOLUNTEER_COL_INDEX, LAST_CONTACT_SIGNUP_COL);
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

  /** Keep manual Notes already typed on the Volunteers sheet (column F). Key = sign-up row number string. */
  var preservedNotesBySignupRow = volunteersSync_readPreservedNotes_(ss);

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

    var lcIdx = LAST_CONTACT_SIGNUP_COL - 1;
    var lastContact = lcIdx < row.length ? row[lcIdx] : '';
    var notesManual = preservedNotesBySignupRow[String(sheetRow)];
    var notesOut = notesManual != null && notesManual !== '' ? notesManual : '';

    out.push([
      sheetRow,
      name,
      phone != null ? String(phone) : '',
      email != null ? String(email) : '',
      volunteersSync_formatCell_(lastContact),
      notesOut
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
 * Reads column F (Notes) from the current Volunteers sheet keyed by Sign-up row (col A), so re-sync does not wipe manual notes.
 */
function volunteersSync_readPreservedNotes_(ss) {
  var map = {};
  var sh = ss.getSheetByName(VOLUNTEERS_SYNC_TARGET_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  var lr = sh.getLastRow();
  var rng = sh.getRange(2, 1, lr, VOLUNTEERS_NOTES_COL);
  var rows = rng.getValues();
  for (var i = 0; i < rows.length; i++) {
    var signupRow = rows[i][0];
    var noteVal = rows[i][VOLUNTEERS_NOTES_COL - 1];
    if (signupRow == null || signupRow === '') continue;
    var key = String(signupRow).trim();
    if (!key) continue;
    if (noteVal != null && String(noteVal).trim() !== '') {
      map[key] = String(noteVal);
    }
  }
  return map;
}

/**
 * Sync whenever someone edits the sign-up sheet (manual edits only; Form rows may not fire this—use onChange).
 */
function onEditVolunteersSync(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== VOLUNTEERS_SYNC_SOURCE_SHEET) return;
  syncVolunteersFromSignUpForm();
  if (typeof syncCompanionsFromSignUpForm === 'function') {
    syncCompanionsFromSignUpForm();
  }
}

/**
 * Recommended for Google Form responses: new rows + edits. Skips FORMAT-only changes.
 * Wire this to an installable trigger: Spreadsheet → On change.
 */
function onChangeVolunteersSync(e) {
  if (!e) return;
  if (e.changeType === SpreadsheetApp.ChangeType.FORMAT) return;
  syncVolunteersFromSignUpForm();
  if (typeof syncCompanionsFromSignUpForm === 'function') {
    syncCompanionsFromSignUpForm();
  }
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
 *
 * If **CompanionsSync.gs** is present, these handlers also refresh the **Companions** tab (non-volunteers).
 */
