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

/**
 * samples/seed-items-2026-11-19.csv를 변환한 gas/seed_data.js(SEED_DATA, 56개 품목)를
 * 시트에 한 번 넣는다. save 액션(actionSave_)과 같은 로직을 쓰되,
 * upload_type은 '자주구매'로 고정하고 upload_id는 'seed-20261119'로 고정해 두 번 실행해도
 * Purchases에 중복이 쌓이지 않게 한다(Items는 upsertRow라 원래도 중복 없음).
 * note 열은 SEED_DATA에 없으므로 저장되지 않는다.
 */
function seed_import() {
  if (typeof SEED_DATA === 'undefined') {
    Logger.log('gas/seed_data.js가 없습니다. README의 초기 데이터 안내를 따라 추가하세요.');
    return;
  }

  const uploadType = '자주구매';
  const uploadId = 'seed-20261119';
  const now = new Date();

  const alreadySeeded = new Set(
    readRows('Purchases')
      .filter(p => p.upload_id === uploadId)
      .map(p => p.item_key)
  );

  let itemsSaved = 0;
  let itemsUpdated = 0;
  let purchasesAdded = 0;
  let purchasesSkipped = 0;

  SEED_DATA.forEach(item => {
    const itemKey = makeItemKey(item.brand, item.name, item.size);
    if (!itemKey) return;

    const incoming = {
      item_key: itemKey,
      brand: item.brand || '',
      name: item.name || '',
      size: item.size || '',
      category: item.category || '',
      storage: item.storage || '',
      meal_role: item.meal_role || '',
      servings: item.servings || '',
      shelf_days: item.shelf_days || '',
      purchase_count: item.purchase_count || 0,
      last_price: item.price || '',
      updated_at: now
    };

    const result = upsertRow('Items', incoming, mergeItem_);
    if (result.updated) itemsUpdated++; else itemsSaved++;

    if (alreadySeeded.has(itemKey)) {
      purchasesSkipped++;
      return;
    }

    appendRow('Purchases', {
      uploaded_at: now,
      upload_type: uploadType,
      item_key: itemKey,
      qty: 1,
      price: item.price || '',
      upload_id: uploadId
    });
    purchasesAdded++;
  });

  Logger.log(
    'Items 신규 ' + itemsSaved + ', 갱신 ' + itemsUpdated +
    ' / Purchases 추가 ' + purchasesAdded + ', 건너뜀(이미 있음) ' + purchasesSkipped
  );
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
