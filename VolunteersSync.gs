/**
 * Volunteers tab sync (standalone — add this file alongside Code.gs or in a separate Apps Script project
 * bound to the same spreadsheet).
 *
 * When column AQ on "Sign Up Form" is TRUE, that row is listed on the "Volunteers" tab:
 * Col A: Timestamp from Sign Up Form; Col B: sign-up row; Col C–E: name, phone, email;
 * Col F: Last Contact Date — staff manual; edits push to Sign Up Form "Last Contact Date" column;
 * Col G: Internal Notes — staff manual; edits push to Sign Up Form INTERNAL NOTES.
 */

var VOLUNTEERS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var VOLUNTEERS_SYNC_TARGET_SHEET = 'Volunteers';

/** Column AQ — volunteer flag (TRUE = volunteer). */
var VOLUNTEER_COL_INDEX = 43;

/** Volunteers sheet: column B = Sign-up row (1-based index 2). */
var VOLUNTEERS_SIGNUP_ROW_COL = 2;

/** Volunteers sheet: column F = Last Contact Date (1-based index 6). */
var VOLUNTEERS_LAST_CONTACT_COL = 6;

/** Volunteers sheet: column G = Internal Notes (1-based index 7). */
var VOLUNTEERS_NOTES_COL = 7;

var VOLUNTEERS_HEADER_ROW = [
  'Timestamp',
  'Sign-up row',
  'Name',
  'Phone',
  'Email',
  'Last Contact Date',
  'Internal Notes'
];

/** Prevents onEditVolunteersStaffFields from firing while this script is rewriting the Volunteers tab. */
var VOLUNTEERS_SYNC_CACHE_GUARD_KEY = 'volunteers_sheet_sync_guard';

function volunteersSync_beginSheetWrite_() {
  CacheService.getScriptCache().put(VOLUNTEERS_SYNC_CACHE_GUARD_KEY, '1', 120);
}

function volunteersSync_endSheetWrite_() {
  CacheService.getScriptCache().remove(VOLUNTEERS_SYNC_CACHE_GUARD_KEY);
}

function volunteersSync_isSheetWriteInProgress_() {
  var v = CacheService.getScriptCache().get(VOLUNTEERS_SYNC_CACHE_GUARD_KEY);
  return !!(v && String(v) === '1');
}

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
  function colFirst(needles) {
    for (var k = 0; k < needles.length; k++) {
      var idx = col(needles[k]);
      if (idx >= 0) return idx;
    }
    return -1;
  }
  return {
    firstName: col('first name'),
    lastName: col('last name'),
    email: col('email'),
    phone: col('phone number'),
    timestamp: colFirst(['timestamp', 'enrollment date', 'date enrolled', 'sign up date'])
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
  volunteersSync_beginSheetWrite_();
  try {
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
        emptyTgt.getRange(2, 1, lrEmpty - 1, nc).clearContent();
      }
      return;
    }

    var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = volunteersSync_buildColumnMap_(headers);

    var preservedStaff = volunteersSync_readPreservedStaffFields_(ss);

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

      var key = String(sheetRow);
      var staff = preservedStaff[key];
      var lcOut = '';
      var notesOut = '';
      if (staff) {
        if (staff.lastContact != null && staff.lastContact !== '') {
          lcOut =
            staff.lastContact instanceof Date
              ? volunteersSync_formatCell_(staff.lastContact)
              : String(staff.lastContact);
        }
        if (staff.internalNotes != null) {
          notesOut = String(staff.internalNotes);
        }
      }

      var tsIdx = map.timestamp;
      var ts = tsIdx >= 0 && tsIdx < row.length ? row[tsIdx] : '';
      out.push([
        volunteersSync_formatCell_(ts),
        sheetRow,
        name,
        phone != null ? String(phone) : '',
        email != null ? String(email) : '',
        lcOut,
        notesOut
      ]);
    }

    var tgt = volunteersSync_ensureTargetSheet_(ss);
    var numCols = VOLUNTEERS_HEADER_ROW.length;
    tgt.getRange(1, 1, 1, numCols).setValues([VOLUNTEERS_HEADER_ROW]);
    if (out.length) {
      tgt.getRange(2, 1, out.length, numCols).setValues(out);
    }
    var clearFrom = out.length + 2;
    var prevLast = tgt.getLastRow();
    if (prevLast >= clearFrom) {
      var numClearRows = prevLast - clearFrom + 1;
      tgt.getRange(clearFrom, 1, numClearRows, numCols).clearContent();
    }
  } finally {
    volunteersSync_endSheetWrite_();
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
 * Reads staff columns F (Last Contact) and G (Internal Notes) keyed by Sign-up row (col B).
 */
function volunteersSync_readPreservedStaffFields_(ss) {
  var map = {};
  var sh = ss.getSheetByName(VOLUNTEERS_SYNC_TARGET_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  var lr = sh.getLastRow();
  var rng = sh.getRange(2, 1, lr, VOLUNTEERS_NOTES_COL);
  var rows = rng.getValues();
  for (var i = 0; i < rows.length; i++) {
    var signupRow = rows[i][VOLUNTEERS_SIGNUP_ROW_COL - 1];
    if (signupRow == null || signupRow === '') continue;
    var key = String(signupRow).trim();
    if (!key) continue;
    var lcIdx = VOLUNTEERS_LAST_CONTACT_COL - 1;
    var notesIdx = VOLUNTEERS_NOTES_COL - 1;
    map[key] = {
      lastContact: lcIdx < rows[i].length ? rows[i][lcIdx] : '',
      internalNotes: notesIdx < rows[i].length && rows[i][notesIdx] != null ? String(rows[i][notesIdx]) : ''
    };
  }
  return map;
}

/**
 * Push Volunteers E/F edits to Sign Up Form (requires Code.gs: updateCompanionLastContactDate, updateCompanionNote).
 * Wire to installable trigger: From spreadsheet → On edit (all sheets; handler returns unless sheet is Volunteers).
 */
function onEditVolunteersStaffFields(e) {
  if (!e || !e.range) return;
  if (volunteersSync_isSheetWriteInProgress_()) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== VOLUNTEERS_SYNC_TARGET_SHEET) return;
  var c0 = e.range.getColumn();
  var cLast = e.range.getLastColumn();
  if (cLast < VOLUNTEERS_LAST_CONTACT_COL || c0 > VOLUNTEERS_NOTES_COL) return;
  var r0 = e.range.getRow();
  var rLast = e.range.getLastRow();
  if (rLast < 2) return;

  for (var r = Math.max(2, r0); r <= rLast; r++) {
    var signup = sh.getRange(r, VOLUNTEERS_SIGNUP_ROW_COL).getValue();
    var rn = parseInt(String(signup != null ? signup : '').trim(), 10);
    if (isNaN(rn) || rn < 2) continue;
    var lcCell = sh.getRange(r, VOLUNTEERS_LAST_CONTACT_COL).getValue();
    var notesCell = sh.getRange(r, VOLUNTEERS_NOTES_COL).getValue();
    var isoOrEmpty = '';
    if (lcCell instanceof Date) {
      isoOrEmpty = Utilities.formatDate(lcCell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (lcCell != null && String(lcCell).trim() !== '') {
      isoOrEmpty = String(lcCell).trim();
    }
    if (typeof updateCompanionLastContactDate === 'function') {
      updateCompanionLastContactDate(String(rn), isoOrEmpty);
    }
    if (typeof updateCompanionNote === 'function') {
      updateCompanionNote(String(rn), notesCell != null ? String(notesCell) : '');
    }
  }
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
  if (typeof processNewSignUpFormNotifications_ === 'function') {
    processNewSignUpFormNotifications_();
  }
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
 * 6. Volunteers staff fields (Last Contact + Internal Notes, columns F & G) → Sign Up Form:
 *    - Function: onEditVolunteersStaffFields
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 7. Companions staff fields (Last Contact + Internal Notes, columns F & G) → Sign Up Form:
 *    - Function: onEditCompanionsStaffFields (in CompanionsSync.gs)
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 8. Save. First run may prompt authorization.
 *
 * **Sign-up email alerts:** When SignUpFormNotify.gs is in the project, the same On change trigger
 * emails danfrey176@gmail.com (or SIGNUP_NOTIFY_TO_EMAIL script property) for each new form row.
 *
 * If **CompanionsSync.gs** is present, these handlers also refresh the **Companions** tab (non-volunteers).
 */
