/**
 * Gemini 호출 공통 함수. responseSchema로 구조화 출력을 받는다.
 * GEMINI_MODEL은 모델 하나(문자열) 또는 여러 개(쉼표 목록 "a,b,c" 또는 JSON 배열 '["a","b"]')로 둘 수 있다.
 * 여러 개면 앞에서부터 순서대로 시도하고, 한 모델이 (재시도 후에도) 실패하면 다음 모델로 넘어간다.
 * 가볍고 빠른 lite 모델을 앞에 두면 평소엔 빨리 끝나고, 막히면 더 안정적인 모델로 자동 전환된다.
 */
const DEFAULT_GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

function resolveGeminiModels_() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL');
  if (!raw) return DEFAULT_GEMINI_MODELS;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (err) {
    // JSON 배열이 아니면 쉼표로 구분된 문자열로 본다.
  }

  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_GEMINI_MODELS;
}

function callGeminiJson_(parts, schema, temperature) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 GEMINI_API_KEY가 없습니다.');

  const models = resolveGeminiModels_();
  const errors = [];

  for (let i = 0; i < models.length; i++) {
    try {
      return callGeminiModel_(models[i], apiKey, parts, schema, temperature);
    } catch (err) {
      errors.push(models[i] + ': ' + err.message);
    }
  }

  throw new Error('모든 Gemini 모델 호출이 실패했습니다.\n' + errors.join('\n'));
}

/** 429(한도 초과)/503(과부하) 응답은 지수 백오프로 최대 3회 재시도한다. */
function callGeminiModel_(model, apiKey, parts, schema, temperature) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: temperature,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();

    if (code === 200) {
      const json = JSON.parse(res.getContentText());
      const text = json.candidates[0].content.parts[0].text;
      return JSON.parse(text);
    }

    if (code === 429 || code === 503) {
      lastError = res.getContentText();
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
      continue;
    }

    throw new Error('호출 실패(' + code + '): ' + res.getContentText());
  }

  throw new Error('재시도 초과: ' + lastError);
}
