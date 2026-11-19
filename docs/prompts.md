# Claude Code 단계별 작업 지시

이 프로젝트 폴더에서 `claude`를 실행한 뒤, 아래 프롬프트를 단계마다 하나씩 붙여 넣으세요.
각 단계가 끝나면 직접 확인하고 커밋한 다음 다음 단계로 넘어갑니다.

---

## Stage 0. 준비 (사람이 할 일, 10분)
1. 구글시트를 새로 만들고 URL의 시트 ID를 복사한다.
2. https://aistudio.google.com 에서 Gemini API 키를 발급한다.
3. `npm i -g @google/clasp` → `clasp login`
4. https://script.google.com/home/usersettings 에서 "Google Apps Script API"를 켠다.
5. GitHub에 빈 저장소 `meal-plan-app`을 만든다(Pages 사용 예정).

---

## Stage 1. 추출 MVP
```
CLAUDE.md와 docs/spec.md를 읽고 Stage 1(추출 MVP)을 구현해줘.

1. gas/ : clasp 프로젝트 구성(appsscript.json, 시간대 Asia/Seoul),
   Code.js(doPost 라우터 + 토큰 검사), schema.js(6개 탭 열 정의), sheets.js(탭 자동 생성·upsert·append),
   gemini.js(responseSchema 호출 + 재시도), prompts.js(추출 프롬프트), setup 함수(Script Properties 안내, 탭 생성).
   action: extract, save.
2. web/ : index.html 한 페이지 + 하단 탭(식단/업로드/재고/설정). 이번 단계는 업로드·검수 화면만 동작.
   image.js(1280px JPEG 축소), api.js(text/plain POST), lib/itemKey.js(정규화), lib/merge.js(묶음 결과 병합·중복 제거).
   업로드 화면에 개인정보 경고 표시.
3. web/lib 테스트를 node로 돌릴 수 있게(test/ 폴더, 외부 라이브러리 없이).
4. 끝나면 배포 순서(clasp push, 웹앱 배포, config.js에 URL 넣기)를 README.md에 정리.

먼저 파일 구조와 시트 열을 보여주고 내가 OK하면 코드를 써줘.
```
확인: samples/ssg-frequent 14장을 올려 약 55개 품목, 중복 없음, 구매횟수(15, 11, 10…)가 맞는지.

---

## Stage 2. 식단 생성
```
docs/spec.md 3·4·7장 기준으로 Stage 2를 구현해줘.
- 설정 화면: 식구 수, 끼니별 인원, 규칙, 제외 음식 (settings.get/set)
- plan.generate: Items·Inventory·Feedback을 모아 식단 프롬프트 호출, MealPlans에 21행 저장
- web/lib/rules.js: 3일 내 반복, 찌개 하루 1회, 제외 품목 사용 검사 → 위반 칸만 only_cells로 재요청
- 홈 화면: 7×3 표, 오늘 강조, 난도 배지, 칸 누르면 상세 + '이 칸 다시 짜기'
rules.js 테스트도 추가해줘.
```
확인: 버튼 한 번에 21끼가 채워지고, 난도가 보이고, 규칙 위반이 없는지.

---

## Stage 3. 재고 연동
```
Stage 3를 구현해줘.
- 주문내역·영수증 업로드 저장 시 Inventory '있음' 반영(없음이던 것도 되돌림)
- 재고 화면: 냉장/냉동/실온 탭, 누를 때마다 있음→조금→없음, 소비기한 임박 순, '추정' 표시
- 식단 칸: 먹음/바꾸기/외식, 좋아요·싫어요 + 이유 칩 → meal.update (먹음이면 uses 재료 한 단계 내림, Feedback append)
- 장보기 목록: 항목마다 SSG 검색 링크(https://www.ssg.com/search.ssg?query=품목명) + '집에 있음' 버튼
```
확인: 일주일 실제로 써 보고 재고 상태가 냉장고와 맞는지.

---

## Stage 4. 다듬기
```
Stage 4를 구현해줘.
- '가벼운 한 끼' 탭: light_options 3개(난도 표시), 고르면 원하는 끼니 칸에 kind='가벼운 한 끼'로 넣기
- PWA(manifest.json, service worker로 정적 파일 캐시), 홈 화면 추가
- 지난 주 식단 보기
```

---

## 막힐 때 쓰는 프롬프트
- `GAS 실행 로그를 보고 원인을 찾아줘. 로그: (붙여넣기)`
- `samples/ssg-frequent/05.jpg 추출 결과가 이렇게 틀렸어: (내용). 프롬프트나 병합 로직을 고쳐줘.`
- `Gemini 429가 자주 나. 묶음 크기와 대기 시간을 조정해줘.`
