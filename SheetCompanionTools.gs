/**
 * Spreadsheet-first UI: custom menu + sidebar for public links and PDFs.
 * Match Queue actions live in MatchQueue.gs; menu entries call those globals.
 *
 * Note: Code.gs onOpen() also creates these menus (so they appear even if this
 * file is missing). Keep both in sync if you change menu items.
 */
function sheetCompanionMenuOnOpen() {
  // Menus are created in Code.gs onOpen(). Kept for older docs / manual calls.
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
