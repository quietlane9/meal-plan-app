# 주간 식단 앱 (meal-plan-app)

마트 앱 스크린샷·주문내역·종이 영수증 사진을 **여러 장 한 번에** 올리면 Gemini가 품목을 뽑아 구글시트에 쌓고,
재고·취향·평가를 바탕으로 **7일 × 아침·점심·저녁(21끼)** 식단과 장보기 목록을 만들어 주는 개인용 모바일 웹앱.

상세 명세: `docs/spec.md` (작업 전 반드시 읽을 것) · 단계별 작업 지시: `docs/prompts.md`

## 대화·문서 규칙
- 사용자와의 대화, 코드 주석, 커밋 메시지, UI 문구는 모두 **한국어**.
- 사용자는 개발 경력자다. 설명은 짧게, 결정이 필요한 것만 묻는다.
- 한 단계(`docs/prompts.md`의 Stage)씩 진행하고, 단계가 끝나면 완료 기준을 직접 확인한 뒤 보고한다.

## 기술 스택 (무료만)
- **화면**: `web/` — 빌드 없는 정적 HTML/CSS/바닐라 JS, GitHub Pages로 배포. 모바일 우선(폭 360~430px).
- **서버**: `gas/` — Google Apps Script 웹앱. `doPost` 하나에서 `action`으로 분기.
  - `clasp`로 로컬 ↔ Apps Script 동기화 (`gas/.clasp.json`은 커밋하지 않음).
- **저장소**: 구글시트 (탭: Items, Purchases, Inventory, MealPlans, Feedback, Settings).
- **AI**: Gemini API 무료 등급, Flash 계열 최신 모델. 모델명은 Script Properties `GEMINI_MODEL`로 바꿀 수 있게.

## 반드시 지킬 것
- **API 키는 절대 `web/`에 두지 않는다.** Script Properties(`GEMINI_API_KEY`, `ACCESS_TOKEN`, `SHEET_ID`, `GEMINI_MODEL`)에만 저장.
- 웹 → GAS 호출은 `fetch(GAS_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(...)})`
  (CORS preflight 회피). 모든 요청에 `token` 포함, GAS에서 `ACCESS_TOKEN`과 비교.
- GAS 응답은 `ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON)`.
- Gemini 호출은 항상 `responseMimeType: "application/json"` + `responseSchema`. 추출은 temperature 0~0.2, 식단은 0.7 안팎.
- 429/503 응답은 지수 백오프로 최대 3회 재시도.
- 이미지는 브라우저에서 긴 변 1280px JPEG(품질 0.8)로 줄인 뒤 base64 전송, **4장씩 묶어** 순차 호출.
- 업로드 화면에는 항상 개인정보 경고를 보여준다: "주소·이름·전화번호·카드번호가 보이면 잘라서 올리세요".
  추출 프롬프트에도 개인정보는 출력하지 말라고 명시.
- GAS 실행 시간 6분 제한을 넘지 않게, 한 요청에서 Gemini 호출은 1회만.
- 시트 열 구조는 `gas/schema.js` 한 곳에서 정의하고 모든 읽기·쓰기가 그것을 참조.

## 폴더 구조 (목표)
```
web/            index.html, app.js, api.js, image.js, styles.css, config.js(GAS_URL만)
gas/            Code.js(doPost 라우터), schema.js, sheets.js, gemini.js, prompts.js, plan.js, appsscript.json
docs/           spec.md, prompts.md
samples/        테스트용 스크린샷 (공개 저장소에는 올리지 않음)
```

## 테스트
- `samples/ssg-frequent/` 14장 = SSG 자주구매 화면. 추출 결과 약 55개 품목, 중복 없음이 기준.
- GAS 함수는 Apps Script 편집기의 테스트 함수(`test_*`)로 확인할 수 있게 만든다.
- 순수 로직(item_key 정규화, 중복 병합, 식단 규칙 검사)은 `web/lib/`에 두고 Node로 실행 가능한 간단한 테스트를 둔다.
