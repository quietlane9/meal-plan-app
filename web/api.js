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

/**
 * timeoutMs를 넘기면 요청을 중단하고 알 수 있는 오류로 바꿔 던진다.
 * fetch에는 기본 타임아웃이 없어서, Gemini 응답이 느려지면 화면이 끝없이 멈춘 것처럼 보이기 때문.
 */
async function callApi(action, payload, timeoutMs = 120000) {
  if (!GAS_URL) throw new Error('web/config.js에 GAS_URL을 설정하세요.');

  const body = Object.assign({ token: getToken(), action }, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`응답이 ${Math.round(timeoutMs / 1000)}초 넘게 오지 않아 중단했습니다. 다시 시도해 주세요.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}
