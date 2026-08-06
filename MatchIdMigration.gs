/**
 * One-time repair for Matches rows saved before stable Companion IDs existed.
 *
 * Columns B and C of the Matches tab used to hold sign-up row numbers, which move whenever the
 * Sign Up Form tab is sorted or a row is inserted or deleted. Columns G and H kept the names the
 * match was actually created for, so those names are used to point each match back at the right
 * person's Companion ID.
 *
 * Run "Check match IDs (report only)" first — it writes a report and changes nothing.
 */

var MATCH_ID_REPORT_SHEET_NAME = 'Match ID Report';

var MATCH_ID_STATUS = {
  ALREADY_STABLE: 'Already correct',
  BY_NAME: 'Matched by saved name',
  BY_NAME_AND_ROW: 'Matched by saved name + row',
  BY_ROW_ONLY: 'Matched by row number only',
  UNRESOLVED: 'Needs a human'
};

function matchIdMigration_normalizeName_(value) {
  return String(value != null ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Lookups of current sign-up people by Companion ID, by name, and by current row. */
function matchIdMigration_buildPeopleIndex_() {
  ensureCompanionIds_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FORM_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + FORM_SHEET_NAME + '" not found.');

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) throw new Error('No sign-up rows found.');

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var colIdx = buildCompanionColumnIndices(values[0]);

  var index = { byId: {}, byName: {}, byRow: {} };
  for (var i = 1; i < values.length; i++) {
    var rowNum = i + 1;
    var p = parseCompanionRow(values[i], colIdx, rowNum);
    var name = (String(p.firstName || '').trim() + ' ' + String(p.lastName || '').trim()).trim();
    var person = { id: String(p.id), row: rowNum, name: name || 'Row ' + rowNum };
    index.byId[person.id] = person;
    index.byRow[String(rowNum)] = person;
    var key = matchIdMigration_normalizeName_(name);
    if (key) {
      if (!index.byName[key]) index.byName[key] = [];
      index.byName[key].push(person);
    }
  }
  return index;
}

/**
 * Works out who one side of a stored match really refers to.
 * @return {{ id: string, status: string, note: string }}
 */
function matchIdMigration_resolveSide_(storedId, storedName, index) {
  var id = String(storedId != null ? storedId : '').trim();
  var nameKey = matchIdMigration_normalizeName_(storedName);
  var rowPerson = /^\d+$/.test(id) ? index.byRow[String(parseInt(id, 10))] || null : null;

  if (id && index.byId[id]) {
    return { id: id, status: MATCH_ID_STATUS.ALREADY_STABLE, note: '' };
  }

  var candidates = nameKey && index.byName[nameKey] ? index.byName[nameKey] : [];

  if (candidates.length === 1) {
    var p = candidates[0];
    var note;
    if (rowPerson && rowPerson.id === p.id) {
      note = 'row ' + id + ' still holds this person';
    } else if (rowPerson) {
      note = 'row ' + id + ' now holds ' + rowPerson.name;
    } else {
      note = 'row ' + id + ' is outside the sign-up rows';
    }
    return { id: p.id, status: MATCH_ID_STATUS.BY_NAME, note: note + ' (now row ' + p.row + ')' };
  }

  if (candidates.length > 1) {
    for (var k = 0; k < candidates.length; k++) {
      if (rowPerson && candidates[k].id === rowPerson.id) {
        return {
          id: rowPerson.id,
          status: MATCH_ID_STATUS.BY_NAME_AND_ROW,
          note: candidates.length + ' people share this name; row ' + id + ' picked the right one'
        };
      }
    }
    return {
      id: '',
      status: MATCH_ID_STATUS.UNRESOLVED,
      note: candidates.length + ' people are named "' + String(storedName).trim() + '" — pick one by hand'
    };
  }

  if (rowPerson) {
    return {
      id: rowPerson.id,
      status: MATCH_ID_STATUS.BY_ROW_ONLY,
      note: nameKey
        ? 'no one is named "' + String(storedName).trim() + '" any more; row ' + id + ' now holds ' + rowPerson.name
        : 'no name was saved; row ' + id + ' now holds ' + rowPerson.name
    };
  }

  return {
    id: '',
    status: MATCH_ID_STATUS.UNRESOLVED,
    note: 'no saved name to match and row "' + id + '" does not exist'
  };
}

/**
 * @return {{ rows: Array<Object>, counts: Object }} One entry per Matches data row.
 */
function matchIdMigration_buildPlan_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Matches');
  if (!sheet) throw new Error('Matches sheet not found.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: [], counts: { total: 0, unchanged: 0, changed: 0, unresolved: 0, byRowOnly: 0, duplicates: 0 } };

  var index = matchIdMigration_buildPeopleIndex_();
  var numCols = Math.max(sheet.getLastColumn(), 9);
  var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  var rows = [];
  var counts = { total: 0, unchanged: 0, changed: 0, unresolved: 0, byRowOnly: 0, duplicates: 0 };
  var seenPairs = {};

  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var matchId = String(r[0] != null ? r[0] : '').trim();
    var oldA = String(r[1] != null ? r[1] : '').trim();
    var oldB = String(r[2] != null ? r[2] : '').trim();
    if (!matchId && !oldA && !oldB) continue;

    counts.total++;
    var side1 = matchIdMigration_resolveSide_(oldA, r[6], index);
    var side2 = matchIdMigration_resolveSide_(oldB, r[7], index);

    var entry = {
      sheetRow: i + 2,
      matchId: matchId,
      status: String(r[3] != null ? r[3] : '').trim(),
      oldA: oldA,
      oldB: oldB,
      newA: side1.id,
      newB: side2.id,
      name1: String(r[6] != null ? r[6] : '').trim(),
      name2: String(r[7] != null ? r[7] : '').trim(),
      side1: side1,
      side2: side2,
      duplicateOfRow: 0
    };

    var unresolved =
      side1.status === MATCH_ID_STATUS.UNRESOLVED || side2.status === MATCH_ID_STATUS.UNRESOLVED;
    if (!unresolved && entry.newA === entry.newB) {
      entry.side2 = {
        id: '',
        status: MATCH_ID_STATUS.UNRESOLVED,
        note: 'both sides point at the same person'
      };
      entry.newB = '';
      unresolved = true;
    }

    if (unresolved) {
      counts.unresolved++;
    } else {
      if (side1.status === MATCH_ID_STATUS.BY_ROW_ONLY || side2.status === MATCH_ID_STATUS.BY_ROW_ONLY) {
        counts.byRowOnly++;
      }
      var key = entry.newA < entry.newB ? entry.newA + '\t' + entry.newB : entry.newB + '\t' + entry.newA;
      if (seenPairs[key]) {
        entry.duplicateOfRow = seenPairs[key];
        counts.duplicates++;
      } else {
        seenPairs[key] = entry.sheetRow;
      }
      if (entry.newA === entry.oldA && entry.newB === entry.oldB) {
        counts.unchanged++;
      } else {
        counts.changed++;
      }
    }
    rows.push(entry);
  }

  return { rows: rows, counts: counts };
}

function matchIdMigration_rowResult_(entry, applied) {
  if (entry.side1.status === MATCH_ID_STATUS.UNRESOLVED || entry.side2.status === MATCH_ID_STATUS.UNRESOLVED) {
    return 'Left alone — needs a human';
  }
  if (entry.duplicateOfRow) {
    return (applied ? 'Repaired' : 'Would repair') + ' — same pair as Matches row ' + entry.duplicateOfRow;
  }
  if (entry.newA === entry.oldA && entry.newB === entry.oldB) return 'No change needed';
  return applied ? 'Repaired' : 'Would repair';
}

function matchIdMigration_writeReport_(plan, applied) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MATCH_ID_REPORT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MATCH_ID_REPORT_SHEET_NAME);
  sheet.clear();

  var header = [
    'Matches row',
    'Match ID',
    'Saved name 1',
    'Old ID 1',
    'New ID 1',
    'How person 1 was found',
    'Saved name 2',
    'Old ID 2',
    'New ID 2',
    'How person 2 was found',
    'Result'
  ];
  var out = [header];
  for (var i = 0; i < plan.rows.length; i++) {
    var e = plan.rows[i];
    out.push([
      e.sheetRow,
      e.matchId,
      e.name1,
      e.oldA,
      e.newA,
      e.side1.status + (e.side1.note ? ' — ' + e.side1.note : ''),
      e.name2,
      e.oldB,
      e.newB,
      e.side2.status + (e.side2.note ? ' — ' + e.side2.note : ''),
      matchIdMigration_rowResult_(e, applied)
    ]);
  }
  if (out.length === 1) out.push(['—', 'No match rows found', '', '', '', '', '', '', '', '', '']);

  sheet.getRange(1, 1, out.length, header.length).setValues(out);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
  return sheet;
}

function matchIdMigration_summaryText_(plan, applied) {
  var c = plan.counts;
  var verb = applied ? 'Repaired' : 'Would repair';
  var lines = [
    'Match rows checked: ' + c.total,
    'Already correct: ' + c.unchanged,
    verb + ': ' + c.changed,
    'Of those, guessed from the row number because the saved name no longer exists: ' + c.byRowOnly,
    'Left alone, need a human: ' + c.unresolved
  ];
  if (c.duplicates) {
    lines.push('Rows that end up as the same pair as an earlier row: ' + c.duplicates);
  }
  lines.push('');
  lines.push('Full details are on the "' + MATCH_ID_REPORT_SHEET_NAME + '" tab.');
  return lines.join('\n');
}

/** Menu action: report only, writes nothing to the Matches tab. */
function previewMatchIdMigration() {
  var ui = SpreadsheetApp.getUi();
  var plan;
  try {
    plan = matchIdMigration_buildPlan_();
  } catch (err) {
    ui.alert(String(err.message || err));
    return;
  }
  matchIdMigration_writeReport_(plan, false);
  ui.alert('Match ID check (nothing was changed)\n\n' + matchIdMigration_summaryText_(plan, false));
}

/** Menu action: back up the Matches tab, then rewrite columns B and C with Companion IDs. */
function migrateMatchesToStableIds() {
  var ui = SpreadsheetApp.getUi();
  var plan;
  try {
    plan = matchIdMigration_buildPlan_();
  } catch (err) {
    ui.alert(String(err.message || err));
    return;
  }

  if (!plan.counts.changed) {
    matchIdMigration_writeReport_(plan, false);
    ui.alert('Nothing to repair.\n\n' + matchIdMigration_summaryText_(plan, false));
    return;
  }

  var confirmed = ui.alert(
    'Repair match IDs?',
    matchIdMigration_summaryText_(plan, false) +
      '\n\nA backup copy of the Matches tab is saved first. Continue?',
    ui.ButtonSet.YES_NO
  );
  if (confirmed !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Matches');
  if (!sheet) {
    ui.alert('Matches sheet not found.');
    return;
  }

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sheet.copyTo(ss).setName('Matches backup ' + stamp);

  var index = matchIdMigration_buildPeopleIndex_();
  var applied = 0;
  for (var i = 0; i < plan.rows.length; i++) {
    var e = plan.rows[i];
    if (e.side1.status === MATCH_ID_STATUS.UNRESOLVED || e.side2.status === MATCH_ID_STATUS.UNRESOLVED) continue;
    if (e.newA === e.oldA && e.newB === e.oldB) continue;
    sheet.getRange(e.sheetRow, 2, 1, 2).setValues([[e.newA, e.newB]]);
    // Backfill the readable names only where they were blank; saved names are the audit trail.
    if (!e.name1 && index.byId[e.newA]) sheet.getRange(e.sheetRow, 7).setValue(index.byId[e.newA].name);
    if (!e.name2 && index.byId[e.newB]) sheet.getRange(e.sheetRow, 8).setValue(index.byId[e.newB].name);
    applied++;
  }

  matchIdMigration_writeReport_(plan, true);
  ui.alert(
    'Match IDs repaired.\n\n' +
      'Rows updated: ' +
      applied +
      '\nBackup tab: "Matches backup ' +
      stamp +
      '"\n\n' +
      matchIdMigration_summaryText_(plan, true)
  );
}
