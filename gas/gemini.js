/**
 * Gemini 호출 공통 함수. responseSchema로 구조화 출력을 받는다.
 * - GEMINI_MODEL은 모델 하나(문자열) 또는 여러 개(쉼표 목록 "a,b" 또는 JSON 배열 '["a","b"]')로 둘 수 있지만,
 *   폴백은 앞에서부터 최대 MAX_FALLBACK_MODELS개까지만 쓴다(더 적으면 있는 만큼만).
 * - 모델 하나당 최초 시도 + 재시도 1회(총 2번)만 하고, 429/503이면 1초 쉬고 한 번만 다시 해본다.
 * - 전체 호출(모델·재시도 통틀어)은 TOTAL_TIME_BUDGET_MS 안에 끝나야 하며, 넘으면 더 시도하지 않고 바로 실패를 던진다.
 * - 모델명·시도 번호·소요시간(ms)·HTTP 코드를 매 시도마다 Logger로 남긴다.
 * - options.thinkingConfig를 넘기면 그대로 generationConfig.thinkingConfig에 실어 보낸다.
 *   추출처럼 읽기만 하는 호출은 { thinkingBudget: 0 }으로 생각(thinking)을 꺼서 응답을 빠르게 받는다.
 */
const MAX_FALLBACK_MODELS = 2;
const MAX_ATTEMPTS_PER_MODEL = 2; // 최초 시도 + 재시도 1회
const TOTAL_TIME_BUDGET_MS = 90000;

const DEFAULT_GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.7-flash'];

function resolveGeminiModels_() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL');
  let models = DEFAULT_GEMINI_MODELS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) models = parsed;
    } catch (err) {
      const list = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) models = list;
    }
  }

  return models.slice(0, MAX_FALLBACK_MODELS);
}

function callGeminiJson_(parts, schema, temperature, options) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 GEMINI_API_KEY가 없습니다.');

  const models = resolveGeminiModels_();
  const deadline = Date.now() + TOTAL_TIME_BUDGET_MS;
  const errors = [];

  for (let i = 0; i < models.length; i++) {
    if (Date.now() >= deadline) {
      errors.push(models[i] + ': 전체 시간 상한(' + (TOTAL_TIME_BUDGET_MS / 1000) + '초) 초과로 시도 안 함');
      Logger.log('Gemini 중단 — 모델: ' + models[i] + ', 사유: 전체 시간 상한 초과');
      break;
    }
    try {
      return callGeminiModel_(models[i], apiKey, parts, schema, temperature, options, deadline);
    } catch (err) {
      errors.push(models[i] + ': ' + err.message);
    }
  }

  throw new Error('Gemini 호출 실패(전체 상한 ' + (TOTAL_TIME_BUDGET_MS / 1000) + '초):\n' + errors.join('\n'));
}

function callGeminiModel_(model, apiKey, parts, schema, temperature, options, deadline) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  const generationConfig = {
    temperature: temperature,
    responseMimeType: 'application/json',
    responseSchema: schema
  };
  if (options && options.thinkingConfig) {
    generationConfig.thinkingConfig = options.thinkingConfig;
  }

  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: generationConfig
  };

  const fetchOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let lastError = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
    if (Date.now() >= deadline) {
      throw new Error('전체 시간 상한 초과');
    }

    const start = Date.now();
    const res = UrlFetchApp.fetch(url, fetchOptions);
    const code = res.getResponseCode();
    const elapsed = Date.now() - start;
    Logger.log(
      'Gemini 호출 — 모델: ' + model +
      ', 시도: ' + (attempt + 1) + '/' + MAX_ATTEMPTS_PER_MODEL +
      ', 소요: ' + elapsed + 'ms, HTTP: ' + code
    );

    if (code === 200) {
      const json = JSON.parse(res.getContentText());
      const text = json.candidates[0].content.parts[0].text;
      return JSON.parse(text);
    }

    if (code === 429 || code === 503) {
      lastError = res.getContentText();
      const hasRetryLeft = attempt < MAX_ATTEMPTS_PER_MODEL - 1;
      if (hasRetryLeft && Date.now() + 1000 < deadline) {
        Utilities.sleep(1000);
      }
      continue;
    }

    throw new Error('호출 실패(' + code + '): ' + res.getContentText());
  }

  throw new Error('재시도 초과: ' + lastError);
}
