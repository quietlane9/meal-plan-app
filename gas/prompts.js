/**
 * 추출 프롬프트와 responseSchema. docs/spec.md 7장과 동일하게 유지한다.
 */
function extractPrompt_(uploadType) {
  return [
    '너는 마트 앱 스크린샷·영수증 사진에서 상품을 뽑는 도우미다.',
    '업로드 종류: ' + uploadType,
    '이미지 여러 장은 같은 목록을 스크롤한 것이라 같은 상품이 겹쳐 보일 수 있다. 한 번만 넣어라.',
    "- 각 상품에서 브랜드, 상품명, 용량, 판매가, 'N회 구매' 숫자를 읽어라.",
    "- 상품명이 '...'로 잘렸으면 상품 사진의 포장 문구로 보완하고 confidence를 낮춰라.",
    '- 화면 아래로 잘려 이름이 안 보이는 카드는 다음 장에 나오면 그것을 쓰고, 어디에도 없으면 생략하라.',
    '- 분류, 보관, 식단역할, 인분, 보관일수는 상품 종류로 추정하라.',
    "- 주류·논알콜 음료와 생활용품은 식단역할을 '제외'로 하라.",
    '- 주소·이름·전화·카드번호는 출력하지 마라. 영수증의 줄임 상품명은 일반 이름으로 풀어라.',
    '개인정보(주소·이름·전화번호·카드번호)가 보이더라도 절대 출력하지 마라.'
  ].join('\n');
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          name: { type: 'string' },
          size: { type: 'string' },
          price: { type: 'number' },
          purchase_count: { type: 'integer' },
          category: { type: 'string' },
          storage: { type: 'string', enum: ['냉장', '냉동', '실온'] },
          meal_role: { type: 'string', enum: ['메인', '반찬', '아침', '간식', '음료', '제외'] },
          servings: { type: 'number' },
          shelf_days: { type: 'integer' },
          confidence: { type: 'number' }
        },
        required: ['name', 'category', 'storage', 'meal_role', 'confidence']
      }
    }
  },
  required: ['items']
};
