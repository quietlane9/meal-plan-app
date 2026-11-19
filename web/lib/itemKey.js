/**
 * item_key 정규화. 브랜드+상품명+용량을 소문자화하고 공백·특수문자를 뺀다.
 * gas/itemKey.js와 로직이 같아야 한다(런타임이 달라 공유 모듈 대신 복제함).
 */
(function (global) {
  function makeItemKey(brand, name, size) {
    const raw = [brand, name, size].filter(Boolean).join('');
    return raw.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { makeItemKey };
  } else {
    global.makeItemKey = makeItemKey;
  }
})(typeof window !== 'undefined' ? window : globalThis);
