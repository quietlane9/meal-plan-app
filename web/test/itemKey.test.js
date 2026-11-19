const assert = require('assert');
const { makeItemKey } = require('../lib/itemKey.js');

// 소문자화 + 공백/특수문자 제거
assert.strictEqual(makeItemKey('CJ', '백설 설탕', '1kg'), 'cj백설설탕1kg');

// 브랜드가 없어도 동작
assert.strictEqual(makeItemKey('', '손질 오징어', '500g'), '손질오징어500g');

// 같은 상품은 공백 차이와 무관하게 같은 키
assert.strictEqual(
  makeItemKey('오뚜기', '진라면 매운맛', '120g'),
  makeItemKey('오뚜기', '진라면  매운맛', '120g')
);

// 모든 필드가 비어 있으면 빈 문자열
assert.strictEqual(makeItemKey('', '', ''), '');

console.log('itemKey.test.js 통과');
