/**
 * Volunteers tab sync (standalone — add this file alongside Code.gs or in a separate Apps Script project
 * bound to the same spreadsheet).
 *
 * When column AQ on "Sign Up Form" is TRUE, that row is listed on the "Volunteers" tab:
 * Col A: Timestamp from Sign Up Form; Col B: sign-up row; Col C–E: name, phone, email;
 * Col F: Last Contact Date — staff manual; edits push to Sign Up Form "Last Contact Date" column;
 * Col G: Internal Notes — staff manual; edits push to Sign Up Form INTERNAL NOTES;
 * Col H: Internal Status — editable (Active / Quit / Unresponsive / Dismissed); edits push to Sign Up Form; status rows highlight (Quit brown, Unresponsive orange, Dismissed red);
 * Col I: Companion ID — stable person key (list order is preserved; new people append at the bottom).
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

/** Volunteers sheet: column H = Internal Status (1-based index 8). */
var VOLUNTEERS_INTERNAL_STATUS_COL = 8;

/** Volunteers sheet: column I = Companion ID (1-based index 9). */
var VOLUNTEERS_COMPANION_ID_COL = 9;

/** Light brown / orange / red row highlights by Internal Status. */
var ROSTER_QUIT_HIGHLIGHT_COLOR = '#E8D4C4';
var ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR = '#FED7AA';
var ROSTER_DISMISSED_HIGHLIGHT_COLOR = '#FECACA';

var VOLUNTEERS_HEADER_ROW = [
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
    timestamp: colFirst(['timestamp', 'enrollment date', 'date enrolled', 'sign up date']),
    lastContactDate: colFirst([
      'last contact date',
      'last contact',
      'contact date',
      'date of last contact'
    ]),
    internalNotes: col('internal notes'),
    internalStatus: colFirst([
      'internal status',
      'staff status',
      'companion status',
      'program status'
    ]),
    companionId: colFirst(['companion id'])
  };
}

/**
 * One roster row array (A–I) from a Sign Up Form data row.
 * @param {Array} row
 * @param {Object} map
 * @param {number} sheetRow
 * @param {Object|null} staff preserved F/G from the roster tab
 * @return {Array}
 */
function rosterSync_buildPersonRow_(row, map, sheetRow, staff) {
  var name = volunteersSync_fullName_(row, map);
  var phoneIdx = map.phone;
  var emailIdx = map.email;
  var phone = phoneIdx >= 0 && phoneIdx < row.length ? row[phoneIdx] : '';
  var email = emailIdx >= 0 && emailIdx < row.length ? row[emailIdx] : '';

  var lcFromForm =
    map.lastContactDate >= 0 && map.lastContactDate < row.length ? row[map.lastContactDate] : '';
  var notesFromForm =
    map.internalNotes >= 0 && map.internalNotes < row.length ? row[map.internalNotes] : '';
  var statusFromForm =
    map.internalStatus >= 0 && map.internalStatus < row.length ? row[map.internalStatus] : '';
  var cidFromForm =
    map.companionId >= 0 && map.companionId < row.length
      ? String(row[map.companionId] != null ? row[map.companionId] : '').trim()
      : '';
  // Fall back to sign-up row only when Companion ID is missing (should be rare after ensureCompanionIds_).
  var personKey = cidFromForm || String(sheetRow);

  var lcOut = '';
  if (lcFromForm != null && lcFromForm !== '') {
    lcOut = volunteersSync_formatCell_(lcFromForm);
  } else if (staff && staff.lastContact != null && staff.lastContact !== '') {
    lcOut =
      staff.lastContact instanceof Date
        ? volunteersSync_formatCell_(staff.lastContact)
        : String(staff.lastContact);
  }

  var notesOut = '';
  if (notesFromForm != null && String(notesFromForm).trim() !== '') {
    notesOut = String(notesFromForm);
  } else if (staff && staff.internalNotes != null) {
    notesOut = String(staff.internalNotes);
  }

  var statusOut = '';
  if (statusFromForm != null && String(statusFromForm).trim() !== '') {
    statusOut = String(statusFromForm).trim();
  } else if (staff && staff.internalStatus != null && String(staff.internalStatus).trim() !== '') {
    statusOut = String(staff.internalStatus).trim();
  }
  var tsIdx = map.timestamp;
  var ts = tsIdx >= 0 && tsIdx < row.length ? row[tsIdx] : '';

  return {
    key: personKey,
    values: [
      volunteersSync_formatCell_(ts),
      sheetRow,
      name,
      phone != null ? String(phone) : '',
      email != null ? String(email) : '',
      lcOut,
      notesOut,
      statusOut,
      personKey
    ]
  };
}

/**
 * Existing roster order + staff F/G.
 * Each entry keeps the sheet's row identity so first upgrades can rematch by email/name.
 * @return {{ entries: Array<{key:string, email:string, name:string}>, staffByKey: Object }}
 */
function rosterSync_readExistingOrder_(sheetName, signupRowCol, notesCol, companionIdCol) {
  var entries = [];
  var staffByKey = {};
  var seen = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return { entries: entries, staffByKey: staffByKey };

  var lr = sh.getLastRow();
  var width = Math.max(sh.getLastColumn(), companionIdCol || notesCol, 5);
  var rows = sh.getRange(2, 1, lr - 1, width).getValues();
  for (var i = 0; i < rows.length; i++) {
    var cid =
      companionIdCol && companionIdCol - 1 < rows[i].length
        ? String(rows[i][companionIdCol - 1] != null ? rows[i][companionIdCol - 1] : '').trim()
        : '';
    var signup = String(rows[i][signupRowCol - 1] != null ? rows[i][signupRowCol - 1] : '').trim();
    var key = cid || signup;
    if (!key || seen[key]) continue;
    seen[key] = true;
    var email = String(rows[i][4] != null ? rows[i][4] : '')
      .trim()
      .toLowerCase();
    var name = String(rows[i][2] != null ? rows[i][2] : '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    entries.push({ key: key, email: email, name: name });
    staffByKey[key] = {
      lastContact: VOLUNTEERS_LAST_CONTACT_COL - 1 < rows[i].length ? rows[i][VOLUNTEERS_LAST_CONTACT_COL - 1] : '',
      internalNotes:
        notesCol - 1 < rows[i].length && rows[i][notesCol - 1] != null
          ? String(rows[i][notesCol - 1])
          : '',
      internalStatus:
        VOLUNTEERS_INTERNAL_STATUS_COL - 1 < rows[i].length && rows[i][VOLUNTEERS_INTERNAL_STATUS_COL - 1] != null
          ? String(rows[i][VOLUNTEERS_INTERNAL_STATUS_COL - 1]).trim()
          : ''
    };
  }
  return { entries: entries, staffByKey: staffByKey };
}

/**
 * Keep existing people in their current order; append anyone newly eligible at the bottom.
 * Matches prior rows by Companion ID, then email, then name (so upgrades do not reshuffle).
 * @param {Array<{key:string, email:string, name:string}>} existingEntries
 * @param {Object} eligibleByKey map key → row values array
 * @param {string[]} formOrder keys in Sign Up Form scan order (for newcomers only)
 * @return {Array<Array>}
 */
function rosterSync_mergeStableOrder_(existingEntries, eligibleByKey, formOrder) {
  var out = [];
  var placed = {};
  var byEmail = {};
  var byName = {};
  for (var k = 0; k < formOrder.length; k++) {
    var id = formOrder[k];
    var vals = eligibleByKey[id];
    if (!vals) continue;
    var em = String(vals[4] || '')
      .trim()
      .toLowerCase();
    var nm = String(vals[2] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (em && !byEmail[em]) byEmail[em] = id;
    if (nm && !byName[nm]) byName[nm] = id;
  }

  for (var i = 0; i < existingEntries.length; i++) {
    var entry = existingEntries[i];
    var matchKey = '';
    if (eligibleByKey[entry.key]) matchKey = entry.key;
    else if (entry.email && byEmail[entry.email]) matchKey = byEmail[entry.email];
    else if (entry.name && byName[entry.name]) matchKey = byName[entry.name];
    if (!matchKey || placed[matchKey]) continue;
    out.push(eligibleByKey[matchKey]);
    placed[matchKey] = true;
  }
  for (var j = 0; j < formOrder.length; j++) {
    var nk = formOrder[j];
    if (placed[nk] || !eligibleByKey[nk]) continue;
    out.push(eligibleByKey[nk]);
    placed[nk] = true;
  }
  return out;
}

/** Allowed values for Volunteers / Companions Internal Status (column H). */
var ROSTER_INTERNAL_STATUS_OPTIONS = ['Active', 'Quit', 'Unresponsive', 'Dismissed'];

/**
 * Dropdown on Internal Status (column H): Active / Quit / Unresponsive / Dismissed.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} [statusCol] 1-based column (default H = 8)
 */
function applyRosterInternalStatusDropdown_(sheet, statusCol) {
  if (!sheet) return;
  var col = statusCol != null ? statusCol : VOLUNTEERS_INTERNAL_STATUS_COL;
  var maxRows = Math.max(sheet.getMaxRows(), 2);
  var range = sheet.getRange(2, col, maxRows - 1, 1);
  range.clearDataValidations();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ROSTER_INTERNAL_STATUS_OPTIONS, true)
    .setAllowInvalid(true)
    .setHelpText('Choose Active, Quit, Unresponsive, or Dismissed (or leave blank).')
    .build();
  range.setDataValidation(rule);
}

/**
 * Background color for an Internal Status value (or null to clear).
 * Case-insensitive match.
 * @param {*} status
 * @return {string|null}
 */
function rosterStatusHighlightColor_(status) {
  var s = String(status != null ? status : '')
    .trim()
    .toLowerCase();
  if (s === 'quit') return ROSTER_QUIT_HIGHLIGHT_COLOR;
  if (s === 'unresponsive') return ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR;
  if (s === 'dismissed') return ROSTER_DISMISSED_HIGHLIGHT_COLOR;
  return null;
}

/**
 * Remove alternating row colors so status highlights are visible.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function clearSheetBandings_(sheet) {
  if (!sheet) return;
  try {
    var bandings = sheet.getBandings();
    for (var i = 0; i < bandings.length; i++) {
      bandings[i].remove();
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Paint one data row from its Internal Status cell.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} row 1-based
 * @param {number} statusCol 1-based
 * @param {number} [numCols]
 */
function paintRosterStatusRow_(sheet, row, statusCol, numCols) {
  if (!sheet || row < 2) return;
  var width = numCols != null ? numCols : Math.max(sheet.getLastColumn(), statusCol, VOLUNTEERS_HEADER_ROW.length);
  var status = sheet.getRange(row, statusCol).getValue();
  var color = rosterStatusHighlightColor_(status);
  // setBackground(null) clears; hex string paints.
  sheet.getRange(row, 1, 1, width).setBackground(color);
}

/**
 * Paint all data rows from Internal Status (row-by-row — most reliable in Sheets).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} statusCol 1-based
 * @param {number} [numCols]
 */
function paintRosterStatusRows_(sheet, statusCol, numCols) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  clearSheetBandings_(sheet);
  var width = numCols != null ? numCols : Math.max(sheet.getLastColumn(), statusCol, VOLUNTEERS_HEADER_ROW.length);
  for (var row = 2; row <= lastRow; row++) {
    paintRosterStatusRow_(sheet, row, statusCol, width);
  }
}

/**
 * Entire-row highlight by Internal Status: Quit (brown), Unresponsive (orange), Dismissed (red).
 * Uses direct paint + conditional formatting (case-insensitive formulas).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} [statusCol] 1-based Internal Status column (default H = 8)
 * @param {number} [numCols] columns to paint across the row
 */
function applyRosterQuitConditionalFormatting_(sheet, statusCol, numCols) {
  if (!sheet) return;
  var col = statusCol != null ? statusCol : VOLUNTEERS_INTERNAL_STATUS_COL;
  var width = numCols != null ? numCols : Math.max(sheet.getLastColumn(), col, VOLUNTEERS_HEADER_ROW.length);
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var endRow = Math.max(lastRow + 50, 200);
  // getRange(row, column, numRows, numColumns)
  var range = sheet.getRange(2, 1, endRow - 1, width);
  var colLetter = sheet.getRange(1, col).getA1Notation().replace(/\d/g, '');
  var rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="quit"')
      .setBackground(ROSTER_QUIT_HIGHLIGHT_COLOR)
      .setRanges([range])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="unresponsive"')
      .setBackground(ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR)
      .setRanges([range])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="dismissed"')
      .setBackground(ROSTER_DISMISSED_HIGHLIGHT_COLOR)
      .setRanges([range])
      .build()
  ];
  clearSheetBandings_(sheet);
  sheet.setConditionalFormatRules(rules);
  paintRosterStatusRows_(sheet, col, width);
  applyRosterInternalStatusDropdown_(sheet, col);
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
 * Syncs the Volunteers tab from Sign Up Form without reshuffling.
 * Existing people keep their current order; newly eligible people are appended at the bottom.
 */
function syncVolunteersFromSignUpForm() {
  volunteersSync_beginSheetWrite_();
  try {
    if (typeof ensureCompanionIds_ === 'function') ensureCompanionIds_();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var src = ss.getSheetByName(VOLUNTEERS_SYNC_SOURCE_SHEET);
    if (!src) {
      throw new Error('Sheet "' + VOLUNTEERS_SYNC_SOURCE_SHEET + '" not found.');
    }

    var lastRow = src.getLastRow();
    var lastCol = Math.max(src.getLastColumn(), VOLUNTEER_COL_INDEX);
    var tgt = volunteersSync_ensureTargetSheet_(ss);
    var numCols = VOLUNTEERS_HEADER_ROW.length;
    tgt.getRange(1, 1, 1, numCols).setValues([VOLUNTEERS_HEADER_ROW]);

    if (lastRow < 2) {
      var lrEmpty = tgt.getLastRow();
      if (lrEmpty > 1) {
        tgt.getRange(2, 1, lrEmpty - 1, numCols).clearContent();
      }
      applyRosterQuitConditionalFormatting_(tgt, VOLUNTEERS_INTERNAL_STATUS_COL, numCols);
      return;
    }

    var existing = rosterSync_readExistingOrder_(
      VOLUNTEERS_SYNC_TARGET_SHEET,
      VOLUNTEERS_SIGNUP_ROW_COL,
      VOLUNTEERS_NOTES_COL,
      VOLUNTEERS_COMPANION_ID_COL
    );
    var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = volunteersSync_buildColumnMap_(headers);
    var data = src.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var eligibleByKey = {};
    var formOrder = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!volunteersSync_isVolunteerTrue_(row[VOLUNTEER_COL_INDEX - 1])) continue;
      var sheetRow = i + 2;
      var built = rosterSync_buildPersonRow_(
        row,
        map,
        sheetRow,
        existing.staffByKey[
          (map.companionId >= 0 && row[map.companionId] != null
            ? String(row[map.companionId]).trim()
            : '') || String(sheetRow)
        ] || existing.staffByKey[String(sheetRow)] || null
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
    applyRosterQuitConditionalFormatting_(tgt, VOLUNTEERS_INTERNAL_STATUS_COL, numCols);
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
 * Push Volunteers F/G/H edits to Sign Up Form
 * (Last Contact, Internal Notes, Internal Status — needs Code.gs helpers).
 * Wire to installable trigger: From spreadsheet → On edit (all sheets; handler returns unless sheet is Volunteers).
 */
function onEditVolunteersStaffFields(e) {
  if (!e || !e.range) return;
  if (volunteersSync_isSheetWriteInProgress_()) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== VOLUNTEERS_SYNC_TARGET_SHEET) return;
  var c0 = e.range.getColumn();
  var cLast = e.range.getLastColumn();
  if (cLast < VOLUNTEERS_LAST_CONTACT_COL || c0 > VOLUNTEERS_INTERNAL_STATUS_COL) return;
  var r0 = e.range.getRow();
  var rLast = e.range.getLastRow();
  if (rLast < 2) return;

  for (var r = Math.max(2, r0); r <= rLast; r++) {
    var cid = String(sh.getRange(r, VOLUNTEERS_COMPANION_ID_COL).getValue() || '').trim();
    var signup = sh.getRange(r, VOLUNTEERS_SIGNUP_ROW_COL).getValue();
    var ref = cid || String(signup != null ? signup : '').trim();
    if (!ref) continue;
    var lcCell = sh.getRange(r, VOLUNTEERS_LAST_CONTACT_COL).getValue();
    var notesCell = sh.getRange(r, VOLUNTEERS_NOTES_COL).getValue();
    var statusCell = sh.getRange(r, VOLUNTEERS_INTERNAL_STATUS_COL).getValue();
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
    if (typeof updateCompanionInternalStatus === 'function') {
      updateCompanionInternalStatus(ref, statusCell != null ? String(statusCell).trim() : '');
    }
    if (c0 <= VOLUNTEERS_INTERNAL_STATUS_COL && cLast >= VOLUNTEERS_INTERNAL_STATUS_COL) {
      paintRosterStatusRow_(sh, r, VOLUNTEERS_INTERNAL_STATUS_COL, VOLUNTEERS_HEADER_ROW.length);
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
  // New form rows need a Companion ID before anything keyed to it (matches, links) is created.
  if (typeof ensureCompanionIds_ === 'function') {
    ensureCompanionIds_();
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
 * 6. Volunteers staff fields (F Last Contact, G Internal Notes, H Internal Status) → Sign Up Form
 *    (Quit in H highlights the row light brown):
 *    - Function: onEditVolunteersStaffFields
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 7. Companions staff fields (F / G / H same as Volunteers) → Sign Up Form:
 *    - Function: onEditCompanionsStaffFields (in CompanionsSync.gs)
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 8. Save. First run may prompt authorization.
 *
 * **Sign-up email alerts:** SignUpFormNotify.gs uses its own dedicated On form submit trigger.
 * Install it from Companion tools → Install new-signup email alert.
 *
 * If **CompanionsSync.gs** is present, these handlers also refresh the **Companions** tab (non-volunteers).
 */
