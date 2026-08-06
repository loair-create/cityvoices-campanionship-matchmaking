/**
 * Match Queue tab: enter two Sign Up Form row numbers per row, then Process Match Queue
 * to append pairs to the Matches sheet (same rules as the dashboard batch create).
 */

var MATCH_QUEUE_SHEET_NAME = 'Match Queue';

function ensureMatchQueueSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MATCH_QUEUE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(MATCH_QUEUE_SHEET_NAME);
  }
  var headers = ['Companion 1 (ID or row)', 'Companion 2 (ID or row)', 'Status', 'Notes', 'Processed'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    'Match Queue is ready.\n\n' +
      'In columns A and B, enter each person’s ' +
      COMPANION_ID_HEADER +
      ' from the "' +
      FORM_SHEET_NAME +
      '" tab (a row number also works). Optional: Status (defaults to Just Matched) and Notes. ' +
      'Leave Processed blank until you run Companion tools → Process Match Queue.'
  );
}

/**
 * Reads Match Queue rows with blank Processed column; creates matches via createMatchesBatch.
 */
function processMatchQueueFromSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var q = ss.getSheetByName(MATCH_QUEUE_SHEET_NAME);
  if (!q) {
    ui.alert('Match Queue sheet not found. Use Companion tools → Prepare Match Queue sheet.');
    return;
  }

  var formSheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!formSheet) {
    ui.alert('Sheet "' + FORM_SHEET_NAME + '" not found.');
    return;
  }

  var lr = q.getLastRow();
  if (lr < 2) {
    ui.alert('No data rows in Match Queue.');
    return;
  }

  var numCols = Math.max(5, q.getLastColumn());
  var data = q.getRange(2, 1, lr, numCols).getValues();

  var created = 0;
  var skippedDup = 0;
  var errors = [];
  var baseTime = Date.now();
  var subIdx = 0;

  for (var i = 0; i < data.length; i++) {
    var sheetRow = i + 2;
    var row = data[i];
    var proc = row[4];
    if (String(proc != null ? proc : '').trim() !== '') {
      continue;
    }

    var s1 = String(row[0] != null ? row[0] : '').trim();
    var s2 = String(row[1] != null ? row[1] : '').trim();
    if (s1 === '' && s2 === '') {
      continue;
    }
    if (s1 === '' || s2 === '') {
      errors.push('Queue row ' + sheetRow + ': Fill in both columns A and B.');
      continue;
    }

    // Each cell may hold a sign-up row number or a Companion ID; both resolve to one person.
    var c1;
    var c2;
    try {
      c1 = getCompanionByRef_(s1);
      c2 = getCompanionByRef_(s2);
    } catch (err) {
      errors.push('Queue row ' + sheetRow + ': ' + String(err.message || err));
      continue;
    }
    if (String(c1.id) === String(c2.id)) {
      errors.push('Queue row ' + sheetRow + ': A and B are the same person.');
      continue;
    }

    var status =
      row[2] != null && String(row[2]).trim() ? String(row[2]).trim() : 'Just Matched';
    var notes = row[3] != null ? String(row[3]) : '';

    var matchObj = {
      id: 'm-' + baseTime.toString(36) + '-' + subIdx + '-' + c1.id + '-' + c2.id,
      companion1Id: String(c1.id),
      companion2Id: String(c2.id),
      c1Name: (
        String(c1.firstName || '').trim() +
        ' ' +
        String(c1.lastName || '').trim()
      ).trim(),
      c2Name: (
        String(c2.firstName || '').trim() +
        ' ' +
        String(c2.lastName || '').trim()
      ).trim(),
      status: status,
      notes: notes,
      createdAt: new Date().toISOString()
    };
    subIdx++;

    var res = createMatchesBatch([matchObj]);
    if (res && res.created && res.created.length === 1) {
      q.getRange(sheetRow, 5).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
      created++;
    } else {
      q.getRange(sheetRow, 5).setValue('Skipped (duplicate pair)');
      skippedDup++;
    }
  }

  var msg = 'Created ' + created + ' match(es).';
  if (skippedDup) {
    msg += ' Skipped as duplicates: ' + skippedDup + ' (see Processed column).';
  }
  if (errors.length) {
    msg += '\n\nIssues:\n' + errors.slice(0, 10).join('\n');
    if (errors.length > 10) {
      msg += '\n…';
    }
  }
  ui.alert(msg);
}
