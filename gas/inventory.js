/**
 * Inventory 탭 읽기/쓰기. '집에 있음' 버튼은 inventory.set으로 status를 '있음'으로 올린다.
 */
function actionInventoryList_() {
  return { rows: readRows('Inventory') };
}

function actionInventorySet_(body) {
  const itemKey = body.item_key;
  if (!itemKey) throw new Error('item_key가 필요합니다.');

  upsertRow('Inventory', {
    item_key: itemKey,
    status: body.status || '있음',
    bought_at: new Date()
  });

  return { ok: true };
}
