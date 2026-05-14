/**
 * Companions tab sync — mirrors VolunteersSync but lists Sign Up Form rows where column AQ is NOT TRUE (participants / non-volunteers).
 * Col A–D: sign-up row, name, phone, email from Sign Up Form;
 * Col E: Last Contact Date — staff manual on Companions; edits push to Sign Up Form;
 * Col F: Internal Notes — staff manual; edits push to Sign Up Form INTERNAL NOTES.
 */

var COMPANIONS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var COMPANIONS_SYNC_TARGET_SHEET = 'Companions';

/** Same as VolunteersSync: AQ = volunteer flag; we INCLUDE rows where this is not TRUE. */
var COMPANIONS_VOLUNTEER_COL_INDEX = 43;

/** Companions sheet: column E = Last Contact Date (1-based index 5). */
var COMPANIONS_LAST_CONTACT_COL = 5;

/** Companions sheet: column F = Internal Notes (1-based index 6). */
var COMPANIONS_NOTES_COL = 6;

var COMPANIONS_HEADER_ROW = [
  'Sign-up row',
  'Name',
  'Phone',
  'Email',
  'Last Contact Date',
  'Internal Notes'
];

/** Prevents onEditCompanionsStaffFields from firing while this script is rewriting the Companions tab. */
var COMPANIONS_SYNC_CACHE_GUARD_KEY = 'companions_sheet_sync_guard';

function companionsSync_beginSheetWrite_() {
  CacheService.getScriptCache().put(COMPANIONS_SYNC_CACHE_GUARD_KEY, '1', 120);
}

function companionsSync_endSheetWrite_() {
  CacheService.getScriptCache().remove(COMPANIONS_SYNC_CACHE_GUARD_KEY);
}

function companionsSync_isSheetWriteInProgress_() {
  var v = CacheService.getScriptCache().get(COMPANIONS_SYNC_CACHE_GUARD_KEY);
  return !!(v && String(v) === '1');
}

/**
 * Rebuilds the "Companions" tab from everyone on Sign Up Form who is not a volunteer (AQ ≠ TRUE).
 */
function syncCompanionsFromSignUpForm() {
  companionsSync_beginSheetWrite_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var src = ss.getSheetByName(COMPANIONS_SYNC_SOURCE_SHEET);
    if (!src) {
      throw new Error('Sheet "' + COMPANIONS_SYNC_SOURCE_SHEET + '" not found.');
    }

    var lastRow = src.getLastRow();
    var lastCol = Math.max(src.getLastColumn(), COMPANIONS_VOLUNTEER_COL_INDEX);

    if (lastRow < 2) {
      var emptyTgt = companionsSync_ensureTargetSheet_(ss);
      var nc = COMPANIONS_HEADER_ROW.length;
      emptyTgt.getRange(1, 1, 1, nc).setValues([COMPANIONS_HEADER_ROW]);
      var lrEmpty = emptyTgt.getLastRow();
      if (lrEmpty > 1) {
        emptyTgt.getRange(2, 1, lrEmpty - 1, nc).clearContent();
      }
      return;
    }

    var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = volunteersSync_buildColumnMap_(headers);
    var preservedStaff = companionsSync_readPreservedStaffFields_(ss);

    var data = src.getRange(2, 1, lastRow, lastCol).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var aqIdx = COMPANIONS_VOLUNTEER_COL_INDEX - 1;
      if (volunteersSync_isVolunteerTrue_(row[aqIdx])) continue;

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

      out.push([
        sheetRow,
        name,
        phone != null ? String(phone) : '',
        email != null ? String(email) : '',
        lcOut,
        notesOut
      ]);
    }

    var tgt = companionsSync_ensureTargetSheet_(ss);
    var numCols = COMPANIONS_HEADER_ROW.length;
    tgt.getRange(1, 1, 1, numCols).setValues([COMPANIONS_HEADER_ROW]);
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
    companionsSync_endSheetWrite_();
  }
}

function companionsSync_ensureTargetSheet_(ss) {
  var sh = ss.getSheetByName(COMPANIONS_SYNC_TARGET_SHEET);
  if (!sh) {
    sh = ss.insertSheet(COMPANIONS_SYNC_TARGET_SHEET);
  }
  return sh;
}

/**
 * Reads staff columns E and F from Companions, keyed by Sign-up row (col A).
 */
function companionsSync_readPreservedStaffFields_(ss) {
  var map = {};
  var sh = ss.getSheetByName(COMPANIONS_SYNC_TARGET_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  var lr = sh.getLastRow();
  var rng = sh.getRange(2, 1, lr, COMPANIONS_NOTES_COL);
  var rows = rng.getValues();
  for (var i = 0; i < rows.length; i++) {
    var signupRow = rows[i][0];
    if (signupRow == null || signupRow === '') continue;
    var key = String(signupRow).trim();
    if (!key) continue;
    var lcIdx = COMPANIONS_LAST_CONTACT_COL - 1;
    var notesIdx = COMPANIONS_NOTES_COL - 1;
    map[key] = {
      lastContact: lcIdx < rows[i].length ? rows[i][lcIdx] : '',
      internalNotes: notesIdx < rows[i].length && rows[i][notesIdx] != null ? String(rows[i][notesIdx]) : ''
    };
  }
  return map;
}

/**
 * Push Companions E/F edits to Sign Up Form (requires Code.gs: updateCompanionLastContactDate, updateCompanionNote).
 * Add installable trigger: From spreadsheet → On edit → function onEditCompanionsStaffFields.
 */
function onEditCompanionsStaffFields(e) {
  if (!e || !e.range) return;
  if (companionsSync_isSheetWriteInProgress_()) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== COMPANIONS_SYNC_TARGET_SHEET) return;
  var c0 = e.range.getColumn();
  var cLast = e.range.getLastColumn();
  if (cLast < COMPANIONS_LAST_CONTACT_COL || c0 > COMPANIONS_NOTES_COL) return;
  var r0 = e.range.getRow();
  var rLast = e.range.getLastRow();
  if (rLast < 2) return;

  for (var r = Math.max(2, r0); r <= rLast; r++) {
    var signup = sh.getRange(r, 1).getValue();
    var rn = parseInt(String(signup != null ? signup : '').trim(), 10);
    if (isNaN(rn) || rn < 2) continue;
    var lcCell = sh.getRange(r, COMPANIONS_LAST_CONTACT_COL).getValue();
    var notesCell = sh.getRange(r, COMPANIONS_NOTES_COL).getValue();
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
 * Run Volunteers sync then Companions sync (one menu/trigger for both roster tabs).
 */
function syncVolunteersAndCompanionsFromSignUpForm() {
  syncVolunteersFromSignUpForm();
  syncCompanionsFromSignUpForm();
}

/**
 * TRIGGER: On edit → onEditCompanionsStaffFields (same pattern as onEditVolunteersStaffFields in VolunteersSync.gs).
 * Pushes Companions columns E (Last Contact Date) and F (Internal Notes) to the Sign Up Form row in column A.
 */
