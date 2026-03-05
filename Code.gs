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
    t.borough = profile.borough || '';
    t.neighborhood = profile.neighborhood || '';
    t.age = profile.age || '';
    t.pronouns = profile.pronouns || '';
    t.gender = profile.gender || '';
    t.raceEthnicity = profile.raceEthnicity || '';
    t.lgbtq = profile.lgbtq || '';
    t.relationshipStatus = profile.relationshipStatus || '';
    t.willingToTravel = profile.willingToTravel || '';
    t.accessibilityNeeds = profile.accessibilityNeeds || '';
    t.hasExperiencedDV = profile.hasExperiencedDV || '';
    t.hasBeenIncarcerated = profile.hasBeenIncarcerated || '';
    t.hasExperiencedHomelessness = profile.hasExperiencedHomelessness || '';
    t.receivingMentalHealthServices = profile.receivingMentalHealthServices || '';
    t.receivingSubstanceUseServices = profile.receivingSubstanceUseServices || '';
    t.historyMentalHealthServices = profile.historyMentalHealthServices || '';
    t.historySubstanceUseServices = profile.historySubstanceUseServices || '';
    t.isVeteran = profile.isVeteran || '';
    t.interestedInPeerSupport = profile.interestedInPeerSupport || '';
    t.essaysJson = JSON.stringify(profile.essays || {});
    t.availabilityJson = JSON.stringify(profile.availability || {});
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
    .createMenu('Friendship Squad')
    .addItem('Open Dashboard', 'openApp')
    .addItem('Run 3‑month reminder check now', 'runScheduledReminders')
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
 * Get the responses sheet (Companionship form data).
 * Uses the sheet name for City Voices Companionship v2, with fallback.
 */
function getResponsesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('City Voices Companionship v2 (Responses)');
  if (!sheet) sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet) throw new Error('No responses sheet found. Expected "City Voices Companionship v2 (Responses)" or "Form Responses 1".');
  return sheet;
}

/**
 * FETCH DATA
 * Wrapped so storage/spreadsheet errors don't break deployment or first load.
 */
function getData() {
  let companions = [];
  let matches = [];
  let criteria = null;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Get Companions from the connected responses sheet
    const formSheet = getResponsesSheet();
    const formData = formSheet.getDataRange().getValues();
    const headers = formData[0];
    const rows = formData.slice(1);
    companions = rows
      .map((row, i) => parseCompanion(row, headers, i + 2))
      .filter(c => c != null);
  } catch (e) {
    throw new Error('Companions: ' + (e.message || String(e)));
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let matchSheet = ss.getSheetByName('Matches');
    if (!matchSheet) {
      matchSheet = ss.insertSheet('Matches');
      matchSheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name', 'First Meeting Set Date', 'Reminder Sent']);
    }
    const matchData = matchSheet.getDataRange().getValues();
    const matchRows = matchData.slice(1);
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
      notes: r[4],
      createdAt: r[5],
      firstMeetingSetDate: r[idxDate] ? (r[idxDate] instanceof Date ? r[idxDate] : new Date(r[idxDate])) : null,
      reminderSent: r[idxReminder] === true || String(r[idxReminder] || '').toLowerCase() === 'yes' || r[idxReminder] === 1
    }));
  } catch (e) {
    throw new Error('Matches: ' + (e.message || String(e)));
  }

  // 3. Criteria: avoid Script Properties read failure (can cause INTERNAL error)
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const savedCriteria = scriptProperties.getProperty('MATCHING_CRITERIA');
    if (savedCriteria) criteria = JSON.parse(savedCriteria);
  } catch (e) {
    // Use default criteria if storage read fails
  }

  let reminderRecipient = 'danfrey76@gmail.com';
  try {
    const r = PropertiesService.getScriptProperties().getProperty('REMINDER_RECIPIENT_EMAIL');
    if (r && r.trim()) reminderRecipient = r.trim();
  } catch (err) {}

  return { companions, matches, criteria, reminderRecipient };
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
 * SAVE A NEW MATCH
 */
function createMatch(matchObj) {
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
  return true;
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
      if (field === 'status' && String(value).trim() === 'First Meeting Set') {
        sheet.getRange(i + 1, 9).setValue(new Date()); // First Meeting Set Date = column I
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

// --- REMINDER EMAIL (3 months after First Meeting Set) ---
const REMINDER_MONTHS = 3;

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
 * Returns schedule of reminders: matches with status First Meeting Set, with reminder due date and sent status.
 */
function getReminderSchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) return [];
  ensureMatchSheetColumns(matchSheet);
  const formSheet = getResponsesSheet();
  const formData = formSheet.getDataRange().getValues();
  const headers = formData[0];
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
    if (status !== 'First Meeting Set' || !firstMeetingDate) return;
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
  const formData = formSheet.getDataRange().getValues();
  const headers = formData[0];
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
  const body = "This is a reminder that it's been 3 months since " + matchNames + " had their first meeting set. Remember to check in with them to see how their Companionship is going. Their preferred contact method is below.\n\n" + block;
  const subject = "Companionship check-in: " + matchNames + " (3-month reminder)";
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
  if (!email) return false;
  const body = "This is a test reminder email for the Companionship Matching app. When a match has \"First Meeting Set\" and 3 months have passed, a reminder like this is sent to the configured recipient.\n\nExample body for a real reminder:\n\nThis is a reminder that it's been 3 months since [Match Names] had their first meeting set. Remember to check in with them to see how their Companionship is going. Their preferred contact method is below.";
  const subject = "Companionship app – test reminder";
  MailApp.sendEmail(email, subject, body);
  return true;
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
    sheet.getRange(2, 1).setValue('No matches with "First Meeting Set" yet.');
  } else {
    const nextDue = schedule.find(s => !s.reminderSent);
    schedule.forEach((item, i) => {
      sheet.getRange(i + 2, 1, i + 2, 6).setValues([[
        item.matchId,
        item.matchNames,
        item.firstMeetingSetDate,
        item.reminderDueDate,
        item.reminderSent ? 'Yes' : 'No',
        nextDue && !item.reminderSent && item.matchId === nextDue.matchId ? '← Next' : ''
      ]]);
    });
    if (nextDue) {
      sheet.getRange(1, 7).setValue('Next reminder due: ' + (nextDue.reminderDueDate.toLocaleDateString()));
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
function parseCompanion(row, headers, rowNum) {
  const getVal = (str) => {
    const idx = headers.findIndex(h => h.toLowerCase().includes(str.toLowerCase()));
    return idx > -1 ? String(row[idx] || '').trim() : "";
  };
  const getAvail = (day) => {
    const idx = headers.findIndex(h => h.toLowerCase().includes(`[${day}]`));
    return idx > -1 ? String(row[idx]) : "Unavailable";
  };

  const waiverCell = row[1];
  const waiverVal = String(waiverCell || '').trim();
  const waiverSigned = waiverVal.length > 0 && waiverVal.toLowerCase() !== 'no';

  return {
    id: String(rowNum),
    waiverSigned,
    preferredContact: getVal('preferred method of contact') || getVal('preferred contact') || "",
    firstName: getVal('First Name'),
    lastName: getVal('Last Name'),
    email: getVal('Email'),
    phone: getVal('Phone Number'),
    borough: getVal('Borough'),
    neighborhood: getVal('neighborhood'),
    willingToTravel: getVal('willing to travel'),
    age: getVal('age'),
    pronouns: getVal('pronouns'),
    raceEthnicity: getVal('race/s'),
    gender: getVal('describe your gender'),
    lgbtq: getVal('LGBTQ'),
    relationshipStatus: getVal('committed relationship'),
    
    // Lived Experiences
    hasExperiencedDV: getVal('domestic violence'),
    hasBeenIncarcerated: getVal('incarcerated'),
    hasExperiencedHomelessness: getVal('homelessness'),
    receivingMentalHealthServices: getVal('currently receiving mental health'),
    receivingSubstanceUseServices: getVal('currently receiving substance use'),
    historyMentalHealthServices: getVal('ever received mental health'),
    historySubstanceUseServices: getVal('ever received substance use'),
    isVeteran: getVal('veteran'),
    interestedInPeerSupport: getVal('peer support') || getVal('professional peer support'),
    accessibilityNeeds: getVal('accessibility needs'),
    internalNotes: getVal('INTERNAL NOTES'),
    
    // Essays
    essays: {
      hobbies: getVal('hobbies'),
      expectations: getVal('important things that you want'),
      sharedExperiences: getVal('experiences do you feel that you and your friend should have'),
      motivation: getVal('Why are you interested'),
      creativity: getVal('express your creativity')
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
}

/**
 * Get companion data for public profile view. Strips last name and all contact info.
 */
function getCompanionForProfile(companionId) {
  const formSheet = getResponsesSheet();
  const formData = formSheet.getDataRange().getValues();
  const headers = formData[0];
  const rowNum = parseInt(companionId, 10);
  if (rowNum < 2 || rowNum > formData.length) return null;
  const row = formData[rowNum - 1];
  const c = parseCompanion(row, headers, rowNum);
  if (!c) return null;
  return {
    firstName: c.firstName || '',
    borough: c.borough || '',
    neighborhood: c.neighborhood || '',
    age: c.age || '',
    pronouns: c.pronouns || '',
    gender: c.gender || '',
    raceEthnicity: c.raceEthnicity || '',
    lgbtq: c.lgbtq || '',
    relationshipStatus: c.relationshipStatus || '',
    willingToTravel: c.willingToTravel || '',
    accessibilityNeeds: c.accessibilityNeeds || '',
    hasExperiencedDV: c.hasExperiencedDV,
    hasBeenIncarcerated: c.hasBeenIncarcerated,
    hasExperiencedHomelessness: c.hasExperiencedHomelessness,
    receivingMentalHealthServices: c.receivingMentalHealthServices,
    receivingSubstanceUseServices: c.receivingSubstanceUseServices,
    historyMentalHealthServices: c.historyMentalHealthServices,
    historySubstanceUseServices: c.historySubstanceUseServices,
    isVeteran: c.isVeteran,
    interestedInPeerSupport: c.interestedInPeerSupport,
    essays: c.essays || {},
    availability: c.availability || {}
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
