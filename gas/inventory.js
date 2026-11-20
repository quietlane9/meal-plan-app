/**
 * Inventory 탭 읽기/쓰기.
 * - '있음'으로 바뀌면 구매일을 지금으로, Items.shelf_days로 소비기한(추정)을 다시 계산하고
 *   emptied_at을 비운다. '없음'이 되면 emptied_at을 지금으로 남긴다.
 * - 재고 화면(inventory.list)은 '없음'은 빼고(화면·식단 생성에서 제외, 장보기 후보로만 남음),
 *   Items와 조인해 이름·보관을 붙이고 소비기한 임박 순으로 정렬해 돌려준다.
 */
function actionInventoryList_() {
  const inventory = readRows('Inventory').filter(inv => inv.status === '있음' || inv.status === '조금');
  const items = readRows('Items');
  const itemMap = {};
  items.forEach(it => { itemMap[it.item_key] = it; });

  const rows = inventory.map(inv => {
    const item = itemMap[inv.item_key] || {};
    return {
      item_key: inv.item_key,
      name: item.brand ? item.brand + ' ' + item.name : (item.name || inv.item_key),
      storage: item.storage || '실온',
      status: inv.status,
      bought_at: inv.bought_at || '',
      expected_until: inv.expected_until || '',
      shelf_days: item.shelf_days || ''
    };
  });

  rows.sort((a, b) => {
    const da = a.expected_until ? new Date(a.expected_until).getTime() : Infinity;
    const db = b.expected_until ? new Date(b.expected_until).getTime() : Infinity;
    return da - db;
  });

  return { rows: rows };
}

function actionInventorySet_(body) {
  const itemKey = body.item_key;
  if (!itemKey) throw new Error('item_key가 필요합니다.');
  const status = body.status || '있음';

  const update = { item_key: itemKey, status: status };

  if (status === '있음') {
    update.bought_at = new Date();
    update.emptied_at = '';
    const item = readRows('Items').find(it => it.item_key === itemKey);
    const shelfDays = item && Number(item.shelf_days);
    update.expected_until = shelfDays ? addDays_(new Date(), shelfDays) : '';
  }

  if (status === '없음') {
    update.emptied_at = new Date();
  }

  upsertRow('Inventory', update);
  return { ok: true };
}

function addDays_(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
