/**
 * GAS 호출 공통 함수. CORS preflight를 피하기 위해 text/plain으로 POST한다.
 * ACCESS_TOKEN은 설정 화면에서 입력받아 로컬에 저장해 둔다.
 */
const TOKEN_STORAGE_KEY = 'mealplan_token';

function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

function setToken(token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

async function callApi(action, payload) {
  if (!GAS_URL) throw new Error('web/config.js에 GAS_URL을 설정하세요.');

  const body = Object.assign({ token: getToken(), action }, payload);
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}
