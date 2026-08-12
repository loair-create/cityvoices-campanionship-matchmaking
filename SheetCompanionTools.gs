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
 * Fast one-shot: dropdowns + conditional-format row colors only.
 * Does NOT run a full Volunteers/Companions sync (that was too slow).
 */
function applyCompanionSheetFormatting() {
  var notes = [];
  var errors = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    var matches = ss.getSheetByName('Matches');
    if (matches && typeof ensureMatchesSheetSetup_ === 'function') {
      ensureMatchesSheetSetup_(matches);
      notes.push('Matches');
    }
  } catch (e1) {
    errors.push('Matches: ' + (e1.message || e1));
  }

  try {
    if (typeof applySignUpFormInternalStatusFormatting_ === 'function') {
      applySignUpFormInternalStatusFormatting_();
      notes.push('Sign Up Form');
    }
  } catch (e2) {
    errors.push('Sign Up Form: ' + (e2.message || e2));
  }

  try {
    var vol = ss.getSheetByName('Volunteers');
    if (vol && typeof applyRosterQuitConditionalFormatting_ === 'function') {
      applyRosterQuitConditionalFormatting_(vol, 8, Math.max(vol.getLastColumn(), 9));
      notes.push('Volunteers');
    }
  } catch (e3) {
    errors.push('Volunteers: ' + (e3.message || e3));
  }

  try {
    var com = ss.getSheetByName('Companions');
    if (com && typeof applyRosterQuitConditionalFormatting_ === 'function') {
      applyRosterQuitConditionalFormatting_(com, 8, Math.max(com.getLastColumn(), 9));
      notes.push('Companions');
    }
  } catch (e4) {
    errors.push('Companions: ' + (e4.message || e4));
  }

  var msg =
    (notes.length ? 'Formatting applied to: ' + notes.join(', ') : 'Nothing applied.') +
    (errors.length ? '\n\nErrors:\n• ' + errors.join('\n• ') : '') +
    '\n\nColors via conditional formatting (Quit=brown, Unresponsive=orange, Dismissed=red).' +
    '\nTo refresh roster data, use Admin → Sync Volunteers & Companions tabs.';
  SpreadsheetApp.getUi().alert(msg);
}

function showCompanionToolsSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('SheetCompanionSidebar')
    .setTitle('Companion tools')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}
