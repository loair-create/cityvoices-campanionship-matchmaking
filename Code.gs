/**
 * CITY VOICES COMPANIONSHIP APP v3
 * Backend Logic
 *
 * GOOGLE APPS SCRIPT – WHERE TO PUT FILES
 * ---------------------------------------
 * 1. In your Apps Script project (Extensions > Apps Script from the spreadsheet):
 *    - Keep ONE file named "App" with type "HTML" (App.html in your repo = "App" in the script editor).
 *    - Paste the FULL contents of App.html into that single HTML file. It contains both the dashboard
 *      and the shareable profile view (profile is shown when the URL has ?page=profile&id=ROW_ID).
 * 2. Keep all backend code in Code.gs (paste the contents of Code.gs into the default .gs file).
 * 3. You do NOT need a separate "Profile" file – all HTML is in App.
 * 4. Deploy as web app (Deploy > New deployment > Web app) so profile links work.
 */

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.page === 'profile' && params.id) {
    const profile = getCompanionForProfile(params.id);
    if (!profile) {
      return HtmlService.createHtmlOutput('<p>Profile not found.</p>').setTitle('Companion Profile');
    }
    const t = HtmlService.createTemplateFromFile('App');
    t.page = 'profile';
    t.firstName = profile.firstName || '';
    t.profileFields = profile.profileFields || [];
    t.availabilityJson = profile.availabilityJson || '{}';
    return t.evaluate()
      .setTitle('Companion Profile')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  const dashboardT = HtmlService.createTemplateFromFile('App');
  dashboardT.page = 'dashboard'; // so template scriptlet "page" is defined (avoids ReferenceError)
  return dashboardT.evaluate()
    .setTitle('Companionship Matching Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Companionship Connections')
    .addItem('Open Dashboard', 'openApp')
    .addItem('Run 6‑month reminder check now', 'runScheduledReminders')
    .addToUi();
}

function openApp() {
  const html = HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setWidth(1200)
    .setHeight(850)
    .setTitle('Companionship Matching Dashboard');
  
  SpreadsheetApp.getUi().showModalDialog(html, 'Companionship Matching Dashboard');
}

/**
 * Run this once from the Apps Script editor to authorize email sending.
 * Select "authorizeEmailPermission" in the function dropdown, click Run, then approve when prompted.
 * After that, the Tester email and 6‑month reminders will work from the site/spreadsheet.
 */
function authorizeEmailPermission() {
  const to = Session.getActiveUser().getEmail();
  if (!to) throw new Error('Could not get your email. Run openApp from the spreadsheet menu instead and approve when prompted.');
  MailApp.sendEmail(to, 'Companionship app – authorization test', 'This is a one-time test. Email permission is now authorized. You can use the Tester email and reminders from the app.');
}

/**
 * Preferred tab names (used as a tie-breaker when multiple sheets look like form data).
 * Script property FORM_RESPONSES_SHEET_NAME (exact tab name) overrides everything.
 */
function getPreferredResponseSheetNames_() {
  return [
    'Form_Responses',
    'Form Responses 1',
    'City Voices Companionship v2 (Responses)',
    'Form Responses',
    'Responses',
    'Companionship Responses',
    'Sheet1'
  ];
}

/**
 * How many data rows (excluding row 1 headers) the sheet has.
 */
function getSheetDataRowCount_(sheet) {
  try {
    const v = sheet.getDataRange().getValues();
    if (!v || v.length < 2) return 0;
    return v.length - 1;
  } catch (e) {
    return 0;
  }
}

/**
 * Score header row 0..~12 — looks like a Google Form / signup export (timestamp, name, email).
 */
function getFormHeaderSignalScore_(sheet) {
  try {
    const v = sheet.getDataRange().getValues();
    if (!v || !v.length) return 0;
    const headers = (v[0] || []).map(function(h) {
      return String(h == null ? '' : h).toLowerCase();
    });
    const j = headers.join(' | ');
    let s = 0;
    if (/\btimestamp\b/.test(j) || /\bsubmitted\b/.test(j) || /\bdate\s+submitted\b/.test(j)) s += 4;
    if (/\bfirst\s*name\b/.test(j) || /\bgiven\s*name\b/.test(j)) s += 3;
    if (/\bemail\b/.test(j) || /\be-mail\b/.test(j)) s += 3;
    if (/\blast\s*name\b/.test(j) || /\bsurname\b/.test(j) || /\bfamily\s*name\b/.test(j)) s += 2;
    if (/\bphone\b/.test(j) || /\bmobile\b/.test(j)) s += 1;
    return s;
  } catch (e) {
    return 0;
  }
}

/**
 * Get the responses sheet (Companionship form data).
 * Picks the best candidate by (1) most data rows, (2) form-like headers, (3) preferred names.
 * This fixes the case where an empty "City Voices..." tab exists but real data is on "Form Responses 1".
 * Set script property FORM_RESPONSES_SHEET_NAME to an exact tab name to lock the sheet.
 */
function getResponsesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const override = String(props.getProperty('FORM_RESPONSES_SHEET_NAME') || '').trim();
  if (override) {
    const sh = ss.getSheetByName(override);
    if (!sh) {
      throw new Error('Form sheet "' + override + '" not found. In Apps Script: Project Settings > Script properties, fix or remove FORM_RESPONSES_SHEET_NAME.');
    }
    return sh;
  }

  const preferred = getPreferredResponseSheetNames_();
  const sheets = ss.getSheets();
  let best = null;
  let bestRank = -1;

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    const name = sheet.getName();
    const ln = name.toLowerCase();
    if (ln === 'matches' || ln === 'reminder schedule') continue;
    if (isReservedAnalysisOrLegacySurveyTab_(name)) continue;

    const dataRows = getSheetDataRowCount_(sheet);
    const sig = getFormHeaderSignalScore_(sheet);
    const prefIdx = preferred.indexOf(name);
    let nameBoost = 0;
    if (prefIdx >= 0) nameBoost = 200 - prefIdx;
    else if (ln.indexOf('response') >= 0 || ln.indexOf('form') >= 0 || ln.indexOf('companionship') >= 0) {
      nameBoost = 80;
    } else if (ln.replace(/_/g, ' ').indexOf('form response') >= 0) {
      // e.g. tab renamed with different punctuation
      nameBoost = 75;
    }

    // Data rows dominate so a full tab always wins over an empty similarly named tab.
    const rank = dataRows * 100000 + sig * 500 + nameBoost;
    if (rank > bestRank) {
      bestRank = rank;
      best = sheet;
    }
  }

  if (best && (getSheetDataRowCount_(best) > 0 || getFormHeaderSignalScore_(best) >= 4)) {
    return best;
  }

  if (sheets.length === 1) return sheets[0];

  const sheetNames = sheets.map(function(s) {
    return s.getName();
  }).join(', ');
  throw new Error('No responses sheet found. Your tabs: ' + sheetNames + '. Use a tab with form headers (Timestamp, First name, Email, etc.) and response rows, or set Script property FORM_RESPONSES_SHEET_NAME to the exact tab name.');
}

/** Dates from Sheets must be ISO strings for google.script.run to serialize reliably. */
function serializeDateForClient_(d) {
  if (d == null || d === '') return null;
  if (d instanceof Date) {
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : x.toISOString();
}

/** Post-program survey tab (A–T). Not used for directory / matching. */
/** Tabs used only for anonymous survey analysis — never used as the main enrollment responses sheet. */
function isReservedAnalysisOrLegacySurveyTab_(sheetName) {
  const key = String(sheetName || '').toLowerCase().replace(/[\s_\-]/g, '');
  return key === 'formresponses2' || key === 'formresponsesii' ||
    key === 'presurveyresults' || key === 'postsurveyresults';
}

/**
 * Pre-survey results (anonymous scale-only export). Tab: "Pre-Survey Results".
 * Override: Script property PRE_SURVEY_RESULTS_SHEET_NAME.
 */
function getPreSurveyResultsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const o = String(PropertiesService.getScriptProperties().getProperty('PRE_SURVEY_RESULTS_SHEET_NAME') || '').trim();
    if (o) {
      const sh = ss.getSheetByName(o);
      if (sh) return sh;
    }
  } catch (e) {}
  const tryNames = ['Pre-Survey Results', 'Pre Survey Results', 'Pre-survey results'];
  for (let i = 0; i < tryNames.length; i++) {
    const sh = ss.getSheetByName(tryNames[i]);
    if (sh) return sh;
  }
  return null;
}

/**
 * Post-survey results (anonymous). Tab: "Post Survey Results".
 * Override: Script property POST_SURVEY_RESULTS_SHEET_NAME (or legacy POST_SURVEY_SHEET_NAME).
 */
function getPostSurveyResultsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const o = String(PropertiesService.getScriptProperties().getProperty('POST_SURVEY_RESULTS_SHEET_NAME') ||
      PropertiesService.getScriptProperties().getProperty('POST_SURVEY_SHEET_NAME') || '').trim();
    if (o) {
      const sh = ss.getSheetByName(o);
      if (sh) return sh;
    }
  } catch (e) {}
  const tryNames = ['Post Survey Results', 'Post survey results', 'Form Responses 2'];
  for (let i = 0; i < tryNames.length; i++) {
    const sh = ss.getSheetByName(tryNames[i]);
    if (sh) return sh;
  }
  return null;
}

/** Read full used range (anonymous survey tabs may be any width). */
function getAnalysisSheetValues_(sheet) {
  if (!sheet) return [];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

/** Fixed width for form data + Settings: column A through BB (54 columns). */
function getFormResponseLastColumn_() {
  return 54;
}

/** 1 → A, 27 → AA, 54 → BB */
function columnIndexToLetters_(column) {
  let col = Math.floor(Number(column));
  if (col < 1) return '';
  let letter = '';
  let temp;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

/**
 * Read form responses from row 1 through last row, always through column BB.
 */
function getFormSheetValues_(formSheet) {
  const lastRow = Math.max(formSheet.getLastRow(), 1);
  const numCols = getFormResponseLastColumn_();
  return formSheet.getRange(1, 1, lastRow, numCols).getValues();
}

/**
 * Build header array of length A:BB. Empty row-1 cells become "Column X" so Settings lists every column.
 */
function normalizeFormHeaderRow_(headersRow) {
  const n = getFormResponseLastColumn_();
  const out = [];
  for (let c = 0; c < n; c++) {
    const raw = (headersRow && c < headersRow.length) ? headersRow[c] : '';
    const t = raw != null ? String(raw).trim() : '';
    out.push(t ? t : ('Column ' + columnIndexToLetters_(c + 1)));
  }
  return out;
}

/** Placeholder headers (empty row-1 cell) — default to hidden on public profile. */
function isSyntheticFormHeader_(header) {
  return /^Column [A-Z]+$/.test(String(header || '').trim());
}

/** Google Form Likert intro text — omit from Settings / profile field lists (handled in Analysis). */
function isLikertScaleInstructionHeader_(header) {
  return /please respond on a 1[-–—]?\s*5 scale/i.test(String(header || ''));
}

function pad2Gs_(n) {
  const s = String(Math.floor(Number(n)));
  return s.length >= 2 ? s : ('0' + s);
}

/**
 * Display dates as MM/DD/YYYY (slashes). Used for Timestamp / column A in companion raw (Settings, profile fields).
 * Returns null if value is not a parseable date.
 */
function formatTimestampMMDDYYYY_(v) {
  if (v == null || v === '') return null;
  let d;
  if (v instanceof Date) d = v;
  else d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return formatDateMMDDYYYYSlashes_(d);
}

/** Shareable public profile: dates as MM/DD/YYYY (slashes). */
function formatDateMMDDYYYYSlashes_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return pad2Gs_(v.getMonth() + 1) + '/' + pad2Gs_(v.getDate()) + '/' + v.getFullYear();
  }
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) {
    return s.slice(0, 2) + '/' + s.slice(2, 4) + '/' + s.slice(4);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return pad2Gs_(d.getMonth() + 1) + '/' + pad2Gs_(d.getDate()) + '/' + d.getFullYear();
  }
  return s;
}

/**
 * Omit from copyable public profile: contact, enrollment date, last name, per-day availability (shown in grid only).
 */
function shouldExcludeFieldFromPublicProfile_(header, label) {
  const h = String(header || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  const t = h + ' | ' + l;
  if (/\bemail\b|\be-mail\b/.test(t)) return true;
  if (/\bphone\b|\bmobile\b|\bcell\b/.test(t)) return true;
  if (/\blast\s*name\b/.test(t)) return true;
  if (/\btimestamp\b/.test(h)) return true;
  if (/date\s*of\s*enrollment|enrollment\s*date/.test(t)) return true;
  if (/preferred.*contact|method of contact|contact method/i.test(t)) return true;
  if (/\[(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\]/i.test(h + l)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\bavailability\b/i.test(t)) return true;
  if (/\bavailability\b.*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)) return true;
  if (/^my\s+availability\s+/i.test(l)) return true;
  return false;
}

function formatProfileFieldValueForPublic_(header, rawStr) {
  const s = String(rawStr == null ? '' : rawStr).trim();
  if (!s) return '';
  const h = String(header || '').toLowerCase();
  if (/^\d{8}$/.test(s)) {
    return s.slice(0, 2) + '/' + s.slice(2, 4) + '/' + s.slice(4);
  }
  if (/\btimestamp\b/.test(h) || /\bdate\b/.test(h)) {
    const out = formatDateMMDDYYYYSlashes_(s);
    if (out && out !== s) return out;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime()) && (/\d{1,2}\/\d{1,2}\/\d{4}/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || (s.indexOf('T') > 0 && s.length > 10))) {
    return pad2Gs_(d.getMonth() + 1) + '/' + pad2Gs_(d.getDate()) + '/' + d.getFullYear();
  }
  return s;
}

/**
 * Parse a cell value into 1–5 for loneliness / isolation scale questions.
 * Accepts: numbers 1–5, "1. Never", "2. Rarely", text containing Never/Rarely/Sometimes/Often/Always.
 */
function parseScaleResponse_(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && !isNaN(cell)) {
    const n = Math.round(cell);
    if (n >= 1 && n <= 5) return n;
    return null;
  }
  const s = String(cell).trim();
  if (!s) return null;
  const m = s.match(/^(\d)(?:\s*[.\-]|\s|$)/);
  if (m) {
    const d = parseInt(m[1], 10);
    if (d >= 1 && d <= 5) return d;
  }
  const m2 = s.match(/^(\d)\./);
  if (m2) {
    const d = parseInt(m2[1], 10);
    if (d >= 1 && d <= 5) return d;
  }
  const low = s.toLowerCase();
  if (/\bnever\b/.test(low) && !/\brarely\b/.test(low)) return 1;
  if (/\brarely\b/.test(low)) return 2;
  if (/\bsometimes\b/.test(low)) return 3;
  if (/\boften\b/.test(low) && !/\balways\b/.test(low)) return 4;
  if (/\balways\b/.test(low)) return 5;
  const onlyNum = parseInt(s.replace(/[^\d]/g, ''), 10);
  if (onlyNum >= 1 && onlyNum <= 5 && String(onlyNum).length <= 1) return onlyNum;
  return null;
}

/**
 * True if column header looks like a 1–5 scale question (loneliness / connection survey).
 */
function isScaleQuestionHeader_(header) {
  const h = String(header || '').toLowerCase();
  if (!h) return false;
  if (h.includes('1–5') || h.includes('1-5') || h.includes('1 to 5')) return true;
  if (h.includes('please respond') && h.includes('scale')) return true;
  if (h.includes('feel lonely')) return true;
  if (h.includes('how often do you feel lonely')) return true;
  return false;
}

/**
 * Short label for charts (text inside [...] or trimmed header).
 */
function shortScaleQuestionLabel_(header) {
  const h = String(header || '');
  const bracket = h.match(/\[\s*([^\]]+)\s*\]/);
  if (bracket) return bracket[1].trim();
  return h.replace(/^please respond on a\s*1[–-]5\s*scale:\s*/i, '').trim() || h;
}

/**
 * Rough polarity for interpretation note (higher score = more "risk" vs more "connection").
 */
function scaleQuestionPolarity_(header) {
  const h = String(header || '').toLowerCase();
  if (h.includes('isolated') || h.includes('left out') || h.includes('lack companionship') ||
      h.includes('avoid social') || h.includes('anxiety') || h.includes('fear') || h.includes('lonely')) {
    return 'higher_more_concern';
  }
  if (h.includes('talk to') || h.includes('understand me') || h.includes('connected to') ||
      h.includes('meaningful') || h.includes('spend time with another') || h.includes('initiate contact') ||
      h.includes('community activities') || h.includes('motivated to connect')) {
    return 'higher_more_positive';
  }
  return 'neutral';
}

/**
 * Core scale aggregation for any rectangular sheet data (row 0 = headers).
 */
function computeScaleAggregatesFromData_(data, numCols) {
  if (!data || data.length < 2) {
    return { questions: [], totalRows: 0 };
  }
  const headers = data[0] || [];
  const rows = data.slice(1);
  const questions = [];
  const nCol = Math.min(numCols || headers.length, headers.length);
  for (let j = 0; j < nCol; j++) {
    const header = String(headers[j] == null ? '' : headers[j]).trim();
    if (!isScaleQuestionHeader_(header)) continue;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let n = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const val = parseScaleResponse_(row && row[j]);
      if (val != null) {
        counts[val]++;
        sum += val;
        n++;
      }
    }
    if (n === 0) continue;
    questions.push({
      header: header,
      shortLabel: shortScaleQuestionLabel_(header),
      polarity: scaleQuestionPolarity_(header),
      counts: counts,
      n: n,
      mean: Math.round((sum / n) * 10) / 10
    });
  }
  return { questions: questions, totalRows: rows.length };
}

function canonicalScaleKeyFromHeader_(header) {
  return String(shortScaleQuestionLabel_(header) || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pre-survey anonymous results tab ("Pre-Survey Results").
 */
function getPreSurveyResultsAggregates_() {
  const sheet = getPreSurveyResultsSheet_();
  if (!sheet) {
    return { questions: [], totalRows: 0, sheetName: null };
  }
  const data = getAnalysisSheetValues_(sheet);
  const nCol = (data[0] || []).length;
  const r = computeScaleAggregatesFromData_(data, nCol);
  return {
    questions: r.questions,
    totalRows: r.totalRows,
    sheetName: sheet.getName()
  };
}

/**
 * Post-survey anonymous results tab ("Post Survey Results").
 */
function getPostSurveyResultsAggregates_() {
  const sheet = getPostSurveyResultsSheet_();
  if (!sheet) {
    return { questions: [], totalRows: 0, sheetName: null };
  }
  const data = getAnalysisSheetValues_(sheet);
  const nCol = (data[0] || []).length;
  const r = computeScaleAggregatesFromData_(data, nCol);
  return {
    questions: r.questions,
    totalRows: r.totalRows,
    sheetName: sheet.getName()
  };
}

/**
 * Positive delta = improvement direction when comparing cohort means (same rules as individual deltas).
 */
function improvementDelta_(preScore, postScore, polarity) {
  if (preScore == null || postScore == null) return null;
  if (polarity === 'higher_more_positive') return postScore - preScore;
  if (polarity === 'higher_more_concern') return preScore - postScore;
  return preScore - postScore;
}

/**
 * Match questions by normalized scale text; compare anonymous cohort means + full distributions for charts.
 */
function buildAggregatePrePostComparison_(preQuestions, postQuestions) {
  const preMap = {};
  (preQuestions || []).forEach(function(q) {
    const k = canonicalScaleKeyFromHeader_(q.header);
    if (k) preMap[k] = q;
  });
  const out = [];
  (postQuestions || []).forEach(function(postQ) {
    const k = canonicalScaleKeyFromHeader_(postQ.header);
    if (!k || !preMap[k]) return;
    const preQ = preMap[k];
    const pol = postQ.polarity || preQ.polarity;
    const agg = improvementDelta_(preQ.mean, postQ.mean, pol);
    out.push({
      key: k,
      shortLabel: postQ.shortLabel || preQ.shortLabel,
      polarity: pol,
      meanPre: preQ.mean,
      meanPost: postQ.mean,
      nPre: preQ.n,
      nPost: postQ.n,
      countsPre: preQ.counts,
      countsPost: postQ.counts,
      cohortDelta: agg != null ? Math.round(agg * 100) / 100 : null
    });
  });
  out.sort(function(a, b) {
    return String(a.shortLabel).localeCompare(String(b.shortLabel));
  });
  return out;
}

/**
 * Full analysis: anonymous Pre-Survey Results + Post Survey Results + cohort comparison (no identity linking).
 */
function getFullAnalysis() {
  const out = {
    pre: { questions: [], totalRows: 0, sheetName: null, error: null },
    post: { questions: [], totalRows: 0, sheetName: null, error: null },
    comparison: [],
    error: null
  };
  try {
    out.pre = getPreSurveyResultsAggregates_();
  } catch (e) {
    out.pre.error = e.message || String(e);
  }
  try {
    out.post = getPostSurveyResultsAggregates_();
  } catch (e) {
    out.post.error = e.message || String(e);
  }
  try {
    out.comparison = buildAggregatePrePostComparison_(out.pre.questions || [], out.post.questions || []);
  } catch (e) {
    out.comparison = [];
  }
  return out;
}

/**
 * Aggregated 1–5 scale responses (same source as Analysis pre tab).
 */
function getScaleAggregates() {
  try {
    const x = getPreSurveyResultsAggregates_();
    return { questions: x.questions, totalRows: x.totalRows, error: null };
  } catch (e) {
    return { questions: [], totalRows: 0, error: e.message || String(e) };
  }
}

/**
 * FETCH DATA
 * Returns a valid payload even on error so the UI never stays stuck on "Loading".
 * On error, returns { companions: [], matches: [], criteria: null, reminderRecipient, loadError: "message" }.
 */
function getData() {
  let companions = [];
  let matches = [];
  let criteria = null;
  let reminderRecipient = 'danfrey76@gmail.com';
  let loadError = null;
  let formHeaders = [];
  let formSheetName = '';
  let formRowCount = 0;
  let availableSheets = [];

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    availableSheets = ss.getSheets().map(function(s) { return s.getName(); });

    try {
      const formSheet = getResponsesSheet();
      formSheetName = formSheet.getName();
      const formData = getFormSheetValues_(formSheet);
      const headersRow = formData[0] || [];
      const headers = normalizeFormHeaderRow_(headersRow);
      formHeaders = headers;
      const rows = (formData.length > 1) ? formData.slice(1) : [];
      formRowCount = rows.length;
      companions = rows
        .map((row, i) => parseCompanion(row, headers, i + 2))
        .filter(c => c != null);
    } catch (e) {
      loadError = (loadError ? loadError + ' ' : '') + ('Companions: ' + (e.message || String(e)));
    }

    try {
      let matchSheet = ss.getSheetByName('Matches');
      if (!matchSheet) {
        matchSheet = ss.insertSheet('Matches');
        matchSheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name', 'First Meeting Set Date', 'Reminder Sent']);
      }
      const matchData = matchSheet.getDataRange().getValues();
      const matchRows = (matchData.length > 1) ? matchData.slice(1) : [];
      const matchHeaders = (matchData[0] || []).map(h => String(h || '').toLowerCase());
      const col = (name) => {
        const i = matchHeaders.findIndex(h => h.includes(name));
        return i >= 0 ? i : -1;
      };
      const idxDate = col('first meeting') >= 0 ? col('first meeting') : 8;
      const idxReminder = col('reminder sent') >= 0 ? col('reminder sent') : 9;
      matches = matchRows.map(r => ({
        id: String(r[0]),
        companion1Id: String(r[1]),
        companion2Id: String(r[2]),
        status: r[3],
        notes: r[4] != null ? String(r[4]) : '',
        createdAt: serializeDateForClient_(r[5]),
        firstMeetingSetDate: serializeDateForClient_(r[idxDate]),
        reminderSent: r[idxReminder] === true || String(r[idxReminder] || '').toLowerCase() === 'yes' || r[idxReminder] === 1
      }));
    } catch (e) {
      loadError = (loadError ? loadError + ' ' : '') + ('Matches: ' + (e.message || String(e)));
    }

    try {
      const scriptProperties = PropertiesService.getScriptProperties();
      const savedCriteria = scriptProperties.getProperty('MATCHING_CRITERIA');
      if (savedCriteria) criteria = JSON.parse(savedCriteria);
    } catch (e) {}

    try {
      const r = PropertiesService.getScriptProperties().getProperty('REMINDER_RECIPIENT_EMAIL');
      if (r && r.trim()) reminderRecipient = r.trim();
    } catch (err) {}
  } catch (e) {
    loadError = e.message || String(e);
  }

  let profileFieldSettings = [];
  try {
    profileFieldSettings = getProfileFieldSettings(formHeaders);
  } catch (e) {}

  return {
    companions,
    matches,
    criteria,
    reminderRecipient,
    loadError: loadError || null,
    formHeaders,
    profileFieldSettings,
    formSheetName: formSheetName || null,
    formRowCount: formRowCount,
    availableSheets: availableSheets.length ? availableSheets : null
  };
}

/**
 * Get profile field settings (which form columns to show on profile, and display labels).
 * Merges saved settings with current form headers; new headers get showOnProfile: true and label = header.
 */
function getProfileFieldSettings(formHeaders) {
  let saved = {};
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('PROFILE_FIELD_SETTINGS');
    if (raw && raw.trim()) {
      JSON.parse(raw).forEach(function(item) {
        saved[item.header] = { header: item.header, label: item.label || item.header, showOnProfile: item.showOnProfile !== false };
      });
    }
  } catch (e) {}
  const rows = (formHeaders || []).map(function(header, idx) {
    const s = saved[header];
    const columnLetter = columnIndexToLetters_(idx + 1);
    const defaultShowOnProfile = !isSyntheticFormHeader_(header);
    return s
      ? { header: header, columnLetter: columnLetter, label: s.label || header, showOnProfile: s.showOnProfile !== false }
      : { header: header, columnLetter: columnLetter, label: header, showOnProfile: defaultShowOnProfile };
  });
  return rows.filter(function(item) {
    return !isLikertScaleInstructionHeader_(item.header);
  });
}

/**
 * Save profile field settings (which form columns to show on profile, and display labels).
 */
function saveProfileFieldSettings(settingsJson) {
  try {
    PropertiesService.getScriptProperties().setProperty('PROFILE_FIELD_SETTINGS', settingsJson);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * SAVE CRITERIA SETTINGS
 */
function saveCriteriaSettings(settingsJson) {
  try {
    PropertiesService.getScriptProperties().setProperty('MATCHING_CRITERIA', settingsJson);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if a match already exists between two companions (either order).
 */
function matchExistsBetween(companion1Id, companion2Id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Matches');
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  const id1 = String(companion1Id);
  const id2 = String(companion2Id);
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const c1 = String(r[1]);
    const c2 = String(r[2]);
    if ((c1 === id1 && c2 === id2) || (c1 === id2 && c2 === id1)) return true;
  }
  return false;
}

/**
 * SAVE A NEW MATCH. Returns { success: true } or { success: false, reason: 'already_matched' }.
 */
function createMatch(matchObj) {
  const c1 = String(matchObj.companion1Id);
  const c2 = String(matchObj.companion2Id);
  if (matchExistsBetween(c1, c2)) return { success: false, reason: 'already_matched' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Matches');
  if (!sheet) {
    sheet = ss.insertSheet('Matches');
    sheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name', 'First Meeting Set Date', 'Reminder Sent']);
  }
  ensureMatchSheetColumns(sheet);
  sheet.appendRow([
    matchObj.id,
    matchObj.companion1Id,
    matchObj.companion2Id,
    matchObj.status,
    matchObj.notes,
    matchObj.createdAt,
    matchObj.c1Name,
    matchObj.c2Name,
    '', // First Meeting Set Date
    ''  // Reminder Sent
  ]);
  return { success: true };
}

/**
 * Create multiple matches for one companion (companion1Id) with a list of others (companion2Ids).
 * Skips pairs that are already matched. Returns { created: N, skipped: M }.
 */
function createMatches(companion1Id, companion2Ids, companionsJson) {
  const companions = JSON.parse(companionsJson || '[]');
  const c1 = companions.find(c => String(c.id) === String(companion1Id));
  if (!c1) return { created: 0, skipped: 0 };
  let created = 0, skipped = 0;
  const id1 = String(companion1Id);
  (companion2Ids || []).forEach(companion2Id => {
    const id2 = String(companion2Id);
    if (id1 === id2) { skipped++; return; }
    if (matchExistsBetween(id1, id2)) { skipped++; return; }
    const c2 = companions.find(c => String(c.id) === id2);
    if (!c2) { skipped++; return; }
    const matchObj = {
      id: Math.random().toString(36).substring(2, 11),
      companion1Id: id1,
      companion2Id: id2,
      c1Name: (c1.firstName || '') + ' ' + (c1.lastName || ''),
      c2Name: (c2.firstName || '') + ' ' + (c2.lastName || ''),
      status: 'Just Matched',
      notes: '',
      createdAt: new Date().toISOString()
    };
    const result = createMatch(matchObj);
    if (result && result.success) created++;
    else skipped++;
  });
  return { created, skipped };
}

function ensureMatchSheetColumns(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 10)).getValues()[0];
  if (!headers[8] || String(headers[8]).toLowerCase().indexOf('first meeting') === -1) {
    sheet.getRange(1, 9).setValue('First Meeting Set Date');
    sheet.getRange(1, 10).setValue('Reminder Sent');
  }
}

/**
 * UPDATE/DELETE HANDLERS
 * When status is set to "First Meeting Set", record the date in column I (First Meeting Set Date).
 */
function updateMatchData(matchId, field, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Matches');
  if (!sheet) return false;
  ensureMatchSheetColumns(sheet);
  const data = sheet.getDataRange().getValues();
  const colIndex = field === 'status' ? 3 : 4;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === matchId) {
      sheet.getRange(i + 1, colIndex + 1).setValue(value);
      const statusVal = String(value).trim();
      if (field === 'status') {
        const firstMeetingCol = 9;
        const existingDate = data[i][firstMeetingCol];
        const isEmpty = existingDate === null || existingDate === undefined || existingDate === '';
        if (statusVal === 'First Meeting Set' || (statusVal === 'Active' && isEmpty)) {
          sheet.getRange(i + 1, 9).setValue(new Date()); // First Meeting Set Date = column I
        }
      }
      return true;
    }
  }
  return false;
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

function updateCompanionNote(rowNumber, note) {
  const sheet = getResponsesSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let noteCol = headers.findIndex(h => h.toUpperCase().includes("INTERNAL NOTES"));
  if (noteCol === -1) {
    noteCol = headers.length;
    sheet.getRange(1, noteCol + 1).setValue("INTERNAL NOTES");
  }
  sheet.getRange(rowNumber, noteCol + 1).setValue(note);
  return true;
}

// --- REMINDER EMAIL (6 months after First Meeting Set Date, for status Active or First Meeting Set) ---
const REMINDER_MONTHS = 6;
/** Default: City Voices – Companion Connections Check-In (Google Form). Override with Script property COMPANION_CHECKIN_FORM_URL if the link changes. */
const COMPANION_CHECKIN_FORM_URL_DEFAULT = 'https://forms.gle/dnPAo62XAYZRHDzy5';

function getCompanionCheckinFormUrl_() {
  try {
    const u = PropertiesService.getScriptProperties().getProperty('COMPANION_CHECKIN_FORM_URL');
    if (u && String(u).trim()) return String(u).trim();
  } catch (e) {}
  return COMPANION_CHECKIN_FORM_URL_DEFAULT;
}

function getReminderRecipient() {
  try {
    const r = PropertiesService.getScriptProperties().getProperty('REMINDER_RECIPIENT_EMAIL');
    return (r && r.trim()) ? r.trim() : 'danfrey76@gmail.com';
  } catch (e) {
    return 'danfrey76@gmail.com';
  }
}

function saveReminderRecipient(email) {
  try {
    PropertiesService.getScriptProperties().setProperty('REMINDER_RECIPIENT_EMAIL', String(email || '').trim());
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Returns schedule of reminders: matches with status Active or First Meeting Set, with reminder due date (6 months after First Meeting Set Date) and sent status.
 */
function getReminderSchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) return [];
  ensureMatchSheetColumns(matchSheet);
  const formSheet = getResponsesSheet();
  const formData = getFormSheetValues_(formSheet);
  const headers = normalizeFormHeaderRow_(formData[0] || []);
  const rows = formData.slice(1);
  const companions = [];
  rows.forEach((row, i) => {
    const c = parseCompanion(row, headers, i + 2);
    if (c) companions.push(c);
  });
  const data = matchSheet.getDataRange().getValues();
  const matchRows = data.slice(1);
  const matchHeaders = (data[0] || []).map(h => String(h || '').toLowerCase());
  const col = (name) => {
    const i = matchHeaders.findIndex(h => h.includes(name));
    return i >= 0 ? i : -1;
  };
  const idxDate = col('first meeting') >= 0 ? col('first meeting') : 8;
  const idxReminder = col('reminder sent') >= 0 ? col('reminder sent') : 9;
  const findCompanion = (id) => companions.find(c => String(c.id) === String(id));
  const addMonths = (d, months) => {
    const out = new Date(d);
    out.setMonth(out.getMonth() + months);
    return out;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const schedule = [];
  matchRows.forEach((r, i) => {
    const status = r[3];
    const firstMeetingDate = r[idxDate] ? (r[idxDate] instanceof Date ? r[idxDate] : new Date(r[idxDate])) : null;
    const reminderSent = r[idxReminder] === true || String(r[idxReminder] || '').toLowerCase() === 'yes' || r[idxReminder] === 1;
    const statusStr = String(status || '').trim();
    if ((statusStr !== 'Active' && statusStr !== 'First Meeting Set') || !firstMeetingDate) return;
    const dueDate = addMonths(firstMeetingDate, REMINDER_MONTHS);
    const c1 = findCompanion(r[1]);
    const c2 = findCompanion(r[2]);
    const c1Name = c1 ? (c1.firstName || '') + ' ' + (c1.lastName || '') : (r[6] || '?');
    const c2Name = c2 ? (c2.firstName || '') + ' ' + (c2.lastName || '') : (r[7] || '?');
    schedule.push({
      matchId: String(r[0]),
      matchNames: c1Name + ' & ' + c2Name,
      firstMeetingSetDate: firstMeetingDate,
      reminderDueDate: dueDate,
      reminderSent,
      rowIndex: i + 2
    });
  });
  schedule.sort((a, b) => (a.reminderDueDate.getTime() - b.reminderDueDate.getTime()));
  return schedule;
}

/**
 * Build reminder email body for a match. Includes preferred contact, email, phone for both people.
 */
function buildReminderEmailBody(matchId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) return { body: '', subject: '', c1Name: '', c2Name: '' };
  const formSheet = getResponsesSheet();
  const formData = getFormSheetValues_(formSheet);
  const headers = normalizeFormHeaderRow_(formData[0] || []);
  const rows = formData.slice(1);
  const companions = [];
  rows.forEach((row, i) => {
    const c = parseCompanion(row, headers, i + 2);
    if (c) companions.push(c);
  });
  const data = matchSheet.getDataRange().getValues();
  const matchRows = data.slice(1);
  const findCompanion = (id) => companions.find(c => String(c.id) === String(id));
  const row = matchRows.find(r => String(r[0]) === String(matchId));
  if (!row) return { body: '', subject: '', c1Name: '', c2Name: '' };
  const c1 = findCompanion(row[1]);
  const c2 = findCompanion(row[2]);
  const c1Name = c1 ? (c1.firstName || '') + ' ' + (c1.lastName || '') : (row[6] || '?');
  const c2Name = c2 ? (c2.firstName || '') + ' ' + (c2.lastName || '') : (row[7] || '?');
  const matchNames = c1Name + ' & ' + c2Name;
  let block = '';
  [c1, c2].forEach((c, i) => {
    const name = c ? (c.firstName || '') + ' ' + (c.lastName || '') : (i === 0 ? c1Name : c2Name);
    const preferred = c ? (c.preferredContact || '—') : '—';
    const email = c ? (c.email || '—') : '—';
    const phone = c ? (c.phone || '—') : '—';
    block += (name + ':\n  Preferred contact: ' + preferred + '\n  Email: ' + email + '\n  Phone: ' + phone + '\n\n');
  });
  const surveyUrl = getCompanionCheckinFormUrl_();
  const surveyBlock =
    '\n---\n' +
    'Companion check-in survey\n' +
    'When you reach out to ' + matchNames + ', please send them this City Voices companion check-in form (each companion can complete it on their own). It takes about 5 minutes and helps us support companions like them:\n' +
    surveyUrl + '\n';
  const body =
    "This is a reminder that it's been 6 months since " +
    matchNames +
    " had their first meeting set. Remember to check in with them to see how their Companionship is going. Their preferred contact method is below.\n\n" +
    block +
    surveyBlock;
  const subject = "Companionship check-in: " + matchNames + " (6-month reminder)";
  return { body, subject, c1Name, c2Name };
}

/**
 * Send reminder email for one match to the configured recipient. Marks Reminder Sent in sheet.
 */
function sendReminderEmailForMatch(matchId) {
  const recipient = getReminderRecipient();
  if (!recipient) return false;
  const { body, subject } = buildReminderEmailBody(matchId);
  if (!body) return false;
  MailApp.sendEmail(recipient, subject, body);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Matches');
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(matchId)) {
        ensureMatchSheetColumns(sheet);
        sheet.getRange(i + 1, 10).setValue('Yes'); // Reminder Sent
        break;
      }
    }
  }
  return true;
}

/**
 * Run daily: find matches due for 3-month reminder and send email.
 * To automate: Extensions > Apps Script > Triggers > Add trigger > runScheduledReminders, Time-driven, Day timer.
 */
function runScheduledReminders() {
  const schedule = getReminderSchedule();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  schedule.forEach(item => {
    if (item.reminderSent) return;
    if (item.reminderDueDate.getTime() <= today.getTime() + 86400000) {
      sendReminderEmailForMatch(item.matchId);
    }
  });
  updateReminderSheet();
}

/**
 * Send a test reminder email to the given address (e.g. from Criteria page).
 */
function sendTestReminderEmail(toEmail) {
  const email = String(toEmail || '').trim();
  if (!email) throw new Error('No email address provided. Enter an email in the "Send test to" field on the Tester email page, then click Test Send.');
  const exampleUrl = getCompanionCheckinFormUrl_();
  const body =
    'This is a test reminder email for the Companionship Matching app. When a match has status "Active" or "First Meeting Set" and 6 months have passed since their first meeting date, a reminder like this is sent to the configured recipient.\n\n' +
    'Example body for a real reminder:\n\n' +
    "This is a reminder that it's been 6 months since [Match Names] had their first meeting set. Remember to check in with them to see how their Companionship is going. Their preferred contact method is below.\n\n" +
    '[contact details for each person]\n\n' +
    '---\n' +
    'Companion check-in survey\n' +
    'When you reach out to [Match Names], please send them this City Voices companion check-in form (each companion can complete it on their own). It takes about 5 minutes and helps us support companions like them:\n' +
    exampleUrl;
  const subject = "Companionship app – test reminder";
  try {
    MailApp.sendEmail(email, subject, body);
    return true;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(msg.indexOf('Authorization') >= 0 || msg.indexOf('permission') >= 0
      ? 'Email permission needed. In the Apps Script editor: select the function authorizeEmailPermission, click Run, then approve when prompted. After that, use the Tester email page again.'
      : 'Could not send email: ' + msg);
  }
}

/**
 * Create or update the "Reminder Schedule" sheet with next reminder due dates.
 */
function updateReminderSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Reminder Schedule');
  if (!sheet) {
    sheet = ss.insertSheet('Reminder Schedule');
    sheet.appendRow(['Match ID', 'Match Names', 'First Meeting Set Date', 'Reminder Due Date', 'Reminder Sent', 'Next reminder to send']);
  }
  const schedule = getReminderSchedule();
  sheet.clearContents();
  sheet.appendRow(['Match ID', 'Match Names', 'First Meeting Set Date', 'Reminder Due Date', 'Reminder Sent', 'Next reminder to send']);
  if (schedule.length === 0) {
    sheet.getRange(2, 1).setValue('No matches with status "Active" or "First Meeting Set" yet.');
  } else {
    const nextDue = schedule.find(s => !s.reminderSent);
    schedule.forEach((item, i) => {
      sheet.getRange(i + 2, 1, i + 2, 6).setValues([[
        item.matchId,
        item.matchNames,
        formatDateMMDDYYYYSlashes_(item.firstMeetingSetDate),
        formatDateMMDDYYYYSlashes_(item.reminderDueDate),
        item.reminderSent ? 'Yes' : 'No',
        nextDue && !item.reminderSent && item.matchId === nextDue.matchId ? '← Next' : ''
      ]]);
    });
    if (nextDue) {
      sheet.getRange(1, 7).setValue('Next reminder due: ' + formatDateMMDDYYYYSlashes_(nextDue.reminderDueDate));
    }
  }
  return true;
}

/**
 * DELETE AN APPLICATION (removes row from responses sheet)
 * Also remove any matches that include this companion.
 */
function deleteCompanion(rowNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const formSheet = getResponsesSheet();
  if (!formSheet) return false;
  const rowNum = parseInt(rowNumber, 10);
  if (rowNum < 2) return false;
  formSheet.deleteRow(rowNum);

  // Remove matches that include this companion
  const matchSheet = ss.getSheetByName('Matches');
  if (matchSheet) {
    const matchData = matchSheet.getDataRange().getValues();
    const idStr = String(rowNumber);
    for (let i = matchData.length - 1; i >= 1; i--) {
      if (String(matchData[i][1]) === idStr || String(matchData[i][2]) === idStr) {
        matchSheet.deleteRow(i + 1);
      }
    }
  }
  return true;
}

// --- PARSER ---
// Column B (index 1) = Waiver. If empty or not signed, person is ineligible to match.
// Builds fixed keys for matching + raw[header]=value for every column so profile can be driven by Settings.
function parseCompanion(row, headers, rowNum) {
  try {
    if (!row || typeof row !== 'object' || (typeof row.length !== 'number')) return null;
    const safeHeaders = (headers || []).map(h => String(h == null ? '' : h));
    const headerCount = safeHeaders.length;
    const rowValues = [];
    for (let i = 0; i < headerCount; i++) {
      rowValues[i] = i < row.length ? row[i] : '';
    }

    const getVal = (str) => {
      const idx = safeHeaders.findIndex(h => h.toLowerCase().includes(String(str || '').toLowerCase()));
      return idx > -1 ? String((rowValues[idx]) != null ? rowValues[idx] : '').trim() : "";
    };
    const getAvail = (day) => {
      const idx = safeHeaders.findIndex(h => h.toLowerCase().includes('[' + (day || '') + ']'));
      return idx > -1 ? String((rowValues[idx]) != null ? rowValues[idx] : 'Unavailable') : "Unavailable";
    };

    const raw = {};
    safeHeaders.forEach((h, idx) => {
      const key = h.trim();
      if (!key) return;
      let v = rowValues[idx] != null ? rowValues[idx] : '';
      if (v instanceof Date) v = (v.toISOString && v.toISOString()) || String(v);
      else v = String(v == null ? '' : v).trim();
      raw[key] = v;
    });

    // Column A = Timestamp: show as MM/DD/YYYY everywhere raw is used (profile, Settings preview).
    const colAKey = safeHeaders[0].trim();
    if (colAKey) {
      const tsDisplay = formatTimestampMMDDYYYY_(rowValues[0]);
      if (tsDisplay != null) raw[colAKey] = tsDisplay;
    }

    // Google Form often uses long headers without the word "waiver" (e.g. Companionship Agreement confirmation).
    const waiveIdx = safeHeaders.findIndex(h =>
      /\bwaiver\b/i.test(h) ||
      /companionship agreement/i.test(h) ||
      /filled out and signed/i.test(h) ||
      /signed both/i.test(h));
    const waiverCell = waiveIdx >= 0 ? rowValues[waiveIdx] : rowValues[1];
    const waiverVal = String(waiverCell || '').trim();
    const waiverSigned = waiverVal.length > 0 && waiverVal.toLowerCase() !== 'no';

    let dateEnrolled = null;
    const tsIdx = safeHeaders.findIndex(h =>
      /\btimestamp\b/i.test(h) || /\bdate\s*submitted\b/i.test(h) || /^submitted$/i.test(String(h || '').trim()));
    const rawTimestamp = tsIdx >= 0 ? rowValues[tsIdx] : rowValues[0];
    if (rawTimestamp) {
      if (rawTimestamp instanceof Date) dateEnrolled = rawTimestamp;
      else if (typeof rawTimestamp === 'string' && rawTimestamp.trim()) dateEnrolled = new Date(rawTimestamp);
      else dateEnrolled = new Date(rawTimestamp);
    }
    if (dateEnrolled && isNaN(dateEnrolled.getTime())) dateEnrolled = null;

    const mentalHealthServices = getVal('mental health') || getVal('currently receiving mental health') || getVal('ever received mental health');
    const hobbiesAndCreativity = getVal('hobbies') || getVal('express your creativity') || getVal('creativity');

    return {
      id: String(rowNum),
      dateEnrolled: dateEnrolled ? dateEnrolled.toISOString() : null,
      waiverSigned,
      raw,
      preferredContact: getVal('preferred method of contact') || getVal('preferred contact') || "",
      // Long Google Form question text (e.g. "What is your first name?") matches via substring.
      firstName: getVal('First Name') || getVal('your first name') || getVal('first name?'),
      lastName: getVal('Last Name') || getVal('your last name') || getVal('last name?'),
      email: getVal('Email') || getVal('Share Your Email') || getVal('e-mail'),
      phone: getVal('Phone Number') || getVal('Share Your Phone') || getVal('phone number') || getVal('mobile'),
      borough: getVal('Borough'),
      neighborhood: getVal('neighborhood'),
      willingToTravel: getVal('willing to travel'),
      age: getVal('age'),
      pronouns: getVal('pronouns'),
      raceEthnicity: getVal('race/s'),
      gender: getVal('describe your gender'),
      lgbtq: getVal('LGBTQ'),
      hasExperiencedDV: getVal('domestic violence'),
      hasBeenIncarcerated: getVal('incarcerated'),
      hasExperiencedHomelessness: getVal('homelessness'),
      mentalHealthServices: mentalHealthServices || getVal('currently receiving mental health') || getVal('ever received mental health'),
      receivingSubstanceUseServices: getVal('currently receiving substance use'),
      historySubstanceUseServices: getVal('ever received substance use'),
      isVeteran: getVal('veteran'),
      accessibilityNeeds: getVal('accessibility needs'),
      internalNotes: getVal('INTERNAL NOTES'),
      essays: {
        hobbiesAndCreativity: hobbiesAndCreativity,
        expectations: getVal('important things that you want'),
        sharedExperiences: getVal('experiences do you feel that you and your friend should have'),
        motivation: getVal('Why are you interested')
      },
      availability: {
        monday: getAvail('monday'),
        tuesday: getAvail('tuesday'),
        wednesday: getAvail('wednesday'),
        thursday: getAvail('thursday'),
        friday: getAvail('friday'),
        saturday: getAvail('saturday'),
        sunday: getAvail('sunday')
      }
    };
  } catch (e) {
    return null;
  }
}

/**
 * Format duration from a date to "X days" or "X months" in program.
 */
function getDurationInProgramText(isoDateOrNull) {
  if (!isoDateOrNull) return '—';
  const d = typeof isoDateOrNull === 'string' ? new Date(isoDateOrNull) : isoDateOrNull;
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 0) return '—';
  if (days < 60) return days === 1 ? '1 day' : days + ' days';
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month' : months + ' months';
}

/**
 * Get companion data for public profile view. Uses profile field settings to decide which columns to show and their labels.
 */
function getCompanionForProfile(companionId) {
  const formSheet = getResponsesSheet();
  const formData = getFormSheetValues_(formSheet);
  const headersRow = formData[0] || [];
  const headers = normalizeFormHeaderRow_(headersRow);
  const formHeaders = headers;
  const rowNum = parseInt(companionId, 10);
  if (rowNum < 2 || rowNum > formData.length) return null;
  const row = formData[rowNum - 1];
  const c = parseCompanion(row, headers, rowNum);
  if (!c) return null;
  const settings = getProfileFieldSettings(formHeaders);
  const profileFields = [];
  settings.forEach(s => {
    if (!s.showOnProfile) return;
    if (shouldExcludeFieldFromPublicProfile_(s.header, s.label)) return;
    const rawVal = (c.raw && c.raw[s.header] != null) ? String(c.raw[s.header]) : '';
    profileFields.push({
      label: s.label || s.header,
      value: formatProfileFieldValueForPublic_(s.header, rawVal)
    });
  });
  return {
    firstName: c.firstName || '',
    profileFields: profileFields,
    availabilityJson: JSON.stringify(c.availability || {})
  };
}

/**
 * Base URL of the deployed web app (for profile links). Returns empty string if not deployed as web app.
 */
function getProfileBaseUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}
