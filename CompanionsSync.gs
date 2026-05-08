/**
 * Companions tab sync — mirrors VolunteersSync but lists Sign Up Form rows where column AQ is NOT TRUE (participants / non-volunteers).
 * Same columns: Sign-up row, Name, Phone, Email, Last Contact Date (AR), Notes (manual, preserved on re-sync).
 */

var COMPANIONS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var COMPANIONS_SYNC_TARGET_SHEET = 'Companions';

/** Same as VolunteersSync: AQ = volunteer flag; we INCLUDE rows where this is not TRUE. */
var COMPANIONS_VOLUNTEER_COL_INDEX = 43;

/** Column AR — last contact on sign-up sheet. */
var COMPANIONS_LAST_CONTACT_SIGNUP_COL = 44;

/** Companions sheet column F = Notes. */
var COMPANIONS_NOTES_COL = 6;

var COMPANIONS_HEADER_ROW = [
  'Sign-up row',
  'Name',
  'Phone',
  'Email',
  'Last Contact Date',
  'Notes'
];

/**
 * Rebuilds the "Companions" tab from everyone on Sign Up Form who is not a volunteer (AQ ≠ TRUE).
 */
function syncCompanionsFromSignUpForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(COMPANIONS_SYNC_SOURCE_SHEET);
  if (!src) {
    throw new Error('Sheet "' + COMPANIONS_SYNC_SOURCE_SHEET + '" not found.');
  }

  var lastRow = src.getLastRow();
  var lastCol = Math.max(
    src.getLastColumn(),
    COMPANIONS_VOLUNTEER_COL_INDEX,
    COMPANIONS_LAST_CONTACT_SIGNUP_COL
  );

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
  var preservedNotes = companionsSync_readPreservedNotes_(ss);

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

    var lcIdx = COMPANIONS_LAST_CONTACT_SIGNUP_COL - 1;
    var lastContact = lcIdx < row.length ? row[lcIdx] : '';
    var notesManual = preservedNotes[String(sheetRow)];
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
}

function companionsSync_ensureTargetSheet_(ss) {
  var sh = ss.getSheetByName(COMPANIONS_SYNC_TARGET_SHEET);
  if (!sh) {
    sh = ss.insertSheet(COMPANIONS_SYNC_TARGET_SHEET);
  }
  return sh;
}

function companionsSync_readPreservedNotes_(ss) {
  var map = {};
  var sh = ss.getSheetByName(COMPANIONS_SYNC_TARGET_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  var lr = sh.getLastRow();
  var rows = sh.getRange(2, 1, lr, COMPANIONS_NOTES_COL).getValues();
  for (var i = 0; i < rows.length; i++) {
    var signupRow = rows[i][0];
    var noteVal = rows[i][COMPANIONS_NOTES_COL - 1];
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
 * Run Volunteers sync then Companions sync (one menu/trigger for both roster tabs).
 */
function syncVolunteersAndCompanionsFromSignUpForm() {
  syncVolunteersFromSignUpForm();
  syncCompanionsFromSignUpForm();
}
