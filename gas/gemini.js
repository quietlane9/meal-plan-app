/**
 * Gemini 호출 공통 함수. responseSchema로 구조화 출력을 받고,
 * 429(한도 초과)/503(과부하) 응답은 지수 백오프로 최대 3회 재시도한다.
 */
function callGeminiJson_(parts, schema, temperature) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 GEMINI_API_KEY가 없습니다.');
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || 'gemini-2.0-flash';
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

    throw new Error('Gemini 호출 실패(' + code + '): ' + res.getContentText());
  }

  throw new Error('Gemini 재시도 초과: ' + lastError);
}
