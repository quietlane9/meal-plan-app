/**
 * Gemini 호출 공통 함수. responseSchema로 구조화 출력을 받는다.
 * - GEMINI_MODEL은 모델 하나(문자열) 또는 여러 개(쉼표 목록 "a,b" 또는 JSON 배열 '["a","b"]')로 둘 수 있지만,
 *   폴백은 앞에서부터 최대 MAX_FALLBACK_MODELS개까지만 쓴다(더 적으면 있는 만큼만).
 * - 400(INVALID_ARGUMENT)은 thinkingConfig 형식을 모델이 거부한 경우가 많아, 같은 모델로
 *   thinkingBudget:0 → thinkingLevel:'low' → thinkingConfig 없음 순으로 자동으로 바꿔가며 다시 보낸다
 *   (thinkingLevel:'minimal'은 실측 58초로 'low'보다 훨씬 느려서 뺐다). 그래도 400이면 그 모델은
 *   포기하고 다음 모델로 넘어간다. 400이 나면 요청의 generationConfig·responseSchema를 console.log로
 *   남긴다(프롬프트·이미지 본문은 제외).
 * - 429(한도 초과)는 같은 모델로 1초 쉬고 한 번만 재시도한다. 503(과부하)은 재시도하지 않고
 *   바로 다음 모델로 넘어간다. 무료 등급은 사용량이 몰리면 503이 자주 나는데, 이건 구글 쪽
 *   처리 지연이라 모델을 여러 개 등록해 두는 것 외에는 코드로 고칠 수 없다.
 * - 전체 호출(모델·재시도 통틀어)은 TOTAL_TIME_BUDGET_MS 안에 끝나야 하며, 넘으면 더 시도하지 않고 바로 실패를 던진다.
 *   (UrlFetchApp은 중간에 끊을 수 없어서, 이미 보낸 요청 자체가 느리면 이 상한을 못 지킬 수 있다.)
 * - 모델명·시도 번호·입력 문자수·소요시간(ms)·HTTP 코드·usageMetadata의 출력 토큰 수를 매 시도마다 console.log로 남긴다.
 */
const MAX_FALLBACK_MODELS = 4;
const MAX_ATTEMPTS_PER_MODEL = 2; // 429 재시도 포함 최대 2번(최초 + 1회)
const TOTAL_TIME_BUDGET_MS = 90000;

const DEFAULT_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];

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
      console.log('Gemini 중단 — 모델: ' + models[i] + ', 사유: 전체 시간 상한 초과');
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

/** 모델 하나에 대해, 400이면 thinkingConfig를 점점 단순한 형태로 바꿔가며 다시 시도한다. */
function callGeminiModel_(model, apiKey, parts, schema, temperature, options, deadline) {
  const maxOutputTokens = options && options.maxOutputTokens;
  // test_plan_minimal()로 실측: thinkingLevel 'minimal'은 'low'·thinkingConfig 없음(둘 다 ~8~9초)보다
  // 훨씬 느릴 수 있어(58초 측정됨) 폴백 체인에서 뺐다.
  const thinkingChain = options && options.thinkingConfig
    ? [options.thinkingConfig, { thinkingLevel: 'low' }, null]
    : [null];

  let lastErr;
  for (let v = 0; v < thinkingChain.length; v++) {
    try {
      return performGeminiRequest_(model, apiKey, parts, schema, temperature, thinkingChain[v], maxOutputTokens, deadline);
    } catch (err) {
      lastErr = err;
      if (err.httpCode !== 400) throw err; // 400이 아니면 thinkingConfig 문제가 아니므로 더 시도하지 않는다.
      console.log('Gemini 400 — 모델: ' + model + ', thinkingConfig 거부됨: ' + JSON.stringify(thinkingChain[v]) + ', 다음 변형 시도');
    }
  }

  throw lastErr;
}

function throwHttp_(code, message) {
  const err = new Error(message);
  err.httpCode = code;
  throw err;
}

/** thinkingConfig 한 가지로 실제 fetch를 보낸다. 429는 1회 재시도, 503은 재시도 없이 바로 던진다. */
function performGeminiRequest_(model, apiKey, parts, schema, temperature, thinkingConfig, maxOutputTokens, deadline) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  const generationConfig = {
    temperature: temperature,
    responseMimeType: 'application/json',
    responseSchema: schema
  };
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: generationConfig
  };
  const inputChars = parts.reduce((sum, p) => sum + (p.text ? p.text.length : 0), 0);

  const fetchOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let lastError = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
    if (Date.now() >= deadline) {
      throwHttp_(0, '전체 시간 상한 초과');
    }

    console.log(
      'Gemini 요청 — 모델: ' + model +
      ', 시도: ' + (attempt + 1) + '/' + MAX_ATTEMPTS_PER_MODEL +
      ', 입력 문자수: ' + inputChars +
      ', thinkingConfig: ' + JSON.stringify(thinkingConfig)
    );

    const start = Date.now();
    const res = UrlFetchApp.fetch(url, fetchOptions);
    const code = res.getResponseCode();
    const elapsed = Date.now() - start;
    const bodyText = res.getContentText();

    let usage = null;
    if (code === 200) {
      try {
        usage = JSON.parse(bodyText).usageMetadata || null;
      } catch (err) {
        usage = null;
      }
    }

    console.log(
      'Gemini 응답 — 모델: ' + model +
      ', 소요: ' + elapsed + 'ms, HTTP: ' + code +
      (usage ? ', 출력토큰: ' + usage.candidatesTokenCount + ', 전체토큰: ' + usage.totalTokenCount : '')
    );

    if (code === 200) {
      const json = JSON.parse(bodyText);
      const text = json.candidates[0].content.parts[0].text;
      return JSON.parse(text);
    }

    if (code === 400) {
      console.log('Gemini 400 요청 본문 — generationConfig: ' + JSON.stringify(generationConfig) + ', responseSchema: ' + JSON.stringify(schema));
      throwHttp_(400, '호출 실패(400): ' + bodyText);
    }

    if (code === 429) {
      lastError = bodyText;
      const hasRetryLeft = attempt < MAX_ATTEMPTS_PER_MODEL - 1;
      if (hasRetryLeft && Date.now() + 1000 < deadline) {
        Utilities.sleep(1000);
      }
      continue;
    }

    if (code === 503) {
      throwHttp_(503, '호출 실패(503): ' + bodyText);
    }

    throwHttp_(code, '호출 실패(' + code + '): ' + bodyText);
  }

  throwHttp_(429, '재시도 초과: ' + lastError);
}
