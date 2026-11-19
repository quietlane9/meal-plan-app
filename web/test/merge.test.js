const assert = require('assert');
const { mergeExtractedItems } = require('../lib/merge.js');

// 같은 품목이 두 묶음에 겹쳐 나오면 하나로 합친다.
const batches1 = [
  { items: [{ brand: 'CJ', name: '백설 설탕', size: '1kg', purchase_count: 3, confidence: 0.9 }] },
  { items: [{ brand: 'CJ', name: '백설 설탕', size: '1kg', purchase_count: 5, confidence: 0.6 }] }
];
const merged1 = mergeExtractedItems(batches1);
assert.strictEqual(merged1.length, 1);
assert.strictEqual(merged1[0].purchase_count, 5); // 더 큰 구매횟수 채택
assert.strictEqual(merged1[0].confidence, 0.9); // confidence 높은 쪽 필드 유지

// 상품명이 '...'로 잘린 항목이 다음 장에서 confidence 높게 보완되면 그걸 채택한다.
const batches2 = [
  { items: [{ brand: '', name: '손질 오징어 (7...', size: '', purchase_count: 2, confidence: 0.4 }] },
  { items: [{ brand: '', name: '손질 오징어 (7미)', size: '', purchase_count: 2, confidence: 0.85 }] }
];
const merged2 = mergeExtractedItems(batches2);
assert.strictEqual(merged2.length, 1);
assert.strictEqual(merged2[0].name, '손질 오징어 (7미)');

// 다른 품목은 따로 남는다.
const batches3 = [
  { items: [{ brand: 'A', name: '상품1', size: '', purchase_count: 1, confidence: 0.9 }] },
  { items: [{ brand: 'B', name: '상품2', size: '', purchase_count: 1, confidence: 0.9 }] }
];
assert.strictEqual(mergeExtractedItems(batches3).length, 2);

console.log('merge.test.js 통과');
