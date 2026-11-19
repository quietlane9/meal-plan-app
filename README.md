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
- 새 standalone 프로젝트를 만들거나(`cd gas && clasp create-script --type standalone --title "meal-plan-app" --rootDir .`) 기존 프로젝트의 스크립트 ID를 쓴다.
- `clasp create-script`가 `appsscript.json`을 기본값으로 덮어쓰므로, 실행 후 `timeZone: Asia/Seoul`과 `webapp` 설정이 그대로인지 확인한다.
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

**이후 코드를 고칠 때마다 주의**: `clasp push`는 스크립트 내용만 올릴 뿐, 이미 배포된 웹앱 URL은 그 시점의 버전에 고정돼 있어 자동으로 갱신되지 않는다. 같은 URL을 유지하면서 최신 코드를 반영하려면 `clasp push` 후 아래처럼 그 배포를 재배포한다.
```bash
clasp deployments               # 배포 ID 확인
clasp deploy -i <배포ID> -d "설명"
```
(`-i` 없이 `clasp deploy`만 실행하면 새 URL의 배포가 또 생기므로, 반드시 기존 배포 ID를 지정한다.)

### 6. 프런트에 URL 연결
`web/config.js`:
```js
const GAS_URL = '여기에 5번에서 복사한 웹앱 URL';
```

웹 화면의 **설정** 탭에서 4번의 `ACCESS_TOKEN`과 같은 값을 입력해 저장한다(브라우저 로컬 저장).

### 7. 동작 확인
- `samples/ssg-frequent` 14장을 "자주구매"로 올려 추출 → 검수 → 저장까지 끝까지 해본다.
- 기준: 약 55개 품목이 중복 없이 Items 시트에 쌓이고, 구매횟수(15, 11, 10…)가 맞는지 확인.

### 8. 초기 데이터 시딩 (선택, 한 번만)
과거 자주구매 56개 품목을 업로드 화면 없이 바로 시트에 넣고 싶을 때 쓴다.

1. `samples/seed-items-2026-11-19.csv`를 `gas/seed_data.js`의 `SEED_DATA` 상수(JSON 배열)로 바꿔 둔다. 이 파일은 개인 구매 데이터라 `.gitignore`에 있고 `clasp push`로만 Apps Script에 올라간다.
2. `cd gas && clasp push`
3. Apps Script 편집기에서 `seed_import()` 함수를 실행한다.
   - Items는 `item_key` 기준 upsert라 두 번 실행해도 중복되지 않는다.
   - Purchases는 `upload_id='seed-20261119'`로 이미 들어간 `item_key`는 건너뛰어서, 두 번 실행해도 중복이 쌓이지 않는다.
   - `note` 열은 시트에 저장하지 않는다.
   - 실행 후 로그에 "Items 신규 N, 갱신 M / Purchases 추가 K, 건너뜀 L"이 찍힌다.

## GitHub Pages 배포
`.github/workflows/pages.yml`이 `web/` 폴더만 GitHub Pages로 배포한다(`main` 브랜치의 `web/**` 변경 시 자동 실행).
저장소 설정의 **Settings → Pages → Source**를 "GitHub Actions"로 지정해야 한다.
