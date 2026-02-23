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
  SpreadsheetApp.getUi()
    .createMenu('Friendship Squad')
    .addItem('Open Dashboard', 'openApp')
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
 */
function getData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Get Companions from the connected responses sheet
  const formSheet = getResponsesSheet();
  
  const formData = formSheet.getDataRange().getValues();
  const headers = formData[0];
  const rows = formData.slice(1);
  
  const companions = rows
    .map((row, i) => parseCompanion(row, headers, i + 2))
    .filter(c => c != null);
  
  // 2. Get Matches
  let matchSheet = ss.getSheetByName('Matches');
  if (!matchSheet) {
    matchSheet = ss.insertSheet('Matches');
    // Added Name columns for better spreadsheet readability
    matchSheet.appendRow(['Match ID', 'Companion 1 ID', 'Companion 2 ID', 'Status', 'Notes', 'Created At', 'C1 Name', 'C2 Name']);
  }
  
  const matchData = matchSheet.getDataRange().getValues();
  const matchRows = matchData.slice(1);
  
  const matches = matchRows.map(r => ({
    id: String(r[0]),
    companion1Id: String(r[1]),
    companion2Id: String(r[2]),
    status: r[3],
    notes: r[4],
    createdAt: r[5]
  }));

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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Matches');
  if (!sheet) sheet = ss.insertSheet('Matches');
  
  sheet.appendRow([
    matchObj.id,
    matchObj.companion1Id,
    matchObj.companion2Id,
    matchObj.status,
    matchObj.notes,
    matchObj.createdAt,
    matchObj.c1Name, // New: Save Names
    matchObj.c2Name
  ]);
  return true;
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

/**
 * DELETE AN APPLICATION (removes row from responses sheet)
 * Also remove any matches that include this companion.
 */
function deleteCompanion(rowNumber) {
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
  const waiverSigned = !!waiverCell && String(waiverCell).trim().length > 0;

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
