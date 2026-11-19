/**
 * Apps Script 편집기에서 한 번 실행: 탭 생성 + Script Properties 점검.
 */
function setup() {
  ensureAllSheets();

  const props = PropertiesService.getScriptProperties();
  const required = ['GEMINI_API_KEY', 'ACCESS_TOKEN', 'SHEET_ID', 'GEMINI_MODEL'];
  const missing = required.filter(k => !props.getProperty(k));

  if (missing.length) {
    Logger.log('Script Properties에 다음 값을 설정하세요: ' + missing.join(', '));
    Logger.log('설정 위치: Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성');
  } else {
    Logger.log('Script Properties 설정 완료. 탭 생성 완료.');
  }
}

function test_sheets() {
  ensureAllSheets();
  Logger.log('6개 탭 생성/확인 완료');
}

/** images에 실제 테스트 이미지(base64)를 넣어서 실행한다. */
function test_extract() {
  const result = actionExtract_({
    upload_type: '자주구매',
    images: []
  });
  Logger.log(JSON.stringify(result));
}

function test_save() {
  const result = actionSave_({
    upload_type: '자주구매',
    items: [
      {
        brand: '테스트', name: '테스트상품', size: '1개', price: 1000,
        purchase_count: 3, category: '기타', storage: '실온',
        meal_role: '간식', servings: 1, shelf_days: 30, confidence: 0.9
      }
    ]
  });
  Logger.log(JSON.stringify(result));
}
