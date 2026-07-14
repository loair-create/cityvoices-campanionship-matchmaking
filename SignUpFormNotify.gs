/**
 * Email notification when a new row is added to "Sign Up Form" (Google Form response).
 * Wired from onChangeVolunteersSync in VolunteersSync.gs (same installable On change trigger).
 *
 * Override recipient via Script property SIGNUP_NOTIFY_TO_EMAIL (default: danfrey176@gmail.com).
 * Disable with Script property SIGNUP_NOTIFY_ENABLED = false.
 */

var SIGNUP_NOTIFY_TO_EMAIL_DEFAULT = 'danfrey176@gmail.com';
var SIGNUP_NOTIFY_TO_EMAIL_KEY = 'SIGNUP_NOTIFY_TO_EMAIL';
var SIGNUP_NOTIFY_ENABLED_KEY = 'SIGNUP_NOTIFY_ENABLED';
var SIGNUP_NOTIFY_LAST_ROW_KEY = 'SIGNUP_NOTIFY_LAST_PROCESSED_ROW';

function signUpNotify_isEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SIGNUP_NOTIFY_ENABLED_KEY);
  if (raw == null || String(raw).trim() === '') return true;
  var s = String(raw).trim().toLowerCase();
  return s !== 'false' && s !== '0' && s !== 'no';
}

function signUpNotify_getRecipient_() {
  var custom = PropertiesService.getScriptProperties().getProperty(SIGNUP_NOTIFY_TO_EMAIL_KEY);
  if (custom != null && String(custom).trim().indexOf('@') > 0) {
    return String(custom).trim();
  }
  return SIGNUP_NOTIFY_TO_EMAIL_DEFAULT;
}

/**
 * Detects new Sign Up Form rows since last run and sends one email per row.
 * Safe to call from onChange; skips historical rows on first run.
 */
function processNewSignUpFormNotifications_() {
  if (!signUpNotify_isEnabled_()) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var props = PropertiesService.getScriptProperties();
  var rawLast = props.getProperty(SIGNUP_NOTIFY_LAST_ROW_KEY);

  // First run: start tracking from current last row (do not email existing sign-ups).
  if (rawLast === null || String(rawLast).trim() === '') {
    props.setProperty(SIGNUP_NOTIFY_LAST_ROW_KEY, String(lastRow));
    return;
  }

  var lastProcessed = parseInt(String(rawLast).trim(), 10);
  if (isNaN(lastProcessed) || lastProcessed < 1) lastProcessed = 1;
  if (lastProcessed >= lastRow) return;

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIdx = buildCompanionColumnIndices(headers);
  var spreadsheetUrl = ss.getUrl();
  var toEmail = signUpNotify_getRecipient_();

  for (var r = lastProcessed + 1; r <= lastRow; r++) {
    try {
      signUpNotify_sendForRow_(sheet, r, lastCol, colIdx, spreadsheetUrl, toEmail);
    } catch (err) {
      Logger.log('Sign-up notify failed for row ' + r + ': ' + (err.message || err));
    }
  }

  props.setProperty(SIGNUP_NOTIFY_LAST_ROW_KEY, String(lastRow));
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNum
 * @param {number} lastCol
 * @param {Object} colIdx
 * @param {string} spreadsheetUrl
 * @param {string} toEmail
 */
function signUpNotify_sendForRow_(sheet, rowNum, lastCol, colIdx, spreadsheetUrl, toEmail) {
  var row = sheet.getRange(rowNum, 1, rowNum, lastCol).getValues()[0];
  var companion = parseCompanionRow(row, colIdx, rowNum);
  var fullName =
    (String(companion.firstName || '').trim() + ' ' + String(companion.lastName || '').trim()).trim() ||
    'New sign-up (row ' + rowNum + ')';
  var personEmail = String(companion.email || '').trim() || '(not provided)';

  var subject = 'New companionship sign-up: ' + fullName;
  var body =
    'Someone just submitted the sign-up form.\n\n' +
    'Full name: ' +
    fullName +
    '\n' +
    'Email: ' +
    personEmail +
    '\n\n' +
    'Open the spreadsheet:\n' +
    spreadsheetUrl +
    '\n\n' +
    'Sign-up sheet row: ' +
    rowNum;

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    body: body
  });
}

/**
 * Manual test: Run → sendSignUpNotificationTestForLastRow (emails about the latest sign-up row).
 */
function sendSignUpNotificationTestForLastRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('No sign-up rows found on "' + FORM_SHEET_NAME + '".');
  }
  var rowNum = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIdx = buildCompanionColumnIndices(headers);
  signUpNotify_sendForRow_(sheet, rowNum, lastCol, colIdx, ss.getUrl(), signUpNotify_getRecipient_());
}
