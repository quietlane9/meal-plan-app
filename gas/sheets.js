/**
 * 탭 자동 생성, 읽기, upsert, append. schema.js의 SCHEMA만 참조한다.
 *
 * 날짜 처리: week_start처럼 'yyyy-MM-dd' 문자열로 쓰고 비교하는 열은 구글시트가
 * 자동으로 Date로 바꿔버리면 문자열 비교(===)와 매칭(upsertByMatch/deleteRowsByMatch)이
 * 전부 깨진다. 그래서 (1) 그런 열은 ensureSheet_에서 서식을 텍스트('@')로 미리 지정해 두고,
 * (2) 그래도 이미 Date로 들어간 값은 읽거나 비교할 때 normalizeDateValue_로 되돌린다.
 */

function normalizeDateValue_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return v;
}

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
  applyTextFormatToDateColumns_(sheet, def);
  return sheet;
}

/** textDateColumns로 지정된 열의 서식을 텍스트로 고정한다. 매번 호출해도 안전(idempotent)하다. */
function applyTextFormatToDateColumns_(sheet, def) {
  if (!def.textDateColumns || !def.textDateColumns.length) return;
  const maxRows = Math.max(sheet.getMaxRows(), 2);
  def.textDateColumns.forEach(colName => {
    const idx = def.columns.indexOf(colName);
    if (idx === -1) return;
    sheet.getRange(1, idx + 1, maxRows, 1).setNumberFormat('@');
  });
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
  const dateCols = def.dateColumns || [];

  return values.map((row, i) => {
    const obj = {};
    header.forEach((h, idx) => {
      if (readCols.indexOf(h) === -1) return;
      obj[h] = dateCols.indexOf(h) !== -1 ? normalizeDateValue_(row[idx]) : row[idx];
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
      if (String(normalizeDateValue_(keyValues[i][0])) === String(normalizeDateValue_(keyValue))) {
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

/**
 * matchFields(여러 열)로 일치하는 첫 행을 record로 덮어쓰고, 없으면 append한다.
 * MealPlans처럼 단일 키 열이 없는 탭에 쓴다(week_start+day+slot 조합 등).
 * 비교 전에 양쪽 값을 normalizeDateValue_로 맞춰서, 시트가 날짜로 자동 변환한 값과도 매칭된다.
 */
function upsertByMatch(name, matchFields, record) {
  const def = SCHEMA[name];
  const sheet = ensureSheet_(name);
  const cols = def.columns;
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const matches = Object.keys(matchFields).every(key => {
        const idx = cols.indexOf(key);
        if (idx === -1) return false;
        return String(normalizeDateValue_(row[idx])) === String(normalizeDateValue_(matchFields[key]));
      });
      if (matches) {
        const rowNum = i + 2;
        const newRow = cols.map((c, idx) => (record[c] !== undefined ? record[c] : row[idx]));
        sheet.getRange(rowNum, 1, 1, cols.length).setValues([newRow]);
        return { updated: true };
      }
    }
  }

  const newRow = cols.map(c => (record[c] !== undefined ? record[c] : ''));
  sheet.appendRow(newRow);
  return { updated: false };
}

/** matchFields와 일치하는 모든 행을 지운다. 식단 재생성 전 그 주 기존 행을 비울 때 쓴다. */
function deleteRowsByMatch(name, matchFields) {
  const def = SCHEMA[name];
  const sheet = ensureSheet_(name);
  const cols = def.columns;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const matches = Object.keys(matchFields).every(key => {
      const idx = cols.indexOf(key);
      if (idx === -1) return false;
      return String(normalizeDateValue_(row[idx])) === String(normalizeDateValue_(matchFields[key]));
    });
    if (matches) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}
