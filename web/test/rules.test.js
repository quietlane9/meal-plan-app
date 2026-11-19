const assert = require('assert');
const { checkRules, isStew } = require('../lib/rules.js');

// 3일 내 같은 메뉴 반복 → 위반
const repeatMeals = [
  { day: '월', slot: '저녁', menu: '소불고기', uses: [] },
  { day: '수', slot: '저녁', menu: '소불고기', uses: [] }
];
let violations = checkRules(repeatMeals, []);
assert.strictEqual(violations.length, 1);
assert.match(violations[0].reason, /3일 내/);

// 4일 이상 차이나면 위반 아님
const spacedMeals = [
  { day: '월', slot: '저녁', menu: '소불고기', uses: [] },
  { day: '금', slot: '저녁', menu: '소불고기', uses: [] }
];
assert.strictEqual(checkRules(spacedMeals, []).length, 0);

// 찌개류 하루 2번 → 위반
const stewMeals = [
  { day: '화', slot: '점심', menu: '김치찌개', uses: [] },
  { day: '화', slot: '저녁', menu: '된장찌개', uses: [] }
];
violations = checkRules(stewMeals, []);
assert.strictEqual(violations.length, 2);
violations.forEach(v => assert.match(v.reason, /찌개/));

// 제외 품목 사용 → 위반 (items 전달 시)
const excludeMeals = [{ day: '목', slot: '점심', menu: '맥주 안주', uses: ['beer1'] }];
const items = [{ item_key: 'beer1', meal_role: '제외' }];
violations = checkRules(excludeMeals, items);
assert.strictEqual(violations.length, 1);
assert.match(violations[0].reason, /제외 품목/);

// 위반 없는 정상 케이스
const okMeals = [
  { day: '월', slot: '아침', menu: '요거트', uses: [] },
  { day: '월', slot: '점심', menu: '김치찌개', uses: [] }
];
assert.strictEqual(checkRules(okMeals, []).length, 0);

assert.strictEqual(isStew('된장찌개'), true);
assert.strictEqual(isStew('소불고기'), false);

console.log('rules.test.js 통과');
