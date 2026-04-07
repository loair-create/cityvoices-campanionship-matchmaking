/**
 * CITY VOICES COMPANIONSHIP APP v3
 * Backend Logic
 */

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
  const formSheet = ss.getSheetByName('Form Responses 1');
  if (!formSheet) throw new Error('Sheet "Form Responses 1" not found.');
  
  const formData = formSheet.getDataRange().getValues();
  const headers = formData[0];
  const rows = formData.slice(1);
  
  const companions = rows.map((row, i) => parseCompanion(row, headers, i + 2));
  
  // 2. Get Matches
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) {
    matchSheet = ss.insertSheet('Matches');
    // Added Name columns for better spreadsheet readability
    matchSheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name']);
  }
  
  const matchData = matchSheet.getDataRange().getValues();
  const matchRows = matchData.slice(1);

  /** Skip blank or partial rows so stray spreadsheet lines do not show as matches. */
  const matches = matchRows
    .map(r => ({
      id: String(r[0] != null ? r[0] : '').trim(),
      companion1Id: String(r[1] != null ? r[1] : '').trim(),
      companion2Id: String(r[2] != null ? r[2] : '').trim(),
      status: r[3],
      notes: r[4],
      createdAt: r[5]
    }))
    .filter(m => m.id && m.companion1Id && m.companion2Id);

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
  const sheet = ss.getSheetByName('Form Responses 1');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let noteCol = headers.findIndex(h => h.toUpperCase().includes("INTERNAL NOTES"));
  
  if (noteCol === -1) {
    noteCol = headers.length;
    sheet.getRange(1, noteCol + 1).setValue("INTERNAL NOTES");
  }
  
  sheet.getRange(rowNumber, noteCol + 1).setValue(note);
  return true;
}

// --- PARSER ---
function parseCompanion(row, headers, rowNum) {
  const getVal = (str) => {
    const idx = headers.findIndex(h => h.toLowerCase().includes(str.toLowerCase()));
    return idx > -1 ? String(row[idx]) : "";
  };
  const getAvail = (day) => {
    const idx = headers.findIndex(h => h.toLowerCase().includes(`[${day}]`));
    return idx > -1 ? String(row[idx]) : "Unavailable";
  };

  return {
    id: String(rowNum),
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
