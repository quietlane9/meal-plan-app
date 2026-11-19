/**
 * item_key 정규화. web/lib/itemKey.js와 로직이 동일해야 한다.
 * GAS와 브라우저는 별도 런타임이라 파일을 복제해서 둔다(빌드 단계가 없어 공유 모듈을 쓸 수 없음).
 */
function makeItemKey(brand, name, size) {
  const raw = [brand, name, size].filter(Boolean).join('');
  return raw.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}
