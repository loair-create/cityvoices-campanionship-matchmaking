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
 * One-shot: Matches Status dropdown (Just Matched / Active / Canceled) +
 * Volunteers/Companions Quit row highlighting (and refreshed roster columns F/G/H).
 */
function applyCompanionSheetFormatting() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var matches = ss.getSheetByName('Matches');
  if (matches && typeof ensureMatchesSheetSetup_ === 'function') {
    ensureMatchesSheetSetup_(matches);
  }
  if (typeof syncVolunteersAndCompanionsFromSignUpForm === 'function') {
    syncVolunteersAndCompanionsFromSignUpForm();
  }
  SpreadsheetApp.getUi().alert(
    'Sheet formatting applied.\n\n' +
      '• Matches column D: dropdown Just Matched / Active / Canceled\n' +
      '• Volunteers & Companions: F = Last Contact Date, G = Internal Notes, H = Internal Status, I = Companion ID\n' +
      '• Existing roster order is kept; new sign-ups append at the bottom\n' +
      '• Rows with Internal Status "Quit" are highlighted light brown'
  );
}

function showCompanionToolsSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('SheetCompanionSidebar')
    .setTitle('Companion tools')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}
