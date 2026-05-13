/**
 * Spreadsheet-first UI: custom menu + sidebar for public links and PDFs.
 * Match Queue actions live in MatchQueue.gs; menu entries call those globals.
 */

function sheetCompanionMenuOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Companion tools')
    .addItem('Open sidebar', 'showCompanionToolsSidebar')
    .addSeparator()
    .addItem('Prepare Match Queue sheet', 'ensureMatchQueueSheet')
    .addItem('Process Match Queue', 'processMatchQueueFromSheet')
    .addSeparator()
    .addItem('Sync Volunteers & Companions tabs', 'syncVolunteersAndCompanionsFromSignUpForm')
    .addSeparator()
    .addItem('Open matching dashboard…', 'openApp')
    .addToUi();
}

function showCompanionToolsSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('SheetCompanionSidebar')
    .setTitle('Companion tools')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}
