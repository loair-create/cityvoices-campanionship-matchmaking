/**
 APP v3
 * Backend Logic
 */

/** Name of the sheet tab with companion sign-ups (row 1 = headers, then one row per person). */
var FORM_SHEET_NAME = 'Sign Up Form';

/**
 * Sign-up column holding each person's permanent ID. Matches, links and PDFs are keyed to this
 * value, not to the row number, because sorting or deleting sign-up rows renumbers everyone.
 */
var COMPANION_ID_HEADER = 'Companion ID';
var COMPANION_ID_PREFIX = 'C-';
/** Optional tabs for Insights — column frequency summaries. */
var PRE_SURVEY_SHEET_NAME = 'Pre-Survey Results';
var POST_SURVEY_SHEET_NAME = 'Post Survey Results';

/** Script property name for the external JSON API shared secret (historically named LOVABLE_API_TOKEN). */
var LOVABLE_API_TOKEN_KEY = 'LOVABLE_API_TOKEN';

/**
 * Optional override for public links / PDFs when ScriptApp.getService().getUrl() is empty or wrong.
 * 1) Script property WEB_APP_PUBLIC_BASE_URL (Apps Script → Project Settings → Script properties), or
 * 2) Same key on this spreadsheet (DocumentProperties) — use "Save" in the Companion sidebar, or
 * 3) Automatic URL from the active Web app deployment.
 */
var WEB_APP_PUBLIC_BASE_URL_KEY = 'WEB_APP_PUBLIC_BASE_URL';

/** Strip query/hash and trailing slash so ?view=public is appended cleanly. */
function normalizeWebAppBaseUrl_(raw) {
  if (raw == null) return '';
  var u = String(raw).trim().replace(/#$/, '');
  var q = u.indexOf('?');
  if (q >= 0) u = u.substring(0, q);
  return u.replace(/\/$/, '');
}

/**
 * Resolve Web app base URL: script property → spreadsheet document property → deployment URL.
 * DocumentProperties work in container-bound scripts (typical spreadsheet project).
 */
function resolveWebAppBaseUrl_() {
  var sp = PropertiesService.getScriptProperties().getProperty(WEB_APP_PUBLIC_BASE_URL_KEY);
  if (sp != null && String(sp).trim()) return normalizeWebAppBaseUrl_(sp);
  try {
    var dp = PropertiesService.getDocumentProperties().getProperty(WEB_APP_PUBLIC_BASE_URL_KEY);
    if (dp != null && String(dp).trim()) return normalizeWebAppBaseUrl_(dp);
  } catch (ignore) {}
  try {
    var svc = ScriptApp.getService().getUrl();
    if (svc && String(svc).trim()) return normalizeWebAppBaseUrl_(svc);
  } catch (e) {}
  return '';
}

/**
 * For Companion sidebar: whether a base URL is available and how it was resolved.
 * @return {{ ok: boolean, baseUrl: string, source: string, message: string }}
 */
function getWebAppBaseUrlStatus() {
  var sp = PropertiesService.getScriptProperties().getProperty(WEB_APP_PUBLIC_BASE_URL_KEY);
  if (sp != null && String(sp).trim()) {
    return { ok: true, baseUrl: normalizeWebAppBaseUrl_(sp), source: 'script_property', message: '' };
  }
  try {
    var dp = PropertiesService.getDocumentProperties().getProperty(WEB_APP_PUBLIC_BASE_URL_KEY);
    if (dp != null && String(dp).trim()) {
      return { ok: true, baseUrl: normalizeWebAppBaseUrl_(dp), source: 'spreadsheet_saved', message: '' };
    }
  } catch (ignore) {}
  try {
    var svc = ScriptApp.getService().getUrl();
    if (svc && String(svc).trim()) {
      return { ok: true, baseUrl: normalizeWebAppBaseUrl_(svc), source: 'deployment', message: '' };
    }
  } catch (e) {}
  return {
    ok: false,
    baseUrl: '',
    source: '',
    message:
      'Could not detect the Web app URL from the sidebar. Paste your /exec URL below and click Save, or set Script property WEB_APP_PUBLIC_BASE_URL.'
  };
}

/**
 * Saves Web app base URL for this spreadsheet (DocumentProperties). Use when Copy public link fails from the sidebar.
 * Pass '' to clear. @return {{ ok: boolean, message: string }}
 */
function saveWebAppPublicBaseUrlFromSidebar(url) {
  var raw = String(url != null ? url : '').trim();
  if (!raw) {
    try {
      PropertiesService.getDocumentProperties().deleteProperty(WEB_APP_PUBLIC_BASE_URL_KEY);
      return { ok: true, message: 'Removed saved URL for this spreadsheet.' };
    } catch (e) {
      return { ok: false, message: String(e.message || e) };
    }
  }
  if (raw.indexOf('https://') !== 0 && raw.indexOf('http://') !== 0) {
    return { ok: false, message: 'URL must start with https://' };
  }
  var u = normalizeWebAppBaseUrl_(raw);
  if (u.indexOf('script.google.com') < 0) {
    return { ok: false, message: 'Use the Web app URL from Deploy → Manage deployments (contains script.google.com).' };
  }
  if (u.indexOf('/exec') < 0 && u.indexOf('/dev') < 0) {
    return { ok: false, message: 'URL should end with /exec or /dev.' };
  }
  try {
    PropertiesService.getDocumentProperties().setProperty(WEB_APP_PUBLIC_BASE_URL_KEY, u);
    return { ok: true, message: 'Saved for this spreadsheet. Try Copy public link again.' };
  } catch (e) {
    return {
      ok: false,
      message:
        'Could not save here. Set Script property WEB_APP_PUBLIC_BASE_URL in Apps Script → Project Settings.'
    };
  }
}

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  if (String(p.view || '') === 'public') {
    // cid = Companion ID (current links); row = sign-up row number (links shared before stable IDs).
    if (p.cid != null && String(p.cid).length > 0) return servePublicProfile_(p.cid);
    if (p.row != null && String(p.row).length > 0) return servePublicProfile_(p.row);
  }
  /**
   * JSON API over GET: ?payload=encodeURIComponent(JSON.stringify({ action, token, ... })).
   * Lets browser apps call the same handlers as doPost without cross-origin POST/CORS workarounds.
   */
  if (p.payload != null && String(p.payload).length > 0) {
    try {
      var payloadObj = JSON.parse(p.payload);
      return handleLovableRequest_(payloadObj, p.token != null ? String(p.token) : '');
    } catch (err) {
      return jsonApiOutput_({ ok: false, error: String(err.message || err) });
    }
  }
  /** JSON API over GET: ?api=1&action=getData&token=... */
  if (String(p.api || '') === '1' && String(p.action || '').length > 0) {
    return handleApiRequest_(String(p.action), buildApiParamsFromGet_(p), String(p.token || ''));
  }
  return HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setTitle('Companionship Matching Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * JSON API for external apps. POST body: { "action": "getData", "token": "..." }
 * or { "action": "...", "token": "...", "payload": { ... } }.
 * Token may also be sent as query ?token= for POST.
 */
function doPost(e) {
  var queryToken = e.parameter && e.parameter.token != null ? String(e.parameter.token) : '';
  var raw = e.postData && e.postData.contents ? String(e.postData.contents) : '';
  var parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return jsonApiOutput_({ ok: false, error: 'Invalid JSON body' });
  }
  return handleLovableRequest_(parsed, queryToken);
}

function buildApiParamsFromGet_(p) {
  var out = {};
  if (!p) return out;
  for (var k in p) {
    if (k === 'api' || k === 'action' || k === 'token') continue;
    out[k] = p[k];
  }
  return out;
}

function extractApiParams_(parsed) {
  if (parsed.payload != null && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)) {
    return parsed.payload;
  }
  var out = {};
  for (var key in parsed) {
    if (key === 'action' || key === 'token') continue;
    out[key] = parsed[key];
  }
  return out;
}

/**
 * Shared external JSON API: same routing and token check as doPost and legacy GET.
 * @param {Object} parsed - { action, token?, ... } or { action, token, payload: { ... } } (nested params)
 * @param {string} [queryToken] - optional ?token= from the URL (POST/GET)
 */
function handleLovableRequest_(parsed, queryToken) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonApiOutput_({ ok: false, error: 'Invalid request' });
  }
  var action = String(parsed.action || '');
  var token = String(
    parsed.token != null && String(parsed.token).length > 0 ? parsed.token : queryToken != null ? queryToken : ''
  );
  var params = extractApiParams_(parsed);
  return handleApiRequest_(action, params, token);
}

function getLovableApiToken_() {
  return PropertiesService.getScriptProperties().getProperty(LOVABLE_API_TOKEN_KEY) || '';
}

function verifyLovableApiToken_(token) {
  var expected = getLovableApiToken_();
  if (!expected) return false;
  return String(token || '') === expected;
}

function jsonApiOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleApiRequest_(action, params, token) {
  if (!verifyLovableApiToken_(token)) {
    return jsonApiOutput_({
      ok: false,
      error:
        'Unauthorized. In Apps Script: Project Settings → Script properties → add LOVABLE_API_TOKEN, redeploy the web app, then send the same value as "token" in each request.'
    });
  }
  try {
    var result = dispatchApiAction_(String(action || ''), params || {});
    return jsonApiOutput_({ ok: true, result: result });
  } catch (err) {
    return jsonApiOutput_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * Routes external API actions to existing spreadsheet functions.
 * @param {Object} params
 */
function dispatchApiAction_(action, params) {
  switch (action) {
    case 'getData':
      return getData();
    case 'getSignUpFormHeaders':
      return getSignUpFormHeaders();
    case 'getInsightsPageData':
      return getInsightsPageData();
    case 'getSixMonthReminderPageData':
      return getSixMonthReminderPageData();
    case 'getSurveyAnalysis':
      return getSurveyAnalysis();
    case 'saveCriteriaSettings':
      return saveCriteriaSettings(String(params.settingsJson != null ? params.settingsJson : ''));
    case 'saveVisibilitySettings':
      return saveVisibilitySettings(String(params.settingsJson != null ? params.settingsJson : ''));
    case 'saveReminderEmailSettings':
      return saveReminderEmailSettings(params.settings || params);
    case 'createMatch':
      return createMatch(params.matchObj || params);
    case 'createMatchesBatch':
      return createMatchesBatch(params.matchObjs);
    case 'updateMatchData':
      return updateMatchData(String(params.matchId), String(params.field), params.value);
    case 'updateMatchLastContactDate':
      return updateMatchLastContactDate(String(params.matchId), String(params.isoDateOrEmpty != null ? params.isoDateOrEmpty : ''));
    case 'deleteMatch':
      return deleteMatch(String(params.matchId));
    case 'deleteMatchesBatch':
      return deleteMatchesBatch(params.matchIds);
    case 'updateMatchesStatusBatch':
      return updateMatchesStatusBatch(params.matchIds, String(params.status));
    case 'updateCompanionNote':
      return updateCompanionNote(
        params.companionId != null ? params.companionId : params.rowNumber,
        params.note != null ? String(params.note) : ''
      );
    case 'updateCompanionInternalStatus':
      return updateCompanionInternalStatus(
        params.companionId != null ? params.companionId : params.rowNumber,
        params.value != null ? String(params.value) : ''
      );
    case 'updateCompanionLastContactDate':
      return updateCompanionLastContactDate(
        params.companionId != null ? params.companionId : params.rowNumber,
        params.isoDateOrEmpty != null ? String(params.isoDateOrEmpty) : ''
      );
    case 'getPublicShareLink':
      return getPublicShareLink(String(params.rowId));
    case 'getProfilePdfBase64':
      return getProfilePdfBase64(String(params.rowId));
    case 'previewSixMonthReminders':
      return previewSixMonthReminders();
    case 'runSixMonthReminderJob':
      return runSixMonthReminderJob();
    case 'sendSixMonthReminderTestEmail':
      return sendSixMonthReminderTestEmail(String(params.testToEmail || params.email || ''));
    case 'installDailySixMonthReminderTrigger':
      return installDailySixMonthReminderTrigger();
    case 'removeDailySixMonthReminderTriggers':
      return removeDailySixMonthReminderTriggers();
    case 'health':
      return { service: 'companionship-api', time: new Date().toISOString() };
    default:
      throw new Error('Unknown action: ' + action);
  }
}

function onOpen() {
  // Build menus here so they still appear if SheetCompanionTools.gs is missing/out of date.
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('Companion tools')
      .addItem('Open sidebar', 'showCompanionToolsSidebar')
      .addItem('Open matching dashboard…', 'openApp')
      .addItem('Send test new-signup email', 'sendSignUpNotificationTestForLastRow')
      .addToUi();
    ui.createMenu('Admin')
      .addItem('Prepare Match Queue sheet', 'ensureMatchQueueSheet')
      .addItem('Process Match Queue', 'processMatchQueueFromSheet')
      .addSeparator()
      .addItem('Check match IDs (report only)', 'previewMatchIdMigration')
      .addItem('Repair match IDs…', 'migrateMatchesToStableIds')
      .addSeparator()
      .addItem('Sync Volunteers & Companions tabs', 'syncVolunteersAndCompanionsFromSignUpForm')
      .addItem('Apply Matches dropdown & Quit highlighting', 'applyCompanionSheetFormatting')
      .addSeparator()
      .addItem('Install new-signup email alert', 'installSignUpNotificationTrigger')
      .addToUi();
  } catch (e) {
    // No UI (e.g. headless) — ignore.
  }
}

function openApp() {
  const html = HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setWidth(1200)
    .setHeight(850)
    .setTitle('Companionship Matching Dashboard');
  
  SpreadsheetApp.getUi().showModalDialog(html, 'Companionship Matching Dashboard');
}

/** True if this form column header should be hidden on public profile / PDF (contact & internal). */
function isContactOrSensitiveHeader_(header) {
  var s = String(header || '').toLowerCase();
  if (s.indexOf('email') >= 0) return true;
  if (s.indexOf('e-mail') >= 0) return true;
  if (s.indexOf('phone') >= 0) return true;
  if (s.indexOf('telephone') >= 0) return true;
  if (s.indexOf('mobile') >= 0) return true;
  if (s.indexOf('cell phone') >= 0) return true;
  if (s.indexOf('last name') >= 0) return true;
  if (s.indexOf('surname') >= 0) return true;
  if (s.indexOf('internal note') >= 0) return true;
  if (s.indexOf('internal status') >= 0) return true;
  return false;
}

/** Public profile / PDF only — extra staff or system columns not shown on public link or PDF. */
function isPublicProfileExcludedQuestionHeader_(header) {
  var s = String(header || '').toLowerCase();
  if (s.indexOf('timestamp') >= 0) return true;
  if (s === COMPANION_ID_HEADER.toLowerCase()) return true;
  if (s.indexOf('waiver') >= 0) return true;
  if (s.indexOf('signature') >= 0) return true;
  if (s.indexOf('last contact') >= 0) return true;
  if (s.indexOf('volunteer status') >= 0) return true;
  if (s.indexOf('staff status') >= 0) return true;
  if (s.indexOf('companion status') >= 0) return true;
  if (s.indexOf('program status') >= 0) return true;
  if (s.indexOf('column') >= 0) return true;
  return false;
}

/** Display dates as MM/dd/yyyy (script time zone). */
function formatDateMMDD_(value) {
  if (value == null || value === '') return '';
  var d = value instanceof Date ? value : null;
  if (!d) {
    var tryParse = new Date(value);
    if (!isNaN(tryParse.getTime())) d = tryParse;
  }
  if (!d || isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

/** Allowed values for Matches column D (Status). */
var MATCH_STATUS_OPTIONS = ['Just Matched', 'Active', 'Canceled', 'Dismissed'];

/** Matches sheet column I — ensure header exists for older spreadsheets. */
function ensureMatchesLastContactColumn_(sheet) {
  if (!sheet) return;
  var lc = sheet.getLastColumn();
  if (lc < 9) {
    sheet.getRange(1, 9).setValue('Last Contact Date');
  }
}

/**
 * Dropdown on Matches column D: Just Matched, Active, Canceled, Dismissed.
 * Conditional formatting only for Dismissed (no per-row paint — that was too slow).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureMatchesStatusDropdown_(sheet) {
  if (!sheet) return;
  if (sheet.getRange(1, 4).getValue() !== 'Status') {
    sheet.getRange(1, 4).setValue('Status');
  }
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var endRow = Math.max(lastRow + 50, 100);
  var range = sheet.getRange(2, 4, endRow - 1, 1);
  range.clearDataValidations();
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(MATCH_STATUS_OPTIONS, true)
      .setAllowInvalid(false)
      .setHelpText('Choose Just Matched, Active, Canceled, or Dismissed.')
      .build()
  );

  var width = Math.max(sheet.getLastColumn(), 9);
  var rowRange = sheet.getRange(2, 1, endRow - 1, width);
  if (typeof clearSheetBandings_ === 'function') clearSheetBandings_(sheet);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LOWER(TRIM($D2))="dismissed"')
      .setBackground('#FECACA')
      .setRanges([rowRange])
      .build()
  ]);
}

/**
 * Sign Up Form: Internal Status dropdown + conditional-format row colors (fast).
 */
function applySignUpFormInternalStatusFormatting_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var c = buildCompanionColumnIndices(headers);
  if (c.internalStatus == null || c.internalStatus < 0) {
    throw new Error(
      'Sign Up Form has no Internal Status column (header must contain "Internal Status", "Staff Status", "Companion Status", or "Program Status").'
    );
  }
  var statusCol = c.internalStatus + 1;
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var endRow = Math.max(lastRow + 50, 100);
  var statusRange = sheet.getRange(2, statusCol, endRow - 1, 1);
  statusRange.clearDataValidations();
  statusRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Active', 'Quit', 'Unresponsive', 'Dismissed'], true)
      .setAllowInvalid(true)
      .setHelpText('Choose Active, Quit, Unresponsive, or Dismissed (or leave blank).')
      .build()
  );

  var colLetter = sheet.getRange(1, statusCol).getA1Notation().replace(/\d/g, '');
  var rowRange = sheet.getRange(2, 1, endRow - 1, lastCol);
  var quitColor =
    typeof ROSTER_QUIT_HIGHLIGHT_COLOR !== 'undefined' ? ROSTER_QUIT_HIGHLIGHT_COLOR : '#E8D4C4';
  var unColor =
    typeof ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR !== 'undefined'
      ? ROSTER_UNRESPONSIVE_HIGHLIGHT_COLOR
      : '#FED7AA';
  var disColor =
    typeof ROSTER_DISMISSED_HIGHLIGHT_COLOR !== 'undefined'
      ? ROSTER_DISMISSED_HIGHLIGHT_COLOR
      : '#FECACA';

  if (typeof clearSheetBandings_ === 'function') clearSheetBandings_(sheet);

  // Replace only our status rules; keep other CF when possible (best-effort, fast path = replace all if merge fails).
  try {
    var existing = sheet.getConditionalFormatRules() || [];
    var kept = [];
    for (var i = 0; i < existing.length; i++) {
      try {
        var f = existing[i].getBooleanCondition();
        var formula =
          f && f.getCriteriaValues && f.getCriteriaValues()[0]
            ? String(f.getCriteriaValues()[0]).toLowerCase()
            : '';
        if (
          formula.indexOf('quit') >= 0 ||
          formula.indexOf('unresponsive') >= 0 ||
          formula.indexOf('dismissed') >= 0
        ) {
          continue;
        }
      } catch (skipErr) {
        // keep
      }
      kept.push(existing[i]);
    }
    kept.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="quit"')
        .setBackground(quitColor)
        .setRanges([rowRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="unresponsive"')
        .setBackground(unColor)
        .setRanges([rowRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="dismissed"')
        .setBackground(disColor)
        .setRanges([rowRange])
        .build()
    );
    sheet.setConditionalFormatRules(kept);
  } catch (cfErr) {
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="quit"')
        .setBackground(quitColor)
        .setRanges([rowRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="unresponsive"')
        .setBackground(unColor)
        .setRanges([rowRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=LOWER(TRIM($' + colLetter + '2))="dismissed"')
        .setBackground(disColor)
        .setRanges([rowRange])
        .build()
    ]);
  }
}

/** Headers, last-contact column, and Status dropdown for the Matches tab. */
function ensureMatchesSheetSetup_(sheet) {
  if (!sheet) return;
  ensureMatchesLastContactColumn_(sheet);
  ensureMatchesStatusDropdown_(sheet);
}

function formatMatchSheetDateCell_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return formatDateMMDD_(v);
  var s = String(v).trim();
  if (!s) return '';
  var d = new Date(s);
  if (!isNaN(d.getTime())) return formatDateMMDD_(d);
  return s;
}

var VISIBILITY_SETTINGS_KEY = 'UI_VISIBILITY_SETTINGS';

function getDefaultVisibilitySettings_() {
  return {
    directory: {
      volunteerBadge: true,
      contactEmailPhone: true,
      publicShareHint: true,
      shareActions: true,
      allSignUpQA: true,
      restrictDirectoryColumns: false,
      includedDirectoryQuestionHeaders: [],
      quickSummary: true,
      livedExperienceTags: true,
      availabilityGrid: true,
      internalNotes: true
    },
    matchPicker: {
      matchPercent: true,
      matchReasons: true
    },
    public: {
      showLastName: false,
      showFormResponses: true,
      restrictQuestions: false,
      includedQuestionHeaders: []
    }
  };
}

function mergeVisibilitySettings_(saved) {
  var d = getDefaultVisibilitySettings_();
  if (!saved || typeof saved !== 'object') return d;
  if (saved.directory && typeof saved.directory === 'object') {
    d.directory = Object.assign({}, d.directory, saved.directory);
    if (Array.isArray(saved.directory.includedDirectoryQuestionHeaders)) {
      d.directory.includedDirectoryQuestionHeaders = saved.directory.includedDirectoryQuestionHeaders.map(function (h) {
        return String(h);
      });
    }
  }
  if (saved.matchPicker && typeof saved.matchPicker === 'object') {
    d.matchPicker = Object.assign({}, d.matchPicker, saved.matchPicker);
  }
  if (saved.public && typeof saved.public === 'object') {
    d.public = Object.assign({}, d.public, saved.public);
    if (Array.isArray(saved.public.includedQuestionHeaders)) {
      d.public.includedQuestionHeaders = saved.public.includedQuestionHeaders.map(function (h) {
        return String(h);
      });
    }
  }
  return d;
}

function getVisibilitySettings_() {
  var raw = PropertiesService.getScriptProperties().getProperty(VISIBILITY_SETTINGS_KEY);
  if (!raw) return getDefaultVisibilitySettings_();
  try {
    return mergeVisibilitySettings_(JSON.parse(raw));
  } catch (e) {
    return getDefaultVisibilitySettings_();
  }
}

/**
 * Column headers from the sign-up sheet (row 1), for display-settings checklists.
 * @return {string[]}
 */
function getSignUpFormHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return [];
  var lc = sheet.getLastColumn();
  if (lc < 1) return [];
  var row = sheet.getRange(1, 1, 1, lc).getValues()[0];
  var out = [];
  var seen = {};
  for (var i = 0; i < row.length; i++) {
    var h = String(row[i] != null ? row[i] : '').trim();
    if (!h || seen[h]) continue;
    seen[h] = true;
    out.push(h);
  }
  return out;
}

function applyPublicQuestionFilter_(allQuestions, visibility) {
  var pub = visibility && visibility.public ? visibility.public : getDefaultVisibilitySettings_().public;
  var base = filterPublicQuestions_(allQuestions);
  if (pub.showFormResponses === false) return [];
  if (pub.restrictQuestions && pub.includedQuestionHeaders && pub.includedQuestionHeaders.length > 0) {
    var set = {};
    for (var i = 0; i < pub.includedQuestionHeaders.length; i++) {
      set[String(pub.includedQuestionHeaders[i]).trim()] = true;
    }
    return base.filter(function (item) {
      return set[String(item.question || '').trim()];
    });
  }
  return base;
}

function filterPublicQuestions_(allQuestions) {
  if (!allQuestions || !allQuestions.length) return [];
  return allQuestions.filter(function (item) {
    if (isContactOrSensitiveHeader_(item.question)) return false;
    if (isPublicProfileExcludedQuestionHeader_(item.question)) return false;
    var h = String(item.question || '')
      .trim()
      .toLowerCase();
    if (h === 'first name') return false;
    return true;
  });
}

function buildPublicTemplateData_(companion, visibility) {
  var vis = visibility && visibility.public ? visibility.public : getDefaultVisibilitySettings_().public;
  var first = String(companion.firstName || 'Participant').trim() || 'Participant';
  var last = String(companion.lastName || '').trim();
  var displayName = vis.showLastName && last ? first + ' ' + last : first;
  var filtered = applyPublicQuestionFilter_(companion.allQuestions || [], visibility || getVisibilitySettings_());
  var rows = filtered.map(function (q) {
    var a = q.answer != null ? String(q.answer).trim() : '';
    return { question: q.question, answer: a ? q.answer : '—' };
  });
  return { firstName: first, displayName: displayName, rows: rows };
}

/** 0-based index of the Companion ID column in a header row, or -1. */
function companionIdColumnIndex_(headers) {
  if (!headers) return -1;
  var want = COMPANION_ID_HEADER.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] != null ? headers[i] : '').trim().toLowerCase() === want) return i;
  }
  return -1;
}

function formatCompanionId_(seq) {
  var s = String(seq);
  while (s.length < 4) s = '0' + s;
  return COMPANION_ID_PREFIX + s;
}

/**
 * Gives every sign-up row a permanent Companion ID, creating the column if it does not exist.
 * Cheap to call on read paths: it only takes the script lock when IDs are actually missing.
 * @return {{ colIndex: number, assigned: number }} colIndex is 0-based, -1 when unavailable.
 */
function ensureCompanionIds_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return { colIndex: -1, assigned: 0 };

  var lastCol = sheet.getLastColumn();
  var headers = lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var idx = companionIdColumnIndex_(headers);
  var lastRow = sheet.getLastRow();

  if (idx >= 0) {
    if (lastRow < 2) return { colIndex: idx, assigned: 0 };
    var existing = sheet.getRange(2, idx + 1, lastRow - 1, 1).getValues();
    var missing = false;
    for (var i = 0; i < existing.length; i++) {
      if (!String(existing[i][0] != null ? existing[i][0] : '').trim()) {
        missing = true;
        break;
      }
    }
    if (!missing) return { colIndex: idx, assigned: 0 };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { colIndex: idx, assigned: 0 };
  }
  try {
    // Re-read inside the lock: another execution may have added the column or filled the gaps.
    lastCol = sheet.getLastColumn();
    headers = lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    idx = companionIdColumnIndex_(headers);
    if (idx < 0) {
      // Append at the end; every existing column keeps its position, which VolunteersSync relies on
      // because it pins the volunteer flag to column AQ.
      idx = lastCol;
      sheet.getRange(1, idx + 1).setValue(COMPANION_ID_HEADER);
    }
    lastRow = sheet.getLastRow();
    if (lastRow < 2) return { colIndex: idx, assigned: 0 };

    var range = sheet.getRange(2, idx + 1, lastRow - 1, 1);
    var values = range.getValues();
    var maxSeq = 0;
    for (var r = 0; r < values.length; r++) {
      var m = /^C-(\d+)$/i.exec(String(values[r][0] != null ? values[r][0] : '').trim());
      if (m) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }
    var assigned = 0;
    for (var k = 0; k < values.length; k++) {
      if (String(values[k][0] != null ? values[k][0] : '').trim()) continue;
      maxSeq++;
      values[k][0] = formatCompanionId_(maxSeq);
      assigned++;
    }
    if (assigned) range.setValues(values);
    return { colIndex: idx, assigned: assigned };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Current sign-up row for a Companion ID. Plain row numbers are still accepted so links,
 * queue entries and menu actions created before stable IDs keep working.
 * @param {string|number} idOrRow
 * @return {number} 1-based sheet row
 */
function resolveCompanionRow_(idOrRow) {
  var key = String(idOrRow != null ? idOrRow : '').trim();
  if (!key) throw new Error('Invalid profile reference.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) throw new Error('Form sheet not found.');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) throw new Error('No sign-up rows found.');

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = companionIdColumnIndex_(headers);
  if (idx >= 0) {
    var ids = sheet.getRange(2, idx + 1, lastRow - 1, 1).getValues();
    var want = key.toLowerCase();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0] != null ? ids[i][0] : '').trim().toLowerCase() === want) return i + 2;
    }
  }
  if (/^\d+$/.test(key)) {
    var r = parseInt(key, 10);
    if (r >= 2 && r <= lastRow) return r;
  }
  throw new Error('No sign-up row found for "' + key + '".');
}

/**
 * Full companion record by Companion ID or sign-up row number.
 * @param {string|number} idOrRow
 */
function getCompanionByRef_(idOrRow) {
  ensureCompanionIds_();
  var r = resolveCompanionRow_(idOrRow);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) throw new Error('Form sheet not found.');
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('No data.');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
  var colIdx = buildCompanionColumnIndices(headers);
  var p = parseCompanionRow(row, colIdx, r);
  p.allQuestions = buildAllFormQandA_(headers, row);
  return p;
}

function servePublicProfile_(profileRef) {
  try {
    var c = getCompanionByRef_(profileRef);
    var visibility = getVisibilitySettings_();
    var data = buildPublicTemplateData_(c, visibility);
    var t = HtmlService.createTemplateFromFile('PublicProfile');
    t.displayName = data.displayName;
    t.firstName = data.firstName;
    t.rows = data.rows;
    return t
      .evaluate()
      .setTitle(data.displayName + ' — Profile')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;"><p>Profile could not be loaded.</p></body></html>'
    ).setTitle('Profile');
  }
}

function getWebAppBaseUrl_() {
  return resolveWebAppBaseUrl_();
}

/**
 * @return {{ ok: boolean, url: string, message: string }}
 */
function getPublicShareLink(rowId) {
  // Link by Companion ID so a shared link keeps pointing at the same person after the sheet is sorted.
  var cid;
  try {
    cid = getCompanionByRef_(rowId).id;
  } catch (e) {
    return { ok: false, url: '', message: String(e.message || e) };
  }
  var base = resolveWebAppBaseUrl_();
  if (!base) {
    return {
      ok: false,
      url: '',
      message:
        'No Web app URL available. In this sidebar, paste your /exec URL under “Web app URL” and click Save, or set Script property WEB_APP_PUBLIC_BASE_URL. Example suffix: ?view=public&cid=' +
        encodeURIComponent(String(cid))
    };
  }
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return { ok: true, url: base + sep + 'view=public&cid=' + encodeURIComponent(String(cid)), message: '' };
}

/**
 * Default matching criteria — keep in sync with DEFAULT_CRITERIA_CONFIG in App.html.
 * @return {Array<Object>}
 */
function sidebarMatch_defaultCriteria_() {
  return [
    { key: 'borough', label: 'Borough', weight: 15, category: 'Logistics', enabled: true },
    { key: 'willingToTravel', label: 'Willing to Travel', weight: 5, category: 'Logistics', enabled: true },
    { key: 'availability', label: 'Availability', weight: 25, category: 'Logistics', enabled: true },
    { key: 'age', label: 'Age Group', weight: 5, category: 'Identity', enabled: true },
    { key: 'pronouns', label: 'Pronouns', weight: 5, category: 'Identity', enabled: true },
    { key: 'raceEthnicity', label: 'Race/Ethnicity', weight: 5, category: 'Identity', enabled: true },
    { key: 'gender', label: 'Gender', weight: 5, category: 'Identity', enabled: true },
    { key: 'lgbtq', label: 'LGBTQ+ Status', weight: 10, category: 'Identity', enabled: true },
    { key: 'hasExperiencedDV', label: 'DV Survivor', weight: 5, category: 'Lived Experience', enabled: true },
    { key: 'hasBeenIncarcerated', label: 'Incarceration History', weight: 5, category: 'Lived Experience', enabled: true },
    { key: 'hasExperiencedHomelessness', label: 'Homelessness History', weight: 5, category: 'Lived Experience', enabled: true },
    { key: 'receivingMentalHealthServices', label: 'Mental Health Svcs', weight: 5, category: 'Lived Experience', enabled: true },
    { key: 'isVeteran', label: 'Veteran', weight: 5, category: 'Lived Experience', enabled: true }
  ];
}

/** @return {Array<Object>} */
function sidebarMatch_getCriteriaArray_() {
  var raw = PropertiesService.getScriptProperties().getProperty('MATCHING_CRITERIA');
  if (raw) {
    try {
      var arr = JSON.parse(raw);
      if (arr && arr.length) return arr;
    } catch (e) {}
  }
  return sidebarMatch_defaultCriteria_();
}

/** @return {Array<string>} */
function sidebarMatch_getOverlappingAvailability_(c1, c2) {
  var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  var overlaps = [];
  for (var i = 0; i < days.length; i++) {
    var day = days[i];
    var s1 = c1.availability && c1.availability[day] ? String(c1.availability[day]) : '';
    var s2 = c2.availability && c2.availability[day] ? String(c2.availability[day]) : '';
    if (s1 && s2 && s1 !== 'Unavailable' && s2 !== 'Unavailable') {
      overlaps.push(day.charAt(0).toUpperCase() + day.slice(1));
    }
  }
  return overlaps;
}

/**
 * Match score for sidebar — keep logic aligned with calculateMatchPercentage in App.html.
 * @return {{ percent: number, reasons: Array<string> }}
 */
function sidebarMatch_calculatePercentage_(c1, c2, config) {
  var score = 0;
  var maxScore = 0;
  var reasons = [];
  var configMap = {};
  for (var ci = 0; ci < config.length; ci++) {
    var entry = config[ci];
    if (entry && entry.key) configMap[entry.key] = entry;
  }

  function addScore(key, points, reason) {
    var c = configMap[key];
    if (c && c.enabled) {
      score += points;
      reasons.push(reason);
    }
  }

  for (var j = 0; j < config.length; j++) {
    if (config[j] && config[j].enabled) maxScore += config[j].weight || 0;
  }
  if (maxScore === 0) return { percent: 0, reasons: [] };

  if (String(c1.borough || '') === String(c2.borough || '')) {
    addScore('borough', configMap['borough'] ? configMap['borough'].weight || 15 : 15, 'Same Borough (' + String(c1.borough || '') + ')');
  } else if (String(c1.willingToTravel || '') === 'Yes' || String(c2.willingToTravel || '') === 'Yes') {
    addScore('willingToTravel', configMap['willingToTravel'] ? configMap['willingToTravel'].weight || 5 : 5, 'Willing to travel');
  }

  if (String(c1.age || '') === String(c2.age || '')) addScore('age', configMap['age'] ? configMap['age'].weight || 5 : 5, 'Same age group');
  if (String(c1.pronouns || '') === String(c2.pronouns || '') && String(c1.pronouns || '').trim()) {
    addScore('pronouns', configMap['pronouns'] ? configMap['pronouns'].weight || 3 : 3, 'Same Pronouns');
  }
  if (String(c1.raceEthnicity || '') === String(c2.raceEthnicity || '') && String(c1.raceEthnicity || '').trim()) {
    addScore('raceEthnicity', configMap['raceEthnicity'] ? configMap['raceEthnicity'].weight || 5 : 5, 'Same Race/Ethnicity');
  }
  if (String(c1.gender || '') === String(c2.gender || '')) addScore('gender', configMap['gender'] ? configMap['gender'].weight || 5 : 5, 'Gender Match');
  if (String(c1.lgbtq || '') === 'Yes' && String(c2.lgbtq || '') === 'Yes') {
    addScore('lgbtq', configMap['lgbtq'] ? configMap['lgbtq'].weight || 10 : 10, 'Both LGBTQ+');
  }

  var experiences = [
    'hasExperiencedDV',
    'hasBeenIncarcerated',
    'hasExperiencedHomelessness',
    'receivingMentalHealthServices',
    'isVeteran'
  ];
  for (var k = 0; k < experiences.length; k++) {
    var key = experiences[k];
    if (String(c1[key] || '') === 'Yes' && String(c2[key] || '') === 'Yes') {
      var w = configMap[key] ? configMap[key].weight || 8 : 8;
      var lbl = configMap[key] && configMap[key].label ? configMap[key].label : key;
      addScore(key, w, 'Shared: ' + lbl);
    }
  }

  if (configMap['availability'] && configMap['availability'].enabled) {
    var overlaps = sidebarMatch_getOverlappingAvailability_(c1, c2);
    if (overlaps.length > 0) {
      var weight = configMap['availability'].weight || 25;
      var fraction = overlaps.length / 3;
      if (fraction > 1) fraction = 1;
      score += weight * fraction;
      reasons.push(overlaps.length + ' overlapping days');
    }
  }

  var percent = Math.round((score / maxScore) * 100);
  return { percent: percent, reasons: reasons };
}

/** @return {Array<Object>} Parsed companions (no allQuestions) for scoring. */
function sidebarMatch_loadCompanionsParsed_() {
  ensureCompanionIds_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!formSheet) return [];
  var lastFormRow = formSheet.getLastRow();
  var lastFormCol = formSheet.getLastColumn();
  if (lastFormRow < 2 || lastFormCol < 1) return [];
  var formData = formSheet.getRange(1, 1, lastFormRow, lastFormCol).getValues();
  var headers = formData[0];
  var rows = formData.slice(1);
  var colIdx = buildCompanionColumnIndices(headers);
  var companions = [];
  for (var i = 0; i < rows.length; i++) {
    companions.push(parseCompanionRow(rows[i], colIdx, i + 2));
  }
  return companions;
}

/**
 * Sign-up people for spreadsheet sidebar dropdown.
 * @return {Array<{ rowId: string, displayName: string }>}
 */
function getSignupPeopleForSidebar() {
  var companions = sidebarMatch_loadCompanionsParsed_();
  var out = companions.map(function (p) {
    var name =
      (String(p.firstName || '').trim() + ' ' + String(p.lastName || '').trim()).trim() || 'Sign-up ' + p.id;
    return {
      rowId: String(p.id),
      listName: name,
      displayName: name + ' (' + p.id + ', row ' + p.row + ')'
    };
  });
  out.sort(function (a, b) {
    return String(a.listName).localeCompare(String(b.listName), undefined, { sensitivity: 'base' });
  });
  return out;
}

/**
 * Ranked match suggestions for Companion tools sidebar (same scoring as dashboard).
 * @param {string} rowId Sign-up sheet row number
 * @return {Array<{ rowId: string, displayName: string, percent: number, reasons: Array<string> }>}
 */
function getMatchSuggestionsForSidebarRow(rowId) {
  var criteria = sidebarMatch_getCriteriaArray_();
  var companions = sidebarMatch_loadCompanionsParsed_();
  var id = String(rowId != null ? rowId : '').trim();
  var c1 = null;
  for (var i = 0; i < companions.length; i++) {
    if (String(companions[i].id) === id) {
      c1 = companions[i];
      break;
    }
  }
  if (!c1) return [];
  var out = [];
  for (var j = 0; j < companions.length; j++) {
    var c2 = companions[j];
    if (String(c2.id) === id) continue;
    var scored = sidebarMatch_calculatePercentage_(c1, c2, criteria);
    var dn =
      (String(c2.firstName || '').trim() + ' ' + String(c2.lastName || '').trim()).trim() || 'Sign-up ' + c2.id;
    out.push({
      rowId: String(c2.id),
      displayName: dn,
      percent: scored.percent,
      reasons: scored.reasons
    });
  }
  out.sort(function (a, b) {
    return b.percent - a.percent;
  });
  return out;
}

/**
 * PDF of public-safe profile (first name + form responses, no contact columns).
 * @return {{ base64: string, fileName: string }}
 */
function getProfilePdfBase64(rowId) {
  var c = getCompanionByRef_(rowId);
  var visibility = getVisibilitySettings_();
  var data = buildPublicTemplateData_(c, visibility);
  var t = HtmlService.createTemplateFromFile('PublicProfile');
  t.displayName = data.displayName;
  t.firstName = data.firstName;
  t.rows = data.rows;
  var pdfBlob = t.evaluate().getAs(MimeType.PDF);
  var safe = String(data.firstName).replace(/[^\w\-]+/g, '') || 'profile';
  return {
    base64: Utilities.base64Encode(pdfBlob.getBytes()),
    fileName: 'Companion-' + safe + '-profile.pdf'
  };
}

/**
 * FETCH DATA
 */
function getData() {
  ensureCompanionIds_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Get Companions
  const formSheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!formSheet) throw new Error('Sheet "' + FORM_SHEET_NAME + '" not found.');
  
  const lastFormRow = formSheet.getLastRow();
  const lastFormCol = formSheet.getLastColumn();
  let companions = [];
  if (lastFormRow >= 2 && lastFormCol >= 1) {
    const formData = formSheet.getRange(1, 1, lastFormRow, lastFormCol).getValues();
    const headers = formData[0];
    const rows = formData.slice(1);
    const colIdx = buildCompanionColumnIndices(headers);
    companions = rows.map(function (row, i) {
      var p = parseCompanionRow(row, colIdx, i + 2);
      p.allQuestions = buildAllFormQandA_(headers, row);
      return p;
    });
  }
  
  // 2. Get Matches
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) {
    matchSheet = ss.insertSheet('Matches');
    // Added Name columns for better spreadsheet readability
    matchSheet.appendRow([
      'Match ID',
      'Companion 1 ID',
      'Companion 2 ID',
      'Status',
      'Notes',
      'Created At',
      'C1 Name',
      'C2 Name',
      'Last Contact Date'
    ]);
  }
  
  ensureMatchesSheetSetup_(matchSheet);
  const lastMatchRow = matchSheet.getLastRow();
  let matches = [];
  if (lastMatchRow >= 2) {
    const matchCols = Math.max(matchSheet.getLastColumn(), 9);
    const matchData = matchSheet.getRange(1, 1, lastMatchRow, matchCols).getValues();
    const matchRows = matchData.slice(1);
    matches = matchRows
      .map(function (r) {
        return {
          id: String(r[0] != null ? r[0] : '').trim(),
          companion1Id: String(r[1] != null ? r[1] : '').trim(),
          companion2Id: String(r[2] != null ? r[2] : '').trim(),
          status: r[3],
          notes: r[4],
          createdAt: r[5],
          lastContactDate: formatMatchSheetDateCell_(r[8])
        };
      })
      .filter(function (m) {
        return m.id && m.companion1Id && m.companion2Id;
      });
  }

  // 3. Get Criteria Settings
  const scriptProperties = PropertiesService.getScriptProperties();
  const savedCriteria = scriptProperties.getProperty('MATCHING_CRITERIA');
  let criteria = null;
  if (savedCriteria) {
    try { criteria = JSON.parse(savedCriteria); } catch(e) {}
  }
  
  return { companions, matches, criteria, visibility: getVisibilitySettings_() };
}

/**
 * SAVE CRITERIA SETTINGS
 */
function saveCriteriaSettings(settingsJson) {
  PropertiesService.getScriptProperties().setProperty('MATCHING_CRITERIA', settingsJson);
  return true;
}

/**
 * Save directory / match picker / public profile visibility toggles (JSON).
 */
function saveVisibilitySettings(settingsJson) {
  PropertiesService.getScriptProperties().setProperty(VISIBILITY_SETTINGS_KEY, settingsJson);
  return true;
}

/**
 * SAVE A NEW MATCH
 */
function createMatch(matchObj) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return false;
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Matches');
    if (!sheet) sheet = ss.insertSheet('Matches');

    const a = String(matchObj.companion1Id != null ? matchObj.companion1Id : '').trim();
    const b = String(matchObj.companion2Id != null ? matchObj.companion2Id : '').trim();
    if (!a || !b || a === b) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const x = String(data[i][1] != null ? data[i][1] : '').trim();
      const y = String(data[i][2] != null ? data[i][2] : '').trim();
      if (!x || !y) continue;
      if ((x === a && y === b) || (x === b && y === a)) return false;
    }

    ensureMatchesSheetSetup_(sheet);
    sheet.appendRow([
      matchObj.id,
      a,
      b,
      matchObj.status,
      matchObj.notes,
      matchObj.createdAt,
      matchObj.c1Name,
      matchObj.c2Name,
      ''
    ]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Save multiple new matches in one lock (duplicate checks + within-batch dedupe).
 * @param {Array<Object>} matchObjs
 * @return {{ created: Array<Object>, skipped: number, reason: string,
 *           skippedDetails: Array<{ companion1Id: string, companion2Id: string, reason: string }> }}
 */
function createMatchesBatch(matchObjs) {
  if (!matchObjs || !matchObjs.length) return { created: [], skipped: 0, reason: '', skippedDetails: [] };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return {
      created: [],
      skipped: matchObjs.length,
      reason: 'busy',
      skippedDetails: [
        {
          companion1Id: '',
          companion2Id: '',
          reason: 'The spreadsheet was busy with another script. Nothing was saved — try again.'
        }
      ]
    };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Matches');
    if (!sheet) sheet = ss.insertSheet('Matches');

    const data = sheet.getDataRange().getValues();
    function pairKey(a, b) {
      return a < b ? a + '\t' + b : b + '\t' + a;
    }
    const existingKeys = {};
    for (let i = 1; i < data.length; i++) {
      const x = String(data[i][1] != null ? data[i][1] : '').trim();
      const y = String(data[i][2] != null ? data[i][2] : '').trim();
      if (!x || !y) continue;
      const names = [String(data[i][6] != null ? data[i][6] : '').trim(), String(data[i][7] != null ? data[i][7] : '').trim()]
        .filter(function (s) {
          return s;
        })
        .join(' + ');
      existingKeys[pairKey(x, y)] = { row: i + 1, names: names, status: String(data[i][3] != null ? data[i][3] : '').trim() };
    }

    const created = [];
    const skippedDetails = [];
    let skipped = 0;
    for (let i = 0; i < matchObjs.length; i++) {
      const matchObj = matchObjs[i];
      const a = String(matchObj.companion1Id != null ? matchObj.companion1Id : '').trim();
      const b = String(matchObj.companion2Id != null ? matchObj.companion2Id : '').trim();
      if (!a || !b || a === b) {
        skipped++;
        skippedDetails.push({
          companion1Id: a,
          companion2Id: b,
          reason: a && a === b ? 'Both sides are the same person.' : 'One of the two people is missing an ID.'
        });
        continue;
      }
      const k = pairKey(a, b);
      if (existingKeys[k]) {
        const hit = existingKeys[k];
        skipped++;
        skippedDetails.push({
          companion1Id: a,
          companion2Id: b,
          reason:
            'Already on the Matches tab at row ' +
            hit.row +
            (hit.names ? ' (' + hit.names + ')' : '') +
            (hit.status ? ', status "' + hit.status + '"' : '') +
            '.'
        });
        continue;
      }
      existingKeys[k] = { row: 0, names: '', status: '' };
      ensureMatchesSheetSetup_(sheet);
      sheet.appendRow([
        matchObj.id,
        a,
        b,
        matchObj.status,
        matchObj.notes,
        matchObj.createdAt,
        matchObj.c1Name,
        matchObj.c2Name,
        ''
      ]);
      created.push({
        id: String(matchObj.id),
        companion1Id: a,
        companion2Id: b,
        status: matchObj.status,
        notes: matchObj.notes,
        createdAt: matchObj.createdAt,
        lastContactDate: ''
      });
    }
    return { created: created, skipped: skipped, reason: skipped ? 'skipped' : '', skippedDetails: skippedDetails };
  } finally {
    lock.releaseLock();
  }
}

/**
 * UPDATE/DELETE HANDLERS
 */
function updateMatchData(matchId, field, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Matches');
  const data = sheet.getDataRange().getValues();
  
  // Determine Column Index
  // A=0, B=1, C=2, D=3(Status), E=4(Notes)
  const colIndex = field === 'status' ? 3 : 4; 
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === matchId) {
      sheet.getRange(i + 1, colIndex + 1).setValue(value);
      if (field === 'status') {
        var width = Math.max(sheet.getLastColumn(), 9);
        var color = String(value || '').trim() === 'Dismissed' ? '#FECACA' : null;
        sheet.getRange(i + 1, 1, 1, width).setBackground(color);
      }
      return true;
    }
  }
  return false;
}

/**
 * Per-pair last contact on the Matches sheet (column I). Pass empty string to clear.
 * @param {string} matchId
 * @param {string} isoDateOrEmpty YYYY-MM-DD from HTML date input
 * @return {boolean}
 */
function updateMatchLastContactDate(matchId, isoDateOrEmpty) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Matches');
  if (!sheet) return false;
  ensureMatchesSheetSetup_(sheet);
  var data = sheet.getDataRange().getValues();
  var mid = String(matchId != null ? matchId : '').trim();
  if (!mid) return false;
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === mid) {
      rowIdx = i + 1;
      break;
    }
  }
  if (rowIdx < 2) return false;
  var colIdx = 9;
  var t = String(isoDateOrEmpty != null ? isoDateOrEmpty : '').trim();
  if (!t) {
    sheet.getRange(rowIdx, colIdx).setValue('');
    return true;
  }
  var parts = t.split('-');
  if (parts.length === 3) {
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    var da = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(mo) && !isNaN(da)) {
      var d = new Date(y, mo, da);
      if (
        !isNaN(d.getTime()) &&
        d.getFullYear() === y &&
        d.getMonth() === mo &&
        d.getDate() === da
      ) {
        sheet.getRange(rowIdx, colIdx).setValue(d);
        return true;
      }
    }
  }
  sheet.getRange(rowIdx, colIdx).setValue(t);
  return true;
}

function deleteMatch(matchId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Matches');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === matchId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

/**
 * Delete many matches in one pass (rows removed high-to-low so indices stay valid).
 * @param {string[]} matchIds
 * @return {{ deleted: number }}
 */
function deleteMatchesBatch(matchIds) {
  if (!matchIds || !matchIds.length) return { deleted: 0 };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Matches');
  if (!sheet) return { deleted: 0 };
  const data = sheet.getDataRange().getValues();
  const want = {};
  for (let k = 0; k < matchIds.length; k++) {
    want[String(matchIds[k])] = true;
  }
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (want[String(data[i][0])]) rowsToDelete.push(i + 1);
  }
  rowsToDelete.sort(function (a, b) {
    return b - a;
  });
  for (let r = 0; r < rowsToDelete.length; r++) {
    sheet.deleteRow(rowsToDelete[r]);
  }
  return { deleted: rowsToDelete.length };
}

/**
 * Set status column for many matches at once.
 * @param {string[]} matchIds
 * @param {string} status
 * @return {{ updated: number }}
 */
function updateMatchesStatusBatch(matchIds, status) {
  if (!matchIds || !matchIds.length) return { updated: 0 };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Matches');
  if (!sheet) return { updated: 0 };
  const data = sheet.getDataRange().getValues();
  const want = {};
  for (let k = 0; k < matchIds.length; k++) {
    want[String(matchIds[k])] = true;
  }
  let n = 0;
  var width = Math.max(sheet.getLastColumn(), 9);
  var color = String(status || '').trim() === 'Dismissed' ? '#FECACA' : null;
  for (let i = 1; i < data.length; i++) {
    if (want[String(data[i][0])]) {
      sheet.getRange(i + 1, 4).setValue(status);
      sheet.getRange(i + 1, 1, 1, width).setBackground(color);
      n++;
    }
  }
  return { updated: n };
}

function updateCompanionNote(companionRef, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return false;
  let r;
  try {
    r = resolveCompanionRow_(companionRef);
  } catch (e) {
    return false;
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let noteCol = headers.findIndex(h => String(h).toUpperCase().includes("INTERNAL NOTES"));
  
  if (noteCol === -1) {
    noteCol = headers.length;
    sheet.getRange(1, noteCol + 1).setValue("INTERNAL NOTES");
  }
  
  sheet.getRange(r, noteCol + 1).setValue(note);
  return true;
}

/** Allowed internal status values for the directory dropdown (empty = clear cell). */
var INTERNAL_STATUS_ALLOWED_ = { Active: true, Quit: true, Unresponsive: true, Dismissed: true };

/**
 * Update internal status. Only Active, Quit, Unresponsive, Dismissed, or blank are written.
 * @return {boolean}
 */
function updateCompanionInternalStatus(companionRef, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return false;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return false;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const c = buildCompanionColumnIndices(headers);
  const colIdx = c.internalStatus;
  if (colIdx == null || colIdx < 0) return false;
  let r;
  try {
    r = resolveCompanionRow_(companionRef);
  } catch (e) {
    return false;
  }
  var v = String(value != null ? value : '').trim();
  if (v && !INTERNAL_STATUS_ALLOWED_[v]) return false;
  sheet.getRange(r, colIdx + 1).setValue(v);
  if (typeof paintRosterStatusRow_ === 'function') {
    paintRosterStatusRow_(sheet, r, colIdx + 1, lastCol);
  }
  return true;
}

/**
 * Update Last Contact Date. Pass empty string to clear. Pass YYYY-MM-DD (from HTML date input) to set a calendar date.
 * Creates a "Last Contact Date" column if none matches.
 * @return {boolean}
 */
function updateCompanionLastContactDate(companionRef, isoDateOrEmpty) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return false;
  const lastCol = sheet.getLastColumn();
  const headers =
    lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const c = buildCompanionColumnIndices(headers);
  var colIdx = c.lastContactDate;
  if (colIdx == null || colIdx < 0) {
    colIdx = Math.max(headers.length, 0);
    sheet.getRange(1, colIdx + 1).setValue('Last Contact Date');
  }
  let r;
  try {
    r = resolveCompanionRow_(companionRef);
  } catch (e) {
    return false;
  }
  var t = String(isoDateOrEmpty != null ? isoDateOrEmpty : '').trim();
  if (!t) {
    sheet.getRange(r, colIdx + 1).setValue('');
    return true;
  }
  var parts = t.split('-');
  if (parts.length === 3) {
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    var da = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(mo) && !isNaN(da)) {
      var d = new Date(y, mo, da);
      if (
        !isNaN(d.getTime()) &&
        d.getFullYear() === y &&
        d.getMonth() === mo &&
        d.getDate() === da
      ) {
        sheet.getRange(r, colIdx + 1).setValue(d);
        return true;
      }
    }
  }
  sheet.getRange(r, colIdx + 1).setValue(t);
  return true;
}

// --- PARSER (column indices built once per sheet; avoids O(rows × cols × fields) findIndex scans) ---
function buildCompanionColumnIndices(headers) {
  const lower = [];
  for (var i = 0; i < headers.length; i++) {
    lower[i] = String(headers[i]).toLowerCase();
  }
  function col(needle) {
    var n = needle.toLowerCase();
    for (var j = 0; j < lower.length; j++) {
      if (lower[j].indexOf(n) !== -1) return j;
    }
    return -1;
  }
  /** First column whose header contains any of the needles (in order). */
  function colFirst(needles) {
    for (var k = 0; k < needles.length; k++) {
      var idx = col(needles[k]);
      if (idx >= 0) return idx;
    }
    return -1;
  }
  return {
    companionId: col('companion id'),
    firstName: col('First Name'),
    lastName: col('Last Name'),
    email: col('Email'),
    phone: col('Phone Number'),
    borough: col('Borough'),
    neighborhood: col('neighborhood'),
    willingToTravel: col('willing to travel'),
    age: col('age'),
    pronouns: col('pronouns'),
    raceEthnicity: col('race/s'),
    gender: col('describe your gender'),
    lgbtq: col('LGBTQ'),
    relationshipStatus: col('committed relationship'),
    hasExperiencedDV: col('domestic violence'),
    hasBeenIncarcerated: col('incarcerated'),
    hasExperiencedHomelessness: col('homelessness'),
    receivingMentalHealthServices: col('currently receiving mental health'),
    receivingSubstanceUseServices: col('currently receiving substance use'),
    historyMentalHealthServices: col('ever received mental health'),
    historySubstanceUseServices: col('ever received substance use'),
    isVeteran: col('veteran'),
    accessibilityNeeds: col('accessibility needs'),
    internalNotes: col('INTERNAL NOTES'),
    essayHobbies: col('hobbies'),
    essayExpectations: col('important things that you want'),
    essayShared: col('experiences do you feel that you and your friend should have'),
    essayMotivation: col('Why are you interested'),
    essayCreativity: col('express your creativity'),
    availMonday: col('[monday]'),
    availTuesday: col('[tuesday]'),
    availWednesday: col('[wednesday]'),
    availThursday: col('[thursday]'),
    availFriday: col('[friday]'),
    availSaturday: col('[saturday]'),
    availSunday: col('[sunday]'),
    volunteer: colFirst([
      'are you a volunteer',
      'signing up as',
      'volunteer',
      'participant type',
      'role'
    ]),
    enrollmentDate: colFirst([
      'enrollment date',
      'date enrolled',
      'enrolled',
      'sign up date',
      'timestamp'
    ]),
    internalStatus: colFirst([
      'internal status',
      'staff status',
      'companion status',
      'program status'
    ]),
    lastContactDate: colFirst([
      'last contact date',
      'last contact',
      'contact date',
      'date of last contact'
    ])
  };
}

function cellAt(row, colIndex) {
  if (colIndex == null || colIndex < 0 || colIndex >= row.length) return '';
  var v = row[colIndex];
  if (v == null) return '';
  if (v instanceof Date) return formatDateMMDD_(v);
  return String(v);
}

/** Every column on the sign-up row as { question, answer } (uses sheet headers). */
function buildAllFormQandA_(headers, row) {
  var out = [];
  var max = Math.max(headers.length, row.length);
  for (var i = 0; i < max; i++) {
    var h = i < headers.length ? headers[i] : '';
    h = String(h != null ? h : '').trim() || 'Column ' + (i + 1);
    var v = i < row.length ? row[i] : '';
    var val = '';
    if (v instanceof Date) {
      val = formatDateMMDD_(v);
    } else {
      val = v != null ? String(v) : '';
    }
    out.push({ question: h, answer: val });
  }
  return out;
}

function parseCompanionRow(row, c, rowNum) {
  function avail(key) {
    var s = cellAt(row, c[key]);
    return s ? s : 'Unavailable';
  }
  var stableId = cellAt(row, c.companionId).trim();
  return {
    id: stableId || String(rowNum),
    row: String(rowNum),
    firstName: cellAt(row, c.firstName),
    lastName: cellAt(row, c.lastName),
    email: cellAt(row, c.email),
    phone: cellAt(row, c.phone),
    borough: cellAt(row, c.borough),
    neighborhood: cellAt(row, c.neighborhood),
    willingToTravel: cellAt(row, c.willingToTravel),
    age: cellAt(row, c.age),
    pronouns: cellAt(row, c.pronouns),
    raceEthnicity: cellAt(row, c.raceEthnicity),
    gender: cellAt(row, c.gender),
    lgbtq: cellAt(row, c.lgbtq),
    relationshipStatus: cellAt(row, c.relationshipStatus),
    hasExperiencedDV: cellAt(row, c.hasExperiencedDV),
    hasBeenIncarcerated: cellAt(row, c.hasBeenIncarcerated),
    hasExperiencedHomelessness: cellAt(row, c.hasExperiencedHomelessness),
    receivingMentalHealthServices: cellAt(row, c.receivingMentalHealthServices),
    receivingSubstanceUseServices: cellAt(row, c.receivingSubstanceUseServices),
    historyMentalHealthServices: cellAt(row, c.historyMentalHealthServices),
    historySubstanceUseServices: cellAt(row, c.historySubstanceUseServices),
    isVeteran: cellAt(row, c.isVeteran),
    accessibilityNeeds: cellAt(row, c.accessibilityNeeds),
    internalNotes: cellAt(row, c.internalNotes),
    essays: {
      hobbies: cellAt(row, c.essayHobbies),
      expectations: cellAt(row, c.essayExpectations),
      sharedExperiences: cellAt(row, c.essayShared),
      motivation: cellAt(row, c.essayMotivation),
      creativity: cellAt(row, c.essayCreativity)
    },
    availability: {
      monday: avail('availMonday'),
      tuesday: avail('availTuesday'),
      wednesday: avail('availWednesday'),
      thursday: avail('availThursday'),
      friday: avail('availFriday'),
      saturday: avail('availSaturday'),
      sunday: avail('availSunday')
    },
    volunteer: cellAt(row, c.volunteer),
    enrollmentDate: cellAt(row, c.enrollmentDate),
    internalStatus: cellAt(row, c.internalStatus),
    lastContactDate: cellAt(row, c.lastContactDate)
  };
}

// --- SURVEY / INSIGHTS ---

var REMINDER_DAYS_AFTER_MATCH = 180;
/** Default internal recipient when Reminders “To” is unset or invalid. Participant emails are never used as To for this job. */
var REMINDER_DEFAULT_TO_EMAIL = 'danfrey76@gmail.com';

function bucketVolunteer_(raw) {
  var s = String(raw || '').trim();
  if (!s) return 'Not specified';
  var t = s.toLowerCase();
  if (t === 'yes' || t === 'volunteer' || (t.indexOf('volunteer') >= 0 && t.indexOf('not volunteer') < 0)) {
    return 'Volunteer';
  }
  if (t === 'no' || t.indexOf('participant') >= 0 || t.indexOf('seeking') >= 0 || t.indexOf('looking for') >= 0) {
    return 'Participant';
  }
  return 'Other';
}

function countsToSortedList_(map) {
  return Object.keys(map)
    .map(function (k) {
      return { label: k, count: map[k] };
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });
}

/**
 * Frequency breakdown per column for a survey-style sheet (row 1 = headers).
 * @return {{ exists: boolean, sheetName: string, totalRows: number, columns: Array<{header: string, breakdown: Array}> }}
 */
function analyzeExternalSurveySheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    return { exists: false, sheetName: sheetName, totalRows: 0, columns: [] };
  }
  var lr = sh.getLastRow();
  var lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) {
    return { exists: true, sheetName: sheetName, totalRows: 0, columns: [] };
  }
  var data = sh.getRange(1, 1, lr, lc).getValues();
  var headers = data[0];
  var rows = data.slice(1);
  var tz = Session.getScriptTimeZone();
  var columns = [];
  for (var c = 0; c < lc; c++) {
    var header = String(headers[c] != null ? headers[c] : '').trim() || 'Column ' + (c + 1);
    var counts = {};
    for (var r = 0; r < rows.length; r++) {
      var cell = rows[r][c];
      var key;
      if (cell instanceof Date) {
        key = Utilities.formatDate(cell, tz, 'MM/dd/yyyy');
      } else {
        key = cell != null ? String(cell).trim() : '';
      }
      if (key === '') key = '—';
      if (key.length > 200) key = key.substring(0, 197) + '…';
      counts[key] = (counts[key] || 0) + 1;
    }
    columns.push({
      header: header,
      breakdown: countsToSortedList_(counts).slice(0, 18)
    });
  }
  return {
    exists: true,
    sheetName: sheetName,
    totalRows: rows.length,
    columns: columns
  };
}

function buildSurveyAnalysis_(companions, matches) {
  var borough = {};
  var age = {};
  var volunteer = {};
  var gender = {};
  var lgbtq = {};
  var race = {};
  var internal = {};
  var lived = { dv: 0, incarcerated: 0, homeless: 0, mh: 0, vet: 0 };
  var n = companions.length;

  companions.forEach(function (c) {
    function bump(m, v) {
      var key = String(v || '').trim() || '—';
      m[key] = (m[key] || 0) + 1;
    }
    bump(borough, c.borough);
    bump(age, c.age);
    bump(volunteer, bucketVolunteer_(c.volunteer));
    bump(gender, c.gender);
    bump(lgbtq, c.lgbtq);
    bump(race, c.raceEthnicity);
    bump(internal, c.internalStatus);

    if (String(c.hasExperiencedDV) === 'Yes') lived.dv++;
    if (String(c.hasBeenIncarcerated) === 'Yes') lived.incarcerated++;
    if (String(c.hasExperiencedHomelessness) === 'Yes') lived.homeless++;
    if (String(c.receivingMentalHealthServices) === 'Yes') lived.mh++;
    if (String(c.isVeteran) === 'Yes') lived.vet++;
  });

  var matchedIds = {};
  var activeMatches = 0;
  matches.forEach(function (m) {
    if (String(m.status || '').trim() === 'Canceled') return;
    activeMatches++;
    matchedIds[String(m.companion1Id)] = true;
    matchedIds[String(m.companion2Id)] = true;
  });
  var matchedPeople = 0;
  companions.forEach(function (c) {
    if (matchedIds[String(c.id)]) matchedPeople++;
  });

  return {
    totalSignups: n,
    boroughBreakdown: countsToSortedList_(borough),
    ageBreakdown: countsToSortedList_(age),
    volunteerBreakdown: countsToSortedList_(volunteer),
    genderBreakdown: countsToSortedList_(gender),
    lgbtqBreakdown: countsToSortedList_(lgbtq),
    raceBreakdown: countsToSortedList_(race),
    internalStatusBreakdown: countsToSortedList_(internal),
    activeMatchPairs: activeMatches,
    peopleInActiveMatch: matchedPeople,
    peopleNotInActiveMatch: Math.max(0, n - matchedPeople),
    livedExperienceRates:
      n > 0
        ? [
            { label: 'DV survivor (Yes)', count: lived.dv, pct: Math.round((100 * lived.dv) / n) },
            { label: 'Incarceration history (Yes)', count: lived.incarcerated, pct: Math.round((100 * lived.incarcerated) / n) },
            { label: 'Homelessness history (Yes)', count: lived.homeless, pct: Math.round((100 * lived.homeless) / n) },
            { label: 'Receiving mental health services (Yes)', count: lived.mh, pct: Math.round((100 * lived.mh) / n) },
            { label: 'Veteran (Yes)', count: lived.vet, pct: Math.round((100 * lived.vet) / n) }
          ]
        : []
  };
}

/**
 * Survey-style aggregates for the Insights tab (does not change sheet data).
 */
function getSurveyAnalysis() {
  var data = getData();
  return buildSurveyAnalysis_(data.companions, data.matches);
}

/**
 * Payload for Insights: sign-up aggregates + external survey tabs.
 */
function getInsightsPageData() {
  var data = getData();
  var analysis = buildSurveyAnalysis_(data.companions, data.matches);
  return {
    analysis: analysis,
    preSurvey: analyzeExternalSurveySheet_(PRE_SURVEY_SHEET_NAME),
    postSurvey: analyzeExternalSurveySheet_(POST_SURVEY_SHEET_NAME)
  };
}

/**
 * Settings + trigger flag for the 6-month reminders tab only (lighter than full insights).
 */
function getSixMonthReminderPageData() {
  var props = PropertiesService.getScriptProperties();
  var triggerOn = false;
  try {
    triggerOn = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'runSixMonthReminderJob';
    });
  } catch (e) {
    triggerOn = false;
  }
  return {
    reminder: {
      ccEmail: props.getProperty('REMINDER_CC_EMAIL') || '',
      subject: props.getProperty('REMINDER_EMAIL_SUBJECT') || '',
      body: props.getProperty('REMINDER_EMAIL_BODY') || '',
      toEmail: (function () {
        var v = props.getProperty('REMINDER_TO_EMAIL');
        return v === null ? null : v;
      })()
    },
    dailyReminderTriggerActive: triggerOn
  };
}

function saveReminderEmailSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.ccEmail != null) props.setProperty('REMINDER_CC_EMAIL', String(settings.ccEmail).trim());
  if (settings.subject != null) props.setProperty('REMINDER_EMAIL_SUBJECT', String(settings.subject).trim());
  if (settings.body != null) props.setProperty('REMINDER_EMAIL_BODY', String(settings.body));
  if (settings.toEmail != null) {
    var t = String(settings.toEmail).trim();
    if (t === '') props.setProperty('REMINDER_TO_EMAIL', '');
    else props.setProperty('REMINDER_TO_EMAIL', t);
  }
  return true;
}

function getSixMonthReminderLog_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('SIX_MO_REMINDER_LOG') || '{}');
  } catch (e) {
    return {};
  }
}

function defaultReminderSubject_() {
  return 'Reminder: reach out — Post survey (6-month match check-in)';
}

/** Staff reminder (default To: Dan): prompt to contact the pair and send the Post survey. */
function defaultReminderBody_(c1, c2) {
  return (
    'Hi Dan,\n\n' +
    'This is an automated reminder from the Companionship Connections dashboard.\n\n' +
    'The match between ' +
    c1.firstName +
    ' ' +
    c1.lastName +
    ' and ' +
    c2.firstName +
    ' ' +
    c2.lastName +
    ' has been together for about six months. Please reach out to this companionship pair and send them the Post survey.\n\n' +
    'Thank you,\nCompanionship Connections (system)'
  );
}

/**
 * Matches eligible for a 6-month staff reminder (non-canceled, past REMINDER_DAYS_AFTER_MATCH, not already logged as sent).
 */
function previewSixMonthReminders() {
  var data = getData();
  var companionsById = {};
  data.companions.forEach(function (c) {
    companionsById[String(c.id)] = c;
  });
  var log = getSixMonthReminderLog_();
  var now = new Date().getTime();
  var thresholdMs = REMINDER_DAYS_AFTER_MATCH * 86400000;
  var list = [];
  data.matches.forEach(function (m) {
    if (String(m.status || '').trim() === 'Canceled') return;
    var created = new Date(m.createdAt).getTime();
    if (isNaN(created) || now - created < thresholdMs) return;
    var sent = log[m.id];
    var c1 = companionsById[String(m.companion1Id)];
    var c2 = companionsById[String(m.companion2Id)];
    list.push({
      matchId: m.id,
      status: m.status,
      daysSinceMatch: Math.floor((now - created) / 86400000),
      pairLabel: c1 && c2 ? c1.firstName + ' & ' + c2.firstName : 'Unknown',
      reminderAlreadySent: !!sent,
      sentAt: sent || null
    });
  });
  return list;
}

/**
 * Send 6-month internal reminder emails only (one per eligible match). To is always staff — never the matched participants.
 * @return {{ sent: number, skipped: number, errors: string[] }}
 */
function runSixMonthReminderJob() {
  var data = getData();
  var companionsById = {};
  data.companions.forEach(function (c) {
    companionsById[String(c.id)] = c;
  });
  var props = PropertiesService.getScriptProperties();
  var log = getSixMonthReminderLog_();
  var now = new Date();
  var nowMs = now.getTime();
  var thresholdMs = REMINDER_DAYS_AFTER_MATCH * 86400000;
  var subjectCustom = String(props.getProperty('REMINDER_EMAIL_SUBJECT') || '').trim();
  var subjectDefault = subjectCustom || defaultReminderSubject_();
  var bodyOverride = String(props.getProperty('REMINDER_EMAIL_BODY') || '').trim();
  var cc = String(props.getProperty('REMINDER_CC_EMAIL') || '').trim();
  var rawToProp = props.getProperty('REMINDER_TO_EMAIL');

  var stats = { sent: 0, skipped: 0, errors: [] };

  data.matches.forEach(function (m) {
    if (String(m.status || '').trim() === 'Canceled') return;
    if (log[m.id]) return;

    var created = new Date(m.createdAt).getTime();
    if (isNaN(created) || nowMs - created < thresholdMs) return;

    var c1 = companionsById[String(m.companion1Id)];
    var c2 = companionsById[String(m.companion2Id)];
    if (!c1 || !c2) {
      stats.skipped++;
      return;
    }

    var emails = [];
    function addEmail(e) {
      e = String(e || '').trim();
      if (e.indexOf('@') > 0 && emails.indexOf(e) < 0) emails.push(e);
    }
    addEmail(c1.email);
    addEmail(c2.email);

    var body = bodyOverride ? bodyOverride : defaultReminderBody_(c1, c2);
    body = String(body)
      .split('{{first1}}').join(c1.firstName)
      .split('{{last1}}').join(c1.lastName)
      .split('{{first2}}').join(c2.firstName)
      .split('{{last2}}').join(c2.lastName);

    var toLine =
      rawToProp === null ? REMINDER_DEFAULT_TO_EMAIL : String(rawToProp).trim();
    if (!toLine || toLine.indexOf('@') < 1) {
      toLine = REMINDER_DEFAULT_TO_EMAIL;
    }
    body +=
      '\n\n---\nParticipant emails (for reference only — not emailed as To): ' +
      (emails.length ? emails.join(', ') : '(none on file)');

    try {
      var options = {
        to: toLine,
        subject: subjectDefault,
        body: body
      };
      if (cc) options.cc = cc;
      MailApp.sendEmail(options);
      log[m.id] = now.toISOString();
      stats.sent++;
    } catch (err) {
      stats.errors.push(String(m.id) + ': ' + err.message);
    }
  });

  props.setProperty('SIX_MO_REMINDER_LOG', JSON.stringify(log));
  return stats;
}

/**
 * Send one test internal reminder (To = test address only; participant emails appear in body, never as To).
 * @param {string} testToEmail - where to send (required)
 * @return {{ ok: boolean, message?: string, error?: string }}
 */
function sendSixMonthReminderTestEmail(testToEmail) {
  var to = String(testToEmail || '').trim();
  if (!to || to.indexOf('@') < 1) {
    return { ok: false, error: 'Enter a valid email address to receive the test.' };
  }

  var data = getData();
  var companionsById = {};
  data.companions.forEach(function (c) {
    companionsById[String(c.id)] = c;
  });

  var c1 = null;
  var c2 = null;
  for (var i = 0; i < data.matches.length; i++) {
    var m = data.matches[i];
    if (String(m.status || '').trim() === 'Canceled') continue;
    var x1 = companionsById[String(m.companion1Id)];
    var x2 = companionsById[String(m.companion2Id)];
    if (x1 && x2) {
      c1 = x1;
      c2 = x2;
      break;
    }
  }
  if (!c1 || !c2) {
    c1 = { firstName: 'Alex', lastName: 'Sample', email: 'participant1@example.com' };
    c2 = { firstName: 'Jordan', lastName: 'Example', email: 'participant2@example.com' };
  }

  var props = PropertiesService.getScriptProperties();
  var subjectCustom = String(props.getProperty('REMINDER_EMAIL_SUBJECT') || '').trim();
  var subjectDefault = subjectCustom || defaultReminderSubject_();
  var bodyOverride = String(props.getProperty('REMINDER_EMAIL_BODY') || '').trim();
  var cc = String(props.getProperty('REMINDER_CC_EMAIL') || '').trim();

  var body = bodyOverride ? bodyOverride : defaultReminderBody_(c1, c2);
  body = String(body)
    .split('{{first1}}').join(c1.firstName)
    .split('{{last1}}').join(c1.lastName)
    .split('{{first2}}').join(c2.firstName)
    .split('{{last2}}').join(c2.lastName);

  var emails = [];
  function addEmail(e) {
    e = String(e || '').trim();
    if (e.indexOf('@') > 0 && emails.indexOf(e) < 0) emails.push(e);
  }
  addEmail(c1.email);
  addEmail(c2.email);

  body =
    'This is a TEST from the Companionship Connections dashboard (6-month / Post survey staff reminder). It was not saved as a sent reminder.\n\n' +
    '---\n\n' +
    body;
  if (emails.length) {
    body += '\n\n---\nParticipant emails on file (reference only — not emailed as To): ' + emails.join(', ');
  }

  try {
    var options = {
      to: to,
      subject: '[TEST] ' + subjectDefault,
      body: body
    };
    if (cc) options.cc = cc;
    MailApp.sendEmail(options);
    return { ok: true, message: 'Test email sent to ' + to + '.' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Install a daily time-driven trigger (8 AM, script timezone) for 6-month reminders.
 */
function installDailySixMonthReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runSixMonthReminderJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runSixMonthReminderJob').timeBased().everyDays(1).atHour(8).create();
  return true;
}

function removeDailySixMonthReminderTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runSixMonthReminderJob') ScriptApp.deleteTrigger(t);
  });
  return true;
}
