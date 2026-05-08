/**
 APP v3
 * Backend Logic
 */

/** Name of the sheet tab with companion sign-ups (row 1 = headers, then one row per person). */
var FORM_SHEET_NAME = 'Sign Up Form';
/** Optional tabs for Insights — column frequency summaries. */
var PRE_SURVEY_SHEET_NAME = 'Pre-Survey Results';
var POST_SURVEY_SHEET_NAME = 'Post Survey Results';

/** Script property name for the Lovable / external JSON API shared secret. */
var LOVABLE_API_TOKEN_KEY = 'LOVABLE_API_TOKEN';

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  if (String(p.view || '') === 'public' && p.row != null && String(p.row).length > 0) {
    return servePublicProfile_(p.row);
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
 * JSON API for external apps (e.g. Lovable). POST body: { "action": "getData", "token": "..." }
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
 * Shared Lovable / external JSON API: same routing and token check as doPost and legacy GET.
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
      return updateCompanionNote(params.rowNumber, params.note != null ? String(params.note) : '');
    case 'updateCompanionInternalStatus':
      return updateCompanionInternalStatus(params.rowNumber, params.value != null ? String(params.value) : '');
    case 'updateCompanionLastContactDate':
      return updateCompanionLastContactDate(
        params.rowNumber,
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
  try {
    if (typeof sheetCompanionMenuOnOpen === 'function') {
      sheetCompanionMenuOnOpen();
    }
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

/** Matches sheet column I — ensure header exists for older spreadsheets. */
function ensureMatchesLastContactColumn_(sheet) {
  if (!sheet) return;
  var lc = sheet.getLastColumn();
  if (lc < 9) {
    sheet.getRange(1, 9).setValue('Last Contact Date');
  }
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

function getCompanionByRow_(rowNum) {
  var r = parseInt(String(rowNum), 10);
  if (isNaN(r) || r < 2) throw new Error('Invalid profile row.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) throw new Error('Form sheet not found.');
  if (r > sheet.getLastRow()) throw new Error('Row not found.');
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('No data.');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(r, 1, r, lastCol).getValues()[0];
  var colIdx = buildCompanionColumnIndices(headers);
  var p = parseCompanionRow(row, colIdx, r);
  p.allQuestions = buildAllFormQandA_(headers, row);
  return p;
}

function servePublicProfile_(rowParam) {
  try {
    var c = getCompanionByRow_(rowParam);
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
  try {
    var url = ScriptApp.getService().getUrl();
    return url ? String(url).replace(/#$/, '') : '';
  } catch (e) {
    return '';
  }
}

/**
 * @return {{ ok: boolean, url: string, message: string }}
 */
function getPublicShareLink(rowId) {
  var base = getWebAppBaseUrl_();
  if (!base) {
    return {
      ok: false,
      url: '',
      message:
        'Could not detect the web app URL automatically. In Apps Script: Deploy → Manage deployments → copy the Web app URL, then add this to the end: ?view=public&row=' +
        encodeURIComponent(String(rowId))
    };
  }
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return { ok: true, url: base + sep + 'view=public&row=' + encodeURIComponent(String(rowId)), message: '' };
}

/**
 * PDF of public-safe profile (first name + form responses, no contact columns).
 * @return {{ base64: string, fileName: string }}
 */
function getProfilePdfBase64(rowId) {
  var c = getCompanionByRow_(rowId);
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
  
  const lastMatchRow = matchSheet.getLastRow();
  let matches = [];
  if (lastMatchRow >= 2) {
    ensureMatchesLastContactColumn_(matchSheet);
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

    ensureMatchesLastContactColumn_(sheet);
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
 * @return {{ created: Array<Object>, skipped: number }}
 */
function createMatchesBatch(matchObjs) {
  if (!matchObjs || !matchObjs.length) return { created: [], skipped: 0 };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { created: [], skipped: matchObjs.length };
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
      if (x && y) existingKeys[pairKey(x, y)] = true;
    }

    const created = [];
    let skipped = 0;
    for (let i = 0; i < matchObjs.length; i++) {
      const matchObj = matchObjs[i];
      const a = String(matchObj.companion1Id != null ? matchObj.companion1Id : '').trim();
      const b = String(matchObj.companion2Id != null ? matchObj.companion2Id : '').trim();
      if (!a || !b || a === b) {
        skipped++;
        continue;
      }
      const k = pairKey(a, b);
      if (existingKeys[k]) {
        skipped++;
        continue;
      }
      existingKeys[k] = true;
      ensureMatchesLastContactColumn_(sheet);
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
    return { created: created, skipped: skipped };
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
  ensureMatchesLastContactColumn_(sheet);
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
  for (let i = 1; i < data.length; i++) {
    if (want[String(data[i][0])]) {
      sheet.getRange(i + 1, 4).setValue(status);
      n++;
    }
  }
  return { updated: n };
}

function updateCompanionNote(rowNumber, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let noteCol = headers.findIndex(h => h.toUpperCase().includes("INTERNAL NOTES"));
  
  if (noteCol === -1) {
    noteCol = headers.length;
    sheet.getRange(1, noteCol + 1).setValue("INTERNAL NOTES");
  }
  
  sheet.getRange(rowNumber, noteCol + 1).setValue(note);
  return true;
}

/** Allowed internal status values for the directory dropdown (empty = clear cell). */
var INTERNAL_STATUS_ALLOWED_ = { Active: true, Quit: true, Unresponsive: true };

/**
 * Update internal status. Only Active, Quit, Unresponsive, or blank are written.
 * @return {boolean}
 */
function updateCompanionInternalStatus(rowNumber, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) return false;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return false;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const c = buildCompanionColumnIndices(headers);
  const colIdx = c.internalStatus;
  if (colIdx == null || colIdx < 0) return false;
  const r = parseInt(String(rowNumber), 10);
  if (isNaN(r) || r < 2) return false;
  var v = String(value != null ? value : '').trim();
  if (v && !INTERNAL_STATUS_ALLOWED_[v]) return false;
  sheet.getRange(r, colIdx + 1).setValue(v);
  return true;
}

/**
 * Update Last Contact Date. Pass empty string to clear. Pass YYYY-MM-DD (from HTML date input) to set a calendar date.
 * Creates a "Last Contact Date" column if none matches.
 * @return {boolean}
 */
function updateCompanionLastContactDate(rowNumber, isoDateOrEmpty) {
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
  const r = parseInt(String(rowNumber), 10);
  if (isNaN(r) || r < 2) return false;
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
  return {
    id: String(rowNum),
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
