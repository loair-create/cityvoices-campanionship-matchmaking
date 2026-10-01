/**
 * Volunteers tab sync (standalone — add this file alongside Code.gs or in a separate Apps Script project
 * bound to the same spreadsheet).
 *
 * When the Volunteer column on "Sign Up Form" is TRUE, that row is listed on the "Volunteers" tab:
 * Col A: Timestamp from Sign Up Form; Col B: sign-up row; Col C–E: name, phone, email;
 * Col F: Last Contact Date — staff manual; edits push to Sign Up Form "Last Contact Date" column;
 * Col G: Internal Notes — staff manual; edits push to Sign Up Form INTERNAL NOTES;
 * Col H: Internal Status — editable (Active / Quit / Unresponsive / Dismissed / Unmatched); edits push to Sign Up Form; status rows highlight (Quit brown, Unresponsive orange, Dismissed red, Unmatched blue);
 * Col I: Companion ID — stable person key (list order is preserved; new people append at the bottom).
 */

var VOLUNTEERS_SYNC_SOURCE_SHEET = 'Sign Up Form';
var VOLUNTEERS_SYNC_TARGET_SHEET = 'Volunteers';

/**
 * Volunteer flag column on Sign Up Form (TRUE = volunteer).
 * Found by header text, so it keeps working when columns are added, removed,
 * or shifted by a paste. Column AQ is only a fallback if no header matches.
 * If your header is worded differently, add it to this list (lowercase).
 */
var VOLUNTEER_COL_HEADERS = [
  'are you a volunteer',
  'is volunteer',
  'volunteer?',
  'volunteer'
];

/** Used only when no header above matches. Column AQ = 43. */
var VOLUNTEER_COL_FALLBACK_INDEX = 43;

/**
 * 1-based column number of the volunteer flag, from the Sign Up Form header row.
 * Returns -1 when it cannot be identified, so callers stop instead of rebuilding
 * the roster tabs from the wrong column.
 * @param {Array} headers row 1 of Sign Up Form
 * @return {number}
 */
function volunteersSync_findVolunteerCol_(headers) {
  var lower = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] != null ? headers[i] : '').trim().toLowerCase();
    // Volunteer status and notes columns are staff fields, never the flag.
    if (h.indexOf('status') !== -1 || h.indexOf('notes') !== -1) {
      h = '';
    }
    lower.push(h);
  }
  for (var n = 0; n < VOLUNTEER_COL_HEADERS.length; n++) {
    for (var j = 0; j < lower.length; j++) {
      if (lower[j] && lower[j].indexOf(VOLUNTEER_COL_HEADERS[n]) !== -1) {
        return j + 1;
      }
    }
  }
  if (headers.length >= VOLUNTEER_COL_FALLBACK_INDEX) {
    return VOLUNTEER_COL_FALLBACK_INDEX;
  }
  return -1;
}

/** Column letter for error messages, for example AQ. */
function volunteersSync_colLetter_(colIndex) {
  var s = '';
  var n = colIndex;
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

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

/** Row highlights by Internal Status. */
var ROSTER_QUIT_HIGHLIGHT_COLOR = '#E8D4C4';
var ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR = '#FED7AA';
var ROSTER_DISMISSED_HIGHLIGHT_COLOR = '#FECACA';
var ROSTER_UNMATCHED_HIGHLIGHT_COLOR = '#DBEAFE';
var ROSTER_ACTIVE_HIGHLIGHT_COLOR = '#FFFFFF';

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
var ROSTER_INTERNAL_STATUS_OPTIONS = ['Active', 'Quit', 'Unresponsive', 'Dismissed', 'Unmatched'];

/**
 * Dropdown on Internal Status (column H): Active / Quit / Unresponsive / Dismissed / Unmatched.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} [statusCol] 1-based column (default H = 8)
 */
function applyRosterInternalStatusDropdown_(sheet, statusCol) {
  if (!sheet) return;
  var col = statusCol != null ? statusCol : VOLUNTEERS_INTERNAL_STATUS_COL;
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var endRow = Math.max(lastRow + 50, 100);
  var range = sheet.getRange(2, col, endRow - 1, 1);
  range.clearDataValidations();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ROSTER_INTERNAL_STATUS_OPTIONS, true)
    .setAllowInvalid(true)
    .setHelpText('Choose Active, Quit, Unresponsive, Dismissed, or Unmatched (or leave blank).')
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
  if (s === 'unmatched') return ROSTER_UNMATCHED_HIGHLIGHT_COLOR;
  if (s === 'active') return ROSTER_ACTIVE_HIGHLIGHT_COLOR;
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
 * Paint one data row from its Internal Status cell (for on-edit only).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} row 1-based
 * @param {number} statusCol 1-based
 * @param {number} [numCols]
 */
function paintRosterStatusRow_(sheet, row, statusCol, numCols) {
  if (!sheet || row < 2) return;
  var width = numCols != null ? numCols : Math.max(sheet.getLastColumn(), statusCol, VOLUNTEERS_HEADER_ROW.length);
  var status = sheet.getRange(row, statusCol).getValue();
  sheet.getRange(row, 1, 1, width).setBackground(rosterStatusHighlightColor_(status));
}

/**
 * Fast batch paint (one read + one write). Prefer conditional formatting for bulk apply.
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
  var n = lastRow - 1;
  var statuses = sheet.getRange(2, statusCol, n, 1).getValues();
  var backgrounds = [];
  for (var i = 0; i < statuses.length; i++) {
    var color = rosterStatusHighlightColor_(statuses[i][0]);
    var rowBg = [];
    for (var c = 0; c < width; c++) rowBg.push(color);
    backgrounds.push(rowBg);
  }
  sheet.getRange(2, 1, n, width).setBackgrounds(backgrounds);
}

/**
 * Entire-row highlight by Internal Status via conditional formatting (fast).
 * Also refreshes the Internal Status dropdown. Does not row-paint (that was too slow).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} [statusCol] 1-based Internal Status column (default H = 8)
 * @param {number} [numCols] columns to paint across the row
 */
function applyRosterQuitConditionalFormatting_(sheet, statusCol, numCols) {
  if (!sheet) return;
  var col = statusCol != null ? statusCol : VOLUNTEERS_INTERNAL_STATUS_COL;
  var width = numCols != null ? numCols : Math.max(sheet.getLastColumn(), col, VOLUNTEERS_HEADER_ROW.length);
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var endRow = Math.max(lastRow + 50, 100);
  var range = sheet.getRange(2, 1, endRow - 1, width);
  var colLetter = sheet.getRange(1, col).getA1Notation().replace(/\d/g, '');
  clearSheetBandings_(sheet);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="active"')
      .setBackground(ROSTER_ACTIVE_HIGHLIGHT_COLOR)
      .setRanges([range])
      .build(),
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
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="unmatched"')
      .setBackground(ROSTER_UNMATCHED_HIGHLIGHT_COLOR)
      .setRanges([range])
      .build()
  ]);
  applyRosterInternalStatusDropdown_(sheet, col);
}

/**
 * Run this from the Apps Script editor (function dropdown → debugVolunteersSync → Run).
 * Tells you which column the script is reading as the volunteer flag, and what it sees there.
 */
function debugVolunteersSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = ss.getSheets().map(function (s) {
    return s.getName();
  });
  var src = ss.getSheetByName('Sign Up Form');
  if (!src) {
    SpreadsheetApp.getUi().alert(
      'No tab named exactly "Sign Up Form".\n\nTabs found:\n' + names.join('\n')
    );
    return;
  }
  var lastRow = src.getLastRow();
  var lastCol = src.getLastColumn();
  var headers = lastCol >= 1 ? src.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var volCol = volunteersSync_findVolunteerCol_(headers);
  var lines = [
    'Tab name OK: Sign Up Form',
    'lastRow=' + lastRow + '  lastCol=' + lastCol
  ];
  if (volCol < 0) {
    lines.push('Volunteer column: NOT FOUND — row 1 needs a header containing "Volunteer".');
    SpreadsheetApp.getUi().alert(lines.join('\n'));
    return;
  }
  lines.push(
    'Volunteer column: ' +
      volunteersSync_colLetter_(volCol) +
      ' (column ' + volCol + ')  header: [' + headers[volCol - 1] + ']'
  );
  if (lastRow < 2) {
    lines.push('Script sees NO data rows — that path clears Volunteers.');
  } else {
    var n = lastRow - 1;
    var vals = src.getRange(2, volCol, n, 1).getValues();
    var nTrue = 0;
    var samples = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i][0];
      if (volunteersSync_isVolunteerTrue_(v)) nTrue++;
      if (samples.length < 6) {
        samples.push(
          '  row ' + (i + 2) + ': value=[' + v + '] type=' + typeof v
        );
      }
    }
    lines.push('Values the script counts as volunteer: ' + nTrue + ' of ' + n);
    lines.push('First cells in that column:');
    lines = lines.concat(samples);
  }
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function volunteersSync_isVolunteerTrue_(cellValue) {
  if (cellValue === true) return true;
  var s = String(cellValue != null ? cellValue : '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1' || s === 'VOLUNTEER';
}

/**
 * Do not erase an existing roster when sync finds 0 people (usually the Volunteer flag is not TRUE).
 * @return {boolean} true = source is also empty, caller may finish without writing rows
 */
function rosterSync_refuseEmptyWipe_(out, existingCount, tabName) {
  if (out && out.length) return false;
  if (existingCount > 0) {
    throw new Error(
      'Sync found 0 people for the "' +
        tabName +
        '" tab, so it left your list unchanged. ' +
        'On Sign Up Form, the Volunteer column must be TRUE (or Yes) for volunteers.'
    );
  }
  return true;
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
    var lastCol = Math.max(src.getLastColumn(), VOLUNTEER_COL_FALLBACK_INDEX);
    var tgt = volunteersSync_ensureTargetSheet_(ss);
    var numCols = VOLUNTEERS_HEADER_ROW.length;
    tgt.getRange(1, 1, 1, numCols).setValues([VOLUNTEERS_HEADER_ROW]);

    if (lastRow < 2) {
      if (tgt.getLastRow() > 1) {
        throw new Error(
          'Sign Up Form has no data rows. Volunteers tab was left unchanged so your list is not erased.'
        );
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
    var volCol = volunteersSync_findVolunteerCol_(headers);
    if (volCol < 0) {
      throw new Error(
        'Could not find the volunteer column on Sign Up Form, so the Volunteers tab was left ' +
          'unchanged. Row 1 needs a header containing the word "Volunteer".'
      );
    }
    var data = src.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var eligibleByKey = {};
    var formOrder = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!volunteersSync_isVolunteerTrue_(row[volCol - 1])) continue;
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
    if (rosterSync_refuseEmptyWipe_(out, existing.entries.length, 'Volunteers')) {
      applyRosterQuitConditionalFormatting_(tgt, VOLUNTEERS_INTERNAL_STATUS_COL, numCols);
      return;
    }
    tgt.getRange(2, 1, out.length, numCols).setValues(out);
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
  // Paste/edit on Volunteers or Companions must not rebuild those tabs from Sign Up Form
  // (that was wiping restored data the moment it was pasted).
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var n = active ? active.getName() : '';
    if (n === VOLUNTEERS_SYNC_TARGET_SHEET || n === 'Companions') return;
  } catch (skipErr) {
    // ignore
  }
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
