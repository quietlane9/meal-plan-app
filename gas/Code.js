/**
 * doPost 라우터. body = {token, action, ...}. action으로만 분기한다.
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ error: '잘못된 요청 본문' });
  }

  const token = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
  if (!token || body.token !== token) {
    return jsonOutput_({ error: '인증 실패' });
  }

  try {
    switch (body.action) {
      case 'extract':
        return jsonOutput_(actionExtract_(body));
      case 'save':
        return jsonOutput_(actionSave_(body));
      case 'settings.get':
        return jsonOutput_(actionSettingsGet_());
      case 'settings.set':
        return jsonOutput_(actionSettingsSet_(body));
      case 'inventory.list':
        return jsonOutput_(actionInventoryList_());
      case 'inventory.set':
        return jsonOutput_(actionInventorySet_(body));
      case 'plan.generate':
        return jsonOutput_(actionPlanGenerate_(body));
      case 'plan.list':
        return jsonOutput_(actionPlanList_(body));
      default:
        return jsonOutput_({ error: '알 수 없는 action: ' + body.action });
    }
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 요청당 Gemini 호출은 1회만(6분 제한). */
function actionExtract_(body) {
  const images = body.images || [];
  const uploadType = body.upload_type || '주문내역';

  const parts = [{ text: extractPrompt_(uploadType) }];
  images.forEach(img => {
    parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
  });

  const result = callGeminiJson_(parts, EXTRACT_SCHEMA, 0.1);
  return { items: result.items || [] };
}

function actionSave_(body) {
  const uploadType = body.upload_type || '주문내역';
  const items = body.items || [];
  const uploadId = Utilities.getUuid();
  const now = new Date();
  let saved = 0;
  let updated = 0;

  items.forEach(item => {
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
    if (result.updated) updated++; else saved++;

    appendRow('Purchases', {
      uploaded_at: now,
      upload_type: uploadType,
      item_key: itemKey,
      qty: 1,
      price: item.price || '',
      upload_id: uploadId
    });

    // 자주구매는 과거 전체 구매 목록일 뿐 이번 재고가 아니므로 Inventory는 건드리지 않는다.
    if (uploadType !== '자주구매') {
      upsertRow('Inventory', {
        item_key: itemKey,
        status: '있음',
        bought_at: now
      });
    }
  });

  return { saved: saved, updated: updated };
}

/** purchase_count는 큰 값으로만 갱신하고, preference는 기존 값을 보존한다. */
function mergeItem_(existing, incoming) {
  const merged = Object.assign({}, existing, incoming);
  const existingCount = Number(existing.purchase_count) || 0;
  const incomingCount = Number(incoming.purchase_count) || 0;
  merged.purchase_count = Math.max(existingCount, incomingCount);
  merged.preference = existing.preference || '';
  return merged;
}
