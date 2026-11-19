/**
 * 시트 열 구조 정의. 모든 읽기·쓰기는 이 파일만 참조한다.
 *
 * Settings 탭은 실제 시트에 key, value, 설명 3열이 있다(설명은 사람이 보는 비고란).
 * 읽을 때는 key·value만 쓰므로 readColumns로 따로 지정한다.
 */
const SCHEMA = {
  Items: {
    columns: [
      'item_key', 'brand', 'name', 'size', 'category', 'storage',
      'meal_role', 'servings', 'shelf_days', 'purchase_count',
      'last_price', 'preference', 'updated_at'
    ],
    keyColumn: 'item_key'
  },
  Purchases: {
    columns: ['uploaded_at', 'upload_type', 'item_key', 'qty', 'price', 'upload_id']
  },
  Inventory: {
    columns: ['item_key', 'status', 'bought_at', 'expected_until', 'emptied_at'],
    keyColumn: 'item_key'
  },
  MealPlans: {
    columns: ['week_start', 'day', 'slot', 'menu', 'uses', 'difficulty', 'kind', 'status', 'rating']
  },
  Feedback: {
    columns: ['date', 'slot', 'menu', 'rating', 'reason', 'headcount']
  },
  Settings: {
    columns: ['key', 'value', '설명'],
    keyColumn: 'key',
    readColumns: ['key', 'value']
  }
};
