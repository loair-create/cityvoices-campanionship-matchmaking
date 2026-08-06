/**
 * Companions tab sync — mirrors VolunteersSync but lists Sign Up Form rows where column AQ is NOT TRUE (participants / non-volunteers).
 * Col A: Timestamp from Sign Up Form; Col B: sign-up row; Col C–E: name, phone, email;
 * Col F: Last Contact Date — staff manual on Companions; edits push to Sign Up Form;
 * Col G: Internal Notes — staff manual; edits push to Sign Up Form INTERNAL NOTES;
 * Col H: Internal Status — copied from Sign Up Form (used for Quit highlighting);
 * Col I: Companion ID — stable person key (list order is preserved; new people append at the bottom).
 */

var COMPANIONS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var COMPANIONS_SYNC_TARGET_SHEET = 'Companions';

/** Same as VolunteersSync: AQ = volunteer flag; we INCLUDE rows where this is not TRUE. */
var COMPANIONS_VOLUNTEER_COL_INDEX = 43;

/** Companions sheet: column B = Sign-up row (1-based index 2). */
var COMPANIONS_SIGNUP_ROW_COL = 2;

/** Companions sheet: column F = Last Contact Date (1-based index 6). */
var COMPANIONS_LAST_CONTACT_COL = 6;

/** Companions sheet: column G = Internal Notes (1-based index 7). */
var COMPANIONS_NOTES_COL = 7;

/** Companions sheet: column H = Internal Status (1-based index 8). */
var COMPANIONS_INTERNAL_STATUS_COL = 8;

/** Companions sheet: column I = Companion ID (1-based index 9). */
var COMPANIONS_COMPANION_ID_COL = 9;

var COMPANIONS_HEADER_ROW = [
  'Timestamp',
  'Sign-up row',
  'Name',
  'Phone',
  'Email',
  'Last Contact Date',
  'Internal Notes',
  'Internal Status',
  'Companion ID'
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
 * Syncs the Companions tab from Sign Up Form without reshuffling.
 * Existing people keep their current order; newly eligible people are appended at the bottom.
 */
function syncCompanionsFromSignUpForm() {
  companionsSync_beginSheetWrite_();
  try {
    if (typeof ensureCompanionIds_ === 'function') ensureCompanionIds_();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var src = ss.getSheetByName(COMPANIONS_SYNC_SOURCE_SHEET);
    if (!src) {
      throw new Error('Sheet "' + COMPANIONS_SYNC_SOURCE_SHEET + '" not found.');
    }

    var lastRow = src.getLastRow();
    var lastCol = Math.max(src.getLastColumn(), COMPANIONS_VOLUNTEER_COL_INDEX);
    var tgt = companionsSync_ensureTargetSheet_(ss);
    var numCols = COMPANIONS_HEADER_ROW.length;
    tgt.getRange(1, 1, 1, numCols).setValues([COMPANIONS_HEADER_ROW]);

    if (lastRow < 2) {
      var lrEmpty = tgt.getLastRow();
      if (lrEmpty > 1) {
        tgt.getRange(2, 1, lrEmpty - 1, numCols).clearContent();
      }
      if (typeof applyRosterQuitConditionalFormatting_ === 'function') {
        applyRosterQuitConditionalFormatting_(tgt, COMPANIONS_INTERNAL_STATUS_COL, numCols);
      }
      return;
    }

    var existing = rosterSync_readExistingOrder_(
      COMPANIONS_SYNC_TARGET_SHEET,
      COMPANIONS_SIGNUP_ROW_COL,
      COMPANIONS_NOTES_COL,
      COMPANIONS_COMPANION_ID_COL
    );
    var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = volunteersSync_buildColumnMap_(headers);
    var data = src.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var eligibleByKey = {};
    var formOrder = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (volunteersSync_isVolunteerTrue_(row[COMPANIONS_VOLUNTEER_COL_INDEX - 1])) continue;
      var sheetRow = i + 2;
      var cidHint =
        map.companionId >= 0 && row[map.companionId] != null
          ? String(row[map.companionId]).trim()
          : '';
      var built = rosterSync_buildPersonRow_(
        row,
        map,
        sheetRow,
        existing.staffByKey[cidHint || String(sheetRow)] || existing.staffByKey[String(sheetRow)] || null
      );
      if (!built.key || eligibleByKey[built.key]) continue;
      eligibleByKey[built.key] = built.values;
      formOrder.push(built.key);
    }

    var out = rosterSync_mergeStableOrder_(existing.entries, eligibleByKey, formOrder);
    if (out.length) {
      tgt.getRange(2, 1, out.length, numCols).setValues(out);
    }
    var clearFrom = out.length + 2;
    var prevLast = tgt.getLastRow();
    if (prevLast >= clearFrom) {
      tgt.getRange(clearFrom, 1, prevLast - clearFrom + 1, numCols).clearContent();
    }
    if (typeof applyRosterQuitConditionalFormatting_ === 'function') {
      applyRosterQuitConditionalFormatting_(tgt, COMPANIONS_INTERNAL_STATUS_COL, numCols);
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
 * Reads staff columns F and G from Companions, keyed by Sign-up row (col B).
 */
function companionsSync_readPreservedStaffFields_(ss) {
  var map = {};
  var sh = ss.getSheetByName(COMPANIONS_SYNC_TARGET_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  var lr = sh.getLastRow();
  var rng = sh.getRange(2, 1, lr, COMPANIONS_NOTES_COL);
  var rows = rng.getValues();
  for (var i = 0; i < rows.length; i++) {
    var signupRow = rows[i][COMPANIONS_SIGNUP_ROW_COL - 1];
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
    var cid = String(sh.getRange(r, COMPANIONS_COMPANION_ID_COL).getValue() || '').trim();
    var signup = sh.getRange(r, COMPANIONS_SIGNUP_ROW_COL).getValue();
    var ref = cid || String(signup != null ? signup : '').trim();
    if (!ref) continue;
    var lcCell = sh.getRange(r, COMPANIONS_LAST_CONTACT_COL).getValue();
    var notesCell = sh.getRange(r, COMPANIONS_NOTES_COL).getValue();
    var isoOrEmpty = '';
    if (lcCell instanceof Date) {
      isoOrEmpty = Utilities.formatDate(lcCell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (lcCell != null && String(lcCell).trim() !== '') {
      isoOrEmpty = String(lcCell).trim();
    }
    if (typeof updateCompanionLastContactDate === 'function') {
      updateCompanionLastContactDate(ref, isoOrEmpty);
    }
    if (typeof updateCompanionNote === 'function') {
      updateCompanionNote(ref, notesCell != null ? String(notesCell) : '');
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
 * Pushes Companions columns F (Last Contact Date) and G (Internal Notes) to the Sign Up Form row in column B.
 * Column H (Internal Status) is synced from Sign Up Form; Quit rows are highlighted light brown.
 */
