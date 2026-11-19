/**
 * Settings 탭 읽기/쓰기. 시트에 값이 없으면 기본값을 채워 돌려준다.
 */
const DEFAULT_SETTINGS = {
  headcount: '4',
  slot_headcount: JSON.stringify({
    weekday: { '아침': 4, '점심': 1, '저녁': 4 },
    weekend: { '아침': 4, '점심': 4, '저녁': 4 }
  }),
  rules: JSON.stringify(['밀키트 주 3회 이하', '주말 점심은 외식']),
  exclude_foods: ''
};

function readSettingsMap_() {
  const rows = readRows('Settings');
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return Object.assign({}, DEFAULT_SETTINGS, map);
}

function actionSettingsGet_() {
  return { settings: readSettingsMap_() };
}

function actionSettingsSet_(body) {
  const key = body.key;
  if (!key) throw new Error('key가 필요합니다.');
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
  upsertRow('Settings', { key: key, value: value });
  return { ok: true };
}
