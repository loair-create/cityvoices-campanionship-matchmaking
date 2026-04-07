/**
 * CITY VOICES COMPANIONSHIP APP v3
 * Backend Logic
 */

/** Name of the sheet tab with companion sign-ups (row 1 = headers, then one row per person). */
var FORM_SHEET_NAME = 'Sign Up Form';

function doGet(e) {
  return HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setTitle('Companionship Matching Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  // Dashboard is opened via the web app / deployed URL; no spreadsheet menu.
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
      return parseCompanionRow(row, colIdx, i + 2);
    });
  }
  
  // 2. Get Matches
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) {
    matchSheet = ss.insertSheet('Matches');
    // Added Name columns for better spreadsheet readability
    matchSheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name']);
  }
  
  const lastMatchRow = matchSheet.getLastRow();
  let matches = [];
  if (lastMatchRow >= 2) {
    const matchCols = Math.max(matchSheet.getLastColumn(), 6);
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
          createdAt: r[5]
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
  
  return { companions, matches, criteria };
}

/**
 * SAVE CRITERIA SETTINGS
 */
function saveCriteriaSettings(settingsJson) {
  PropertiesService.getScriptProperties().setProperty('MATCHING_CRITERIA', settingsJson);
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

    sheet.appendRow([
      matchObj.id,
      a,
      b,
      matchObj.status,
      matchObj.notes,
      matchObj.createdAt,
      matchObj.c1Name,
      matchObj.c2Name
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
      sheet.appendRow([
        matchObj.id,
        a,
        b,
        matchObj.status,
        matchObj.notes,
        matchObj.createdAt,
        matchObj.c1Name,
        matchObj.c2Name
      ]);
      created.push({
        id: String(matchObj.id),
        companion1Id: a,
        companion2Id: b,
        status: matchObj.status,
        notes: matchObj.notes,
        createdAt: matchObj.createdAt
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
    ])
  };
}

function cellAt(row, colIndex) {
  if (colIndex == null || colIndex < 0 || colIndex >= row.length) return '';
  var v = row[colIndex];
  return v != null ? String(v) : '';
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
    internalStatus: cellAt(row, c.internalStatus)
  };
}

// --- SURVEY / INSIGHTS ---

var REMINDER_DAYS_AFTER_MATCH = 180;

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
 * Payload for Insights: analysis + reminder email settings + trigger flag.
 */
function getInsightsPageData() {
  var data = getData();
  var analysis = buildSurveyAnalysis_(data.companions, data.matches);
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
    analysis: analysis,
    reminder: {
      ccEmail: props.getProperty('REMINDER_CC_EMAIL') || '',
      subject: props.getProperty('REMINDER_EMAIL_SUBJECT') || '',
      body: props.getProperty('REMINDER_EMAIL_BODY') || ''
    },
    dailyReminderTriggerActive: triggerOn
  };
}

function saveReminderEmailSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.ccEmail != null) props.setProperty('REMINDER_CC_EMAIL', String(settings.ccEmail).trim());
  if (settings.subject != null) props.setProperty('REMINDER_EMAIL_SUBJECT', String(settings.subject).trim());
  if (settings.body != null) props.setProperty('REMINDER_EMAIL_BODY', String(settings.body));
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
  return 'Companionship Connections — 6-month check-in';
}

function defaultReminderBody_(c1, c2) {
  return (
    'Hello,\n\n' +
    'This is a friendly reminder from City Voices / Companionship Connections.\n\n' +
    'Your companionship match between ' +
    c1.firstName +
    ' ' +
    c1.lastName +
    ' and ' +
    c2.firstName +
    ' ' +
    c2.lastName +
    ' began about six months ago. We hope the connection has been meaningful.\n\n' +
    'If you would like support, have feedback, or need anything from our team, please reply to this email.\n\n' +
    'Thank you,\nCompanionship Connections'
  );
}

/**
 * Matches eligible for a 6-month reminder (non-canceled, past REMINDER_DAYS_AFTER_MATCH, not already logged as sent).
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
 * Send 6-month check-in emails for eligible matches (one email per match, both participant emails in To).
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
    if (emails.length === 0) {
      stats.skipped++;
      return;
    }

    var body = bodyOverride ? bodyOverride : defaultReminderBody_(c1, c2);
    body = String(body)
      .split('{{first1}}').join(c1.firstName)
      .split('{{last1}}').join(c1.lastName)
      .split('{{first2}}').join(c2.firstName)
      .split('{{last2}}').join(c2.lastName);

    try {
      var options = {
        to: emails.join(','),
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
