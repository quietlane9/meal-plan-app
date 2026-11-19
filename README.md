# 주간 식단 앱 (meal-plan-app)

마트 앱 스크린샷·주문내역·종이 영수증 사진을 올리면 Gemini가 품목을 뽑아 구글시트에 쌓고,
재고·취향·평가를 바탕으로 7일 식단과 장보기 목록을 만들어 주는 개인용 모바일 웹앱.

상세 명세: [`docs/spec.md`](docs/spec.md) · 단계별 작업 지시: [`docs/prompts.md`](docs/prompts.md)

현재 단계: **Stage 1 (추출 MVP)** — 업로드 → 추출 → 검수 → Items/Purchases 저장.

## 로컬 테스트 (web/lib 순수 로직)

```bash
npm test
# 또는
node web/test/itemKey.test.js
node web/test/merge.test.js
```

## 배포 순서

### 1. 구글시트 & Gemini API 준비 (Stage 0)
1. 구글시트를 새로 만들고 URL의 시트 ID를 복사해 둔다.
2. https://aistudio.google.com 에서 Gemini API 키를 발급한다.

### 2. clasp로 Apps Script 프로젝트 연결
```bash
npm i -g @google/clasp
clasp login
```
- https://script.google.com/home/usersettings 에서 "Google Apps Script API"를 켠다.
- 새 Apps Script 프로젝트를 만들거나(`clasp create --type webapp --rootDir gas`) 기존 프로젝트의 스크립트 ID를 사용한다.
- `gas/.clasp.json.example`을 참고해 `gas/.clasp.json`을 만들고 `scriptId`를 채운다. (`.clasp.json`은 `.gitignore`에 있어 커밋되지 않는다.)

### 3. 코드 업로드
```bash
cd gas
clasp push
```

### 4. Script Properties 입력 (clasp push와 웹앱 배포 사이에 꼭 하기)
Apps Script 편집기 → 프로젝트 설정 → **스크립트 속성**에서 아래 4개를 추가한다.

| 키 | 값 |
| --- | --- |
| `GEMINI_API_KEY` | AI Studio에서 발급한 키 |
| `ACCESS_TOKEN` | 임의로 정한 비밀 문자열(웹앱 호출 인증용) |
| `SHEET_ID` | 1단계에서 만든 구글시트 ID |
| `GEMINI_MODEL` | 예: `gemini-2.0-flash` |

입력 후 Apps Script 편집기에서 `setup` 함수를 한 번 실행한다. (6개 탭이 없으면 자동 생성, 누락된 속성은 로그에 안내)

### 5. 웹앱 배포
Apps Script 편집기 → **배포 → 새 배포**
- 유형: **웹 앱**
- 실행: **나**
- 액세스 권한: **모든 사용자**

배포 후 나오는 웹앱 URL을 복사해 둔다.

### 6. 프런트에 URL 연결
`web/config.js`:
```js
const GAS_URL = '여기에 5번에서 복사한 웹앱 URL';
```

웹 화면의 **설정** 탭에서 4번의 `ACCESS_TOKEN`과 같은 값을 입력해 저장한다(브라우저 로컬 저장).

### 7. 동작 확인
- `samples/ssg-frequent` 14장을 "자주구매"로 올려 추출 → 검수 → 저장까지 끝까지 해본다.
- 기준: 약 55개 품목이 중복 없이 Items 시트에 쌓이고, 구매횟수(15, 11, 10…)가 맞는지 확인.

## GitHub Pages 배포
`.github/workflows/pages.yml`이 `web/` 폴더만 GitHub Pages로 배포한다(`main` 브랜치의 `web/**` 변경 시 자동 실행).
저장소 설정의 **Settings → Pages → Source**를 "GitHub Actions"로 지정해야 한다.
