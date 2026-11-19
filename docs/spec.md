# 주간 식단 앱 상세 명세

## 1. 목표
- 스크린샷 10~20장을 1분 안에 올리고 검수까지 끝낸다. 품목을 하나씩 입력하는 단계는 없다.
- 재고와 자주 사는 품목 위주로 7일 × 아침·점심·저녁 식단을 만든다.
- 식단에 필요한데 없는 재료만 장보기 목록으로 뽑는다.
- 비용 0원: GitHub Pages, Google Apps Script, 구글시트, Gemini API 무료 등급.

## 2. 업로드 종류
| 종류 | 의미 | 저장 대상 |
| --- | --- | --- |
| 자주구매 | 과거 전체 구매 목록. 재고 아님. "N회 구매" 배지 = 선호도 | Items(upsert), Purchases |
| 주문내역 | 이번 실제 구매 | Items, Purchases, Inventory('있음') |
| 종이 영수증 | 이번 실제 구매. 줄임 상품명을 일반 이름으로 풀기 | Items, Purchases, Inventory('있음') |

스크롤 캡처는 서로 겹치고 상품명이 잘린다("손질 오징어 (7…"). 중복 제거와 포장 사진 문구로 보완이 필요하다.

## 3. 화면
| 화면 | 하는 일 | 포인트 |
| --- | --- | --- |
| ① 홈(이번 주 식단) | 7×3 표, 오늘 칸 강조, 칸마다 난도 표시 | 칸을 누르면 먹음 / 바꾸기 / 외식 / 좋아요·싫어요. 먹음이면 쓴 재료 상태를 한 단계 내림 |
| ② 일괄 업로드 | 여러 장 선택 + 종류 선택(자주구매/주문내역/종이 영수증) | `input type=file multiple accept=image/*`, 1280px 축소, 4장 묶음, 진행률. 선택 직후 개인정보 경고 |
| ③ 검수 | 추출 품목 카드 목록 | 중복 자동 병합, 체크 해제·수정 후 저장. confidence < 0.7 노란색. "비슷한 품목 합치기" |
| ④ 재고 | 냉장·냉동·실온 탭, 상태(있음/조금/없음)와 구매일 | 누를 때마다 있음→조금→없음. 없음은 목록·식단 생성에서 빠지고 자주 사는 품목이면 장보기 후보로. 소비기한 임박 순 |
| ⑤ 설정 | 식구 수(입력·수정), 끼니별 인원, 끼니별 규칙, 빼고 싶은 음식 | 바꾸면 다음 생성부터 반영. 예: 평일 점심 1명·저녁 4명, 주말 점심 외식, 밀키트 주 3회 이하 |
| ⑥ 가벼운 한 끼 | 재고로 만들 수 있는 다이어트식 후보 3개, 난도 표시 | 따로 보여주기만 하고, 고르면 원하는 끼니 칸에 들어감. 고른 것만 재고·장보기 계산에 반영 |
| 장보기 목록 | 식단에 필요한데 재고 없는 재료 | 항목마다 SSG 검색 링크 + '집에 있음' 버튼(누르면 재고 '있음' 등록, 목록에서 빠짐. 식단은 그대로) |

난도 기준: 쉬움 = 데우기·끓이기 / 보통 = 굽기·볶기 한 가지 / 손 많이 감 = 손질 + 여러 단계.

## 4. 식단 생성 규칙
- 재고의 '있음'·'조금' 품목을 먼저 쓴다('없음' 제외, '조금'은 곁들임 재료로만). 소비기한 짧은 것(두부·콩나물·애호박·버섯)은 월·화에.
- 같은 메인 메뉴는 3일 안에 반복하지 않는다. 찌개류는 하루 한 번까지.
- 아침은 유제품·유부초밥·샌드위치·과일 조합으로 가볍게.
- 밀키트 분량(예: 2인분)이 그 끼니 인원보다 적으면 반찬을 더한다.
- 구매 횟수가 많은 메뉴 우선, 주 1회는 새 메뉴. 싫어요 받은 메뉴는 4주간 제외, 좋아요 받은 메뉴는 2주에 한 번꼴로 다시.
- 식단역할 '제외'(주류·논알콜·생활용품)는 쓰지 않는다.
- 생성 후 `web/lib/rules.js`로 규칙 위반을 검사하고, 위반 칸만 다시 생성 요청.

## 5. 구글시트
`item_key` = 브랜드+상품명+용량을 소문자화하고 공백·특수문자를 뺀 값. 같은 상품을 다시 올리면 기존 행이 갱신된다.

| 탭 | 열 | 갱신 |
| --- | --- | --- |
| Items | item_key, brand, name, size, category, storage(냉장/냉동/실온), meal_role(메인/반찬/아침/간식/음료/제외), servings, shelf_days, purchase_count, last_price, preference(+1/0/-1), updated_at | upsert. purchase_count는 큰 값으로만 |
| Purchases | uploaded_at, upload_type(자주구매/주문내역/영수증), item_key, qty, price, upload_id | append |
| Inventory | item_key, status(있음/조금/없음), bought_at, expected_until, emptied_at | 주문내역·영수증 저장 시 '있음'(없음이던 것도 되돌림). 먹음 시 한 단계 내림. '집에 있음' 버튼으로 '있음' |
| MealPlans | week_start(월요일), day, slot(아침/점심/저녁), menu, uses(item_key 쉼표 목록), difficulty(쉬움/보통/손 많이 감), kind(기본/가벼운 한 끼), status(예정/먹음/바꿈/외식), rating(좋아요/싫어요/없음) | 생성 시 21행 |
| Feedback | date, slot, menu, rating, reason, headcount | append. 생성 때 최근 8주 요약을 프롬프트에 |
| Settings | key, value (headcount, slot_headcount JSON, rules JSON, exclude_foods, access_token은 Script Properties에) | 시트에서 직접 수정 가능 |

shelf_days는 분류별 추정 기본값(두부·콩나물 3일, 잎채소 5일, 냉동 밀키트 30일 등). 화면에는 "추정"이라고 표시.

## 6. GAS API (`doPost`, body = `{token, action, ...}`)
| action | 입력 | 출력 |
| --- | --- | --- |
| extract | images[{mime, data(base64)}], upload_type | items[] |
| save | upload_type, items[] | {saved, updated} |
| inventory.list / inventory.set | — / {item_key, status} | rows / ok |
| plan.generate | week_start, (선택) only_cells[] | meals[], light_options[], shopping[] |
| plan.list | week_start | meals[] |
| meal.update | week_start, day, slot, {status?, rating?, reason?} | ok (+ 재고·Feedback 반영) |
| settings.get / settings.set | — / {key, value} | settings |

## 7. Gemini 프롬프트
### 추출
```
너는 마트 앱 스크린샷·영수증 사진에서 상품을 뽑는 도우미다.
이미지 여러 장은 같은 목록을 스크롤한 것이라 같은 상품이 겹쳐 보일 수 있다. 한 번만 넣어라.
- 각 상품에서 브랜드, 상품명, 용량, 판매가, 'N회 구매' 숫자를 읽어라.
- 상품명이 '...'로 잘렸으면 상품 사진의 포장 문구로 보완하고 confidence를 낮춰라.
- 화면 아래로 잘려 이름이 안 보이는 카드는 다음 장에 나오면 그것을 쓰고, 어디에도 없으면 생략하라.
- 분류, 보관, 식단역할, 인분, 보관일수는 상품 종류로 추정하라.
- 주류·논알콜 음료와 생활용품은 식단역할을 '제외'로 하라.
- 주소·이름·전화·카드번호는 출력하지 마라. 영수증의 줄임 상품명은 일반 이름으로 풀어라.
```
스키마 필드: brand, name, size, price, purchase_count, category, storage, meal_role, servings, shelf_days, confidence(0~1).

### 식단
```
아래 재고, 자주 사는 품목, 설정으로 {시작일}부터 7일간 아침·점심·저녁 식단을 짜라.
[재고] item_key, 이름, 상태, 남은 보관일수
[취향] 구매횟수 상위 30개, 선호 표시, 최근 8주 좋아요·싫어요 메뉴와 이유
[설정] 식구 수, 끼니별 인원, 끼니 규칙, 제외 음식
[규칙] (4장 목록)
각 끼니에 난도(쉬움/보통/손 많이 감)를 붙여라.
다이어트용 가벼운 한 끼 후보 3개를 따로 제안하라.
재고에 없는 재료는 shopping 목록에 넣어라.
```
스키마: meals[{day, slot, menu, uses[item_key], difficulty, note}], light_options[{menu, uses[item_key], difficulty}], shopping[{name, reason}].

## 8. 개발 단계
| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| 1. 추출 MVP | 업로드 → 추출 → 검수 → Items·Purchases 저장 | samples 14장으로 약 55개 품목이 중복 없이 시트에 |
| 2. 식단 생성 | Settings, 식단 프롬프트, 홈 7×3 표(난도), 칸 단위 다시 짜기 | 한 번에 21끼, 규칙 위반 없음 |
| 3. 재고 연동 | 주문내역·영수증 → Inventory, 먹음 시 한 단계 내림, 좋아요·싫어요, 장보기 + SSG 링크 + '집에 있음' | 한 주 실제 사용해서 재고가 맞음 |
| 4. 다듬기 | 가벼운 한 끼 추천, PWA 설치, 지난 주 식단 보기 | 필요할 때 |

## 9. 열린 질문
- 좋아요·싫어요 입력 방식: 끼니 칸마다 버튼 + 이유 칩(맛없음·양 적음·질림·손 많이 감) vs 주말에 한 주치 몰아서 평가. (Stage 3 시작 전 결정, 기본값은 칸마다 버튼)

## 10. 주의
- Gemini 무료 등급은 분당·일일 한도가 있고 자주 바뀐다. AI Studio에서 확인.
- 무료 등급 입력은 구글 제품 개선에 쓰일 수 있다. 개인정보가 보이는 부분은 잘라서 올린다.
- GAS 웹앱을 "모든 사용자"로 배포하므로 ACCESS_TOKEN 검사는 필수.
