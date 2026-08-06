/**
 * Emails staff for each Google Form submission written to "Sign Up Form".
 *
 * Install once from Companion tools → Install new-signup email alert. A dedicated
 * spreadsheet On form submit trigger is more reliable than inferring submissions from
 * the sheet's row count (which breaks after sorting, inserting or deleting rows).
 *
 * Override the recipient with Script property SIGNUP_NOTIFY_TO_EMAIL.
 * Disable with Script property SIGNUP_NOTIFY_ENABLED = false.
 */

var SIGNUP_NOTIFY_TO_EMAIL_DEFAULT = 'danfrey76@gmail.com';
var SIGNUP_NOTIFY_TO_EMAIL_KEY = 'SIGNUP_NOTIFY_TO_EMAIL';
var SIGNUP_NOTIFY_ENABLED_KEY = 'SIGNUP_NOTIFY_ENABLED';
var SIGNUP_NOTIFY_SENT_PREFIX = 'SIGNUP_NOTIFY_SENT_';
var SIGNUP_NOTIFY_TRIGGER_HANDLER = 'onNewSignUpFormSubmit';

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

function signUpNotify_escapeHtml_(value) {
  return String(value != null ? value : '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Dedicated installable spreadsheet form-submit handler.
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onNewSignUpFormSubmit(e) {
  if (!signUpNotify_isEnabled_() || !e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FORM_SHEET_NAME || e.range.getRow() < 2) return;

  // The public application URL must use the permanent Companion ID.
  ensureCompanionIds_();
  signUpNotify_sendForRow_(sheet, e.range.getRow(), false);
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNum
 * @param {boolean} isTest
 * @return {{ sent: boolean, message: string }}
 */
function signUpNotify_sendForRow_(sheet, rowNum, isTest) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('The sign-up sheet has no columns.');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIdx = buildCompanionColumnIndices(headers);
  var row = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  var companion = parseCompanionRow(row, colIdx, rowNum);
  var fullName =
    (String(companion.firstName || '').trim() + ' ' + String(companion.lastName || '').trim()).trim() ||
    'New sign-up (row ' + rowNum + ')';
  var personEmail = String(companion.email || '').trim() || '(not provided)';
  var personPhone = String(companion.phone || '').trim() || '(not provided)';
  var companionRef = String(companion.id || '').trim() || String(rowNum);

  var props = PropertiesService.getScriptProperties();
  var sentKey = SIGNUP_NOTIFY_SENT_PREFIX + companionRef.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!isTest && props.getProperty(sentKey)) {
    return { sent: false, message: 'An email was already sent for ' + companionRef + '.' };
  }

  // A missing Web app URL must not swallow the whole alert — send it with a note instead.
  var publicUrl = '';
  var linkProblem = '';
  try {
    var linkResult = getPublicShareLink(companionRef);
    if (linkResult && linkResult.ok && linkResult.url) {
      publicUrl = String(linkResult.url);
    } else {
      linkProblem = (linkResult && linkResult.message) || 'The public link could not be built.';
    }
  } catch (err) {
    linkProblem = String(err.message || err);
  }

  var subject = (isTest ? '[TEST] ' : '') + 'New companionship sign-up: ' + fullName;
  var body =
    'Someone just submitted the sign-up form.\n\n' +
    'Full name: ' +
    fullName +
    '\n' +
    'Email: ' +
    personEmail +
    '\n' +
    'Phone number: ' +
    personPhone +
    '\n\n' +
    (publicUrl
      ? 'View the public application:\n' + publicUrl
      : 'Public application link unavailable (' +
        linkProblem +
        ')\nOpen the spreadsheet and look up ' +
        companionRef +
        '.');

  var htmlBody =
    '<p>Someone just submitted the companionship sign-up form.</p>' +
    '<p><strong>Full name:</strong> ' +
    signUpNotify_escapeHtml_(fullName) +
    '<br><strong>Email:</strong> ' +
    signUpNotify_escapeHtml_(personEmail) +
    '<br><strong>Phone number:</strong> ' +
    signUpNotify_escapeHtml_(personPhone) +
    '</p>' +
    (publicUrl
      ? '<p><a href="' +
        signUpNotify_escapeHtml_(publicUrl) +
        '">View ' +
        signUpNotify_escapeHtml_(fullName) +
        '&#39;s public application</a></p>'
      : '<p><em>Public application link unavailable (' +
        signUpNotify_escapeHtml_(linkProblem) +
        '). Open the spreadsheet and look up ' +
        signUpNotify_escapeHtml_(companionRef) +
        '.</em></p>');

  MailApp.sendEmail({
    to: signUpNotify_getRecipient_(),
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: 'City Voices Companionship'
  });

  if (!isTest) props.setProperty(sentKey, new Date().toISOString());
  return { sent: true, message: 'Email sent to ' + signUpNotify_getRecipient_() + '.' };
}

/**
 * Installs exactly one dedicated "On form submit" trigger for this spreadsheet.
 * Safe to run again: old copies of this trigger are removed first.
 */
function installSignUpNotificationTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var removed = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SIGNUP_NOTIFY_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger(SIGNUP_NOTIFY_TRIGGER_HANDLER).forSpreadsheet(ss).onFormSubmit().create();
  PropertiesService.getScriptProperties().setProperty(SIGNUP_NOTIFY_ENABLED_KEY, 'true');

  var message =
    'New-signup email alert installed.\n\n' +
    'Every new response on "' +
    FORM_SHEET_NAME +
    '" will email ' +
    signUpNotify_getRecipient_() +
    '.';
  if (removed) message += '\n\nReplaced ' + removed + ' older copy/copies of this trigger.';
  SpreadsheetApp.getUi().alert(message);
}

/**
 * Sends a clearly marked test for the most recently submitted row without changing dedupe state.
 */
function sendSignUpNotificationTestForLastRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('No sign-up rows found on "' + FORM_SHEET_NAME + '".');
  }
  ensureCompanionIds_();
  var result = signUpNotify_sendForRow_(sheet, sheet.getLastRow(), true);
  SpreadsheetApp.getUi().alert(result.message);
}
