/**
 * 4장씩 묶어 호출한 추출 결과들을 하나로 병합하고 중복을 없앤다.
 * 같은 브랜드·용량에서 상품명이 '...'로 잘린 것과 다음 장에서 풀린 것은
 * 접두사 매칭으로 같은 품목으로 묶고, confidence가 더 높은 쪽을 채택한다.
 */
(function (global) {
  const makeKey = typeof require !== 'undefined'
    ? require('./itemKey.js').makeItemKey
    : global.makeItemKey;

  function normalizeField(v) {
    return (v || '').toString().trim().toLowerCase();
  }

  function stripTruncation(name) {
    return (name || '').replace(/(\.{2,}|…)\s*$/, '').trim();
  }

  function isSameItem(a, b) {
    if (normalizeField(a.brand) !== normalizeField(b.brand)) return false;
    if (normalizeField(a.size) !== normalizeField(b.size)) return false;

    const an = stripTruncation(a.name);
    const bn = stripTruncation(b.name);
    if (!an || !bn) return false;

    return an === bn || an.startsWith(bn) || bn.startsWith(an);
  }

  function mergeExtractedItems(batches) {
    const items = [];
    batches.forEach(batch => (batch.items || []).forEach(item => items.push(item)));

    const clusters = [];
    items.forEach(item => {
      const cluster = clusters.find(c => c.some(existing => isSameItem(existing, item)));
      if (cluster) cluster.push(item);
      else clusters.push([item]);
    });

    return clusters.map(cluster => {
      const canonical = cluster.reduce((best, cur) => (
        (cur.confidence || 0) > (best.confidence || 0) ? cur : best
      ));
      const purchaseCount = cluster.reduce((max, cur) => Math.max(max, cur.purchase_count || 0), 0);
      const key = makeKey(canonical.brand, canonical.name, canonical.size);
      return Object.assign({}, canonical, { purchase_count: purchaseCount, item_key: key });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeExtractedItems };
  } else {
    global.mergeExtractedItems = mergeExtractedItems;
  }
})(typeof window !== 'undefined' ? window : globalThis);
