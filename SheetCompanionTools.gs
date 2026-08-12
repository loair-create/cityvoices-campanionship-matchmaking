/**
 * Spreadsheet-first UI: custom menu + sidebar for public links and PDFs.
 * Match Queue actions live in MatchQueue.gs; menu entries call those globals.
 */

function sheetCompanionMenuOnOpen() {
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
}

/**
 * One-shot: Matches Status dropdown (incl. Dismissed) + row colors,
 * Sign Up Form / Volunteers / Companions Internal Status dropdown + row colors.
 */
function applyCompanionSheetFormatting() {
  var notes = [];
  var errors = [];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var matches = ss.getSheetByName('Matches');
    if (matches && typeof ensureMatchesSheetSetup_ === 'function') {
      ensureMatchesSheetSetup_(matches);
      notes.push('Matches: Status dropdown + Dismissed colors');
    }
  } catch (e1) {
    errors.push('Matches: ' + (e1.message || e1));
  }
  try {
    if (typeof applySignUpFormInternalStatusFormatting_ === 'function') {
      applySignUpFormInternalStatusFormatting_();
      notes.push('Sign Up Form: Internal Status dropdown + row colors');
    }
  } catch (e2) {
    errors.push('Sign Up Form: ' + (e2.message || e2));
  }
  try {
    if (typeof syncVolunteersAndCompanionsFromSignUpForm === 'function') {
      syncVolunteersAndCompanionsFromSignUpForm();
      notes.push('Volunteers & Companions: synced + row colors');
    }
  } catch (e3) {
    errors.push('Volunteers/Companions: ' + (e3.message || e3));
  }
  var msg =
    (notes.length ? 'Applied:\n• ' + notes.join('\n• ') : 'Nothing applied.') +
    (errors.length ? '\n\nErrors:\n• ' + errors.join('\n• ') : '') +
    '\n\nRow colors: Quit = light brown, Unresponsive = light orange, Dismissed = light red';
  SpreadsheetApp.getUi().alert(msg);
}

function showCompanionToolsSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('SheetCompanionSidebar')
    .setTitle('Companion tools')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}
