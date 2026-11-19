/**
 * 탭 자동 생성, 읽기, upsert, append. schema.js의 SCHEMA만 참조한다.
 */

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Script Properties에 SHEET_ID가 없습니다.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(name) {
  const def = SCHEMA[name];
  if (!def) throw new Error('알 수 없는 탭: ' + name);
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, def.columns.length).setValues([def.columns]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureAllSheets() {
  Object.keys(SCHEMA).forEach(ensureSheet_);
}

function readRows(name) {
  const def = SCHEMA[name];
  const sheet = ensureSheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const header = sheet.getRange(1, 1, 1, def.columns.length).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, def.columns.length).getValues();
  const readCols = def.readColumns || def.columns;

  return values.map((row, i) => {
    const obj = {};
    header.forEach((h, idx) => {
      if (readCols.indexOf(h) !== -1) obj[h] = row[idx];
    });
    obj.__row = i + 2;
    return obj;
  });
}

function appendRow(name, record) {
  const def = SCHEMA[name];
  const sheet = ensureSheet_(name);
  const row = def.columns.map(c => (record[c] !== undefined ? record[c] : ''));
  sheet.appendRow(row);
}

/**
 * keyColumn 기준 upsert. mergeFn(existing, incoming)이 있으면 그 결과를 최종값으로 쓰고,
 * 없으면 incoming이 existing을 덮어쓰되 incoming에 없는 필드는 기존 값을 유지한다.
 */
function upsertRow(name, incoming, mergeFn) {
  const def = SCHEMA[name];
  if (!def.keyColumn) throw new Error(name + '은 upsert를 지원하지 않습니다.');
  const sheet = ensureSheet_(name);
  const cols = def.columns;
  const keyIdx = cols.indexOf(def.keyColumn);
  const lastRow = sheet.getLastRow();
  const keyValue = incoming[def.keyColumn];

  if (lastRow >= 2) {
    const keyValues = sheet.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keyValues.length; i++) {
      if (String(keyValues[i][0]) === String(keyValue)) {
        const rowNum = i + 2;
        const existingValues = sheet.getRange(rowNum, 1, 1, cols.length).getValues()[0];
        const existing = {};
        cols.forEach((c, idx) => { existing[c] = existingValues[idx]; });

        const merged = mergeFn ? mergeFn(existing, incoming) : Object.assign({}, existing, incoming);
        const row = cols.map(c => (merged[c] !== undefined ? merged[c] : ''));
        sheet.getRange(rowNum, 1, 1, cols.length).setValues([row]);
        return { updated: true };
      }
    }
  }

  const row = cols.map(c => (incoming[c] !== undefined ? incoming[c] : ''));
  sheet.appendRow(row);
  return { updated: false };
}
