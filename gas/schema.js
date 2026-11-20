/**
 * 시트 열 구조 정의. 모든 읽기·쓰기는 이 파일만 참조한다.
 *
 * Settings 탭은 실제 시트에 key, value, 설명 3열이 있다(설명은 사람이 보는 비고란).
 * 읽을 때는 key·value만 쓰므로 readColumns로 따로 지정한다.
 *
 * dateColumns: 날짜가 들어가는 열. 시트가 Date로 자동 변환해 버리는 걸 읽을 때 바로잡기 위해
 *   sheets.js의 readRows가 이 목록에 있는 열은 Date면 'yyyy-MM-dd' 문자열로 정규화한다.
 * textDateColumns: dateColumns 중에서도 애초에 'yyyy-MM-dd' 문자열로 쓰고 비교·매칭에 쓰는 열
 *   (week_start, Feedback.date). 시트가 문자열을 날짜로 자동 변환하지 못하게 열 서식을
 *   텍스트('@')로 미리 지정해 둔다. bought_at 등 실제 타임스탬프 열은 Date 그대로 써도 되므로
 *   여기엔 넣지 않는다.
 */
const SCHEMA = {
  Items: {
    columns: [
      'item_key', 'brand', 'name', 'size', 'category', 'storage',
      'meal_role', 'servings', 'shelf_days', 'purchase_count',
      'last_price', 'preference', 'updated_at'
    ],
    keyColumn: 'item_key',
    dateColumns: ['updated_at']
  },
  Purchases: {
    columns: ['uploaded_at', 'upload_type', 'item_key', 'qty', 'price', 'upload_id'],
    dateColumns: ['uploaded_at']
  },
  Inventory: {
    columns: ['item_key', 'status', 'bought_at', 'expected_until', 'emptied_at'],
    keyColumn: 'item_key',
    dateColumns: ['bought_at', 'expected_until', 'emptied_at']
  },
  MealPlans: {
    columns: ['week_start', 'day', 'slot', 'menu', 'uses', 'difficulty', 'kind', 'status', 'rating'],
    dateColumns: ['week_start'],
    textDateColumns: ['week_start']
  },
  Feedback: {
    columns: ['date', 'slot', 'menu', 'rating', 'reason', 'headcount'],
    dateColumns: ['date'],
    textDateColumns: ['date']
  },
  Settings: {
    columns: ['key', 'value', '설명'],
    keyColumn: 'key',
    readColumns: ['key', 'value']
  }
};
