/**
 * 식단 생성(plan.generate)·저장(plan.commit)·가벼운 한 끼(plan.lightOptions)·조회(plan.list).
 *
 * plan.generate는 Gemini 결과를 "미리보기"로만 돌려주고 시트에 아무것도 쓰지 않는다.
 * plan.commit이 실제 저장을 맡는다. 이렇게 나눈 이유: 새로 만들기를 누르고 Gemini 호출이
 * 중간에 실패하면(503 등) 기존 식단을 전혀 건드리지 않아야 하기 때문 — 생성이 전부 끝난
 * 뒤에야 지우고 쓴다. plan.commit은 target_cells에 해당하는 기존 행만 지우고 새로 넣으므로,
 * '오늘 이후만 다시 짜기'처럼 일부 칸만 바꿀 때 나머지 칸은 그대로 남는다.
 *
 * 실행 로그에서 7일(21끼)을 한 번에 요청하면 200~360초가 걸려 GAS 6분 제한에 걸리는 걸 확인해서,
 * plan.generate는 항상 only_cells로 범위를 받는다(없으면 전체 21칸). 클라이언트가 한 번에
 * 최대 12칸씩 나눠 호출한다.
 *
 * 출력을 줄이기 위해 uses는 item_key 문자열이 아니라 프롬프트에 함께 보낸 품목 "번호"(정수)로 받아
 * 서버에서 item_key로 되돌린다. note·light_options·shopping은 스키마에서 뺐다.
 * light_options는 별도 액션(plan.lightOptions)으로, shopping은 Gemini가 만들지 않고
 * 서버가 uses+Inventory로 계산한다.
 *
 * 같은 week_start+day+slot 행이 여러 개 쌓여 있을 수 있어(과거 버그), 읽을 때는 항상
 * dedupeLatestByDaySlot_으로 가장 아래(나중에 쓰인) 행만 남긴다.
 */
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOTS = ['아침', '점심', '저녁'];
const DIFFICULTIES = ['쉬움', '보통', '손 많이 감'];
const TOP_ITEMS_LIMIT = 30;
const PLAN_MAX_OUTPUT_TOKENS = 1792; // sides 추가로 meal당 출력이 조금 늘어 여유를 둠
const LIGHT_MAX_OUTPUT_TOKENS = 512;

/**
 * meals 배열 길이를 요청한 칸 수와 정확히 같게(minItems=maxItems) 강제한다.
 * 이걸 안 하면 Gemini가 required만 맞춘 빈 배열(또는 일부만)을 돌려줘도 스키마상 유효해서,
 * "완료"라고 나오는데 테이블은 비어 있는 상태가 생길 수 있다.
 */
function buildPlanSchema_(cellCount) {
  return {
    type: 'object',
    properties: {
      meals: {
        type: 'array',
        minItems: cellCount,
        maxItems: cellCount,
        items: {
          type: 'object',
          properties: {
            day: { type: 'string', enum: DAYS },
            slot: { type: 'string', enum: SLOTS },
            menu: { type: 'string' },
            sides: { type: 'array', items: { type: 'string' }, maxItems: 2 },
            uses: { type: 'array', items: { type: 'integer' } },
            difficulty: { type: 'string', enum: DIFFICULTIES }
          },
          required: ['day', 'slot', 'menu', 'difficulty']
        }
      }
    },
    required: ['meals']
  };
}

const LIGHT_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          menu: { type: 'string' },
          uses: { type: 'array', items: { type: 'integer' } },
          difficulty: { type: 'string', enum: DIFFICULTIES }
        },
        required: ['menu', 'difficulty']
      }
    }
  },
  required: ['options']
};

/** 저장 없이 Gemini에 only_cells만큼 생성을 요청하고 결과만 돌려준다. */
function actionPlanGenerate_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');

  const onlyCells = body.only_cells && body.only_cells.length
    ? body.only_cells
    : DAYS.reduce((acc, day) => acc.concat(SLOTS.map(slot => ({ day: day, slot: slot }))), []);

  const items = readRows('Items').filter(it => it.meal_role !== '제외');
  const inventory = readRows('Inventory');
  const settings = readSettingsMap_();
  const compact = buildCompactItemLines_(items, inventory, TOP_ITEMS_LIMIT);

  const existingMeals = dedupeLatestByDaySlot_(readRows('MealPlans').filter(m => m.week_start === weekStart));
  const otherMeals = existingMeals.filter(m => !onlyCells.some(c => c.day === m.day && c.slot === m.slot));

  const prompt = buildPlanPrompt_({
    weekStart: weekStart,
    itemLines: compact.lines,
    settings: settings,
    onlyCells: onlyCells,
    otherMeals: otherMeals
  });

  const result = callGeminiJson_([{ text: prompt }], buildPlanSchema_(onlyCells.length), 0.7, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS
  });
  const rawMeals = result.meals || [];
  if (rawMeals.length !== onlyCells.length) {
    console.log('plan.generate 경고 — 요청 ' + onlyCells.length + '칸, 응답 ' + rawMeals.length + '칸');
  }

  const meals = rawMeals.map(m => ({
    day: m.day,
    slot: m.slot,
    menu: m.menu,
    sides: (m.sides || []).slice(0, 2),
    uses: resolveUsesKeys_(m.uses, compact.keys),
    difficulty: m.difficulty
  }));

  return { meals: meals };
}

/**
 * 미리 생성된 meals를 실제로 저장한다. target_cells(없으면 meals의 day+slot)에 해당하는
 * 기존 행만 지우고 새로 넣는다 — 나머지 칸(예: 오늘 이전, 먹음/외식)은 그대로 남는다.
 */
function actionPlanCommit_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');

  const meals = body.meals || [];
  const targetCells = body.target_cells && body.target_cells.length
    ? body.target_cells
    : meals.map(m => ({ day: m.day, slot: m.slot }));

  targetCells.forEach(c => {
    deleteRowsByMatch('MealPlans', { week_start: weekStart, day: c.day, slot: c.slot });
  });

  meals.forEach(m => {
    appendRow('MealPlans', {
      week_start: weekStart,
      day: m.day,
      slot: m.slot,
      menu: m.menu,
      sides: Array.isArray(m.sides) ? m.sides.join(',') : (m.sides || ''),
      uses: Array.isArray(m.uses) ? m.uses.join(',') : (m.uses || ''),
      difficulty: m.difficulty,
      kind: m.kind || '기본',
      status: m.status || '예정',
      rating: m.rating || ''
    });
  });

  const items = readRows('Items');
  const inventory = readRows('Inventory');
  const savedMeals = dedupeLatestByDaySlot_(readRows('MealPlans').filter(m => m.week_start === weekStart));
  const shopping = computeShoppingList_(savedMeals, items, inventory);

  return { meals: savedMeals.map(formatMealRow_), shopping: shopping };
}

function actionPlanLightOptions_() {
  const items = readRows('Items').filter(it => it.meal_role !== '제외');
  const inventory = readRows('Inventory');
  const compact = buildCompactItemLines_(items, inventory, TOP_ITEMS_LIMIT);

  const prompt = [
    '재고와 자주 사는 품목으로 다이어트용 가벼운 한 끼 후보 3개를 제안하라.',
    '[품목] (번호:이름(분류/역할)구매N회[/재고상태]. 역할=메인/반찬/아침/간식/음료)',
    compact.lines.join('\n') || '(데이터 없음)',
    'uses는 위 [품목] 번호만 정수 배열로 넣어라. 메뉴명은 짧게 써라(10자 이내 권장).',
    '각 후보에 난도(쉬움/보통/손 많이 감)를 붙여라.'
  ].join('\n');

  const result = callGeminiJson_([{ text: prompt }], LIGHT_SCHEMA, 0.7, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: LIGHT_MAX_OUTPUT_TOKENS
  });

  const options = (result.options || []).map(o => ({
    menu: o.menu,
    uses: resolveUsesKeys_(o.uses, compact.keys),
    difficulty: o.difficulty
  }));

  return { light_options: options };
}

function actionPlanList_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');

  const items = readRows('Items');
  const inventory = readRows('Inventory');
  const meals = dedupeLatestByDaySlot_(readRows('MealPlans').filter(m => m.week_start === weekStart));
  const shopping = computeShoppingList_(meals, items, inventory);

  return { meals: meals.map(formatMealRow_), shopping: shopping };
}

/** 같은 day+slot이 여러 행이면 가장 아래(나중) 행만 남긴다. */
function dedupeLatestByDaySlot_(meals) {
  const map = new Map();
  meals.forEach(m => { map.set(m.day + '|' + m.slot, m); });
  return Array.from(map.values());
}

function resolveUsesKeys_(uses, keys) {
  return (uses || []).map(i => keys[i]).filter(Boolean);
}

function formatMealRow_(m) {
  return {
    day: m.day,
    slot: m.slot,
    menu: m.menu,
    sides: m.sides ? String(m.sides).split(',').filter(Boolean) : [],
    uses: m.uses ? String(m.uses).split(',').filter(Boolean) : [],
    difficulty: m.difficulty,
    kind: m.kind,
    status: m.status,
    rating: m.rating
  };
}

/** uses 중 재고가 '있음'·'조금'이 아닌 재료를 장보기 목록으로 계산한다(Gemini가 만들지 않음). */
function computeShoppingList_(meals, items, inventory) {
  const itemMap = {};
  items.forEach(it => { itemMap[it.item_key] = it; });
  const invStatus = {};
  inventory.forEach(inv => { invStatus[inv.item_key] = inv.status; });

  const shoppingMap = new Map();

  meals.forEach(m => {
    const uses = Array.isArray(m.uses) ? m.uses : String(m.uses || '').split(',').filter(Boolean);
    uses.forEach(key => {
      if (!key || shoppingMap.has(key)) return;
      const status = invStatus[key];
      if (status === '있음' || status === '조금') return;
      const item = itemMap[key];
      const name = item ? (item.brand ? item.brand + ' ' + item.name : item.name) : key;
      shoppingMap.set(key, { item_key: key, name: name, reason: '식단에 필요' });
    });
  });

  return Array.from(shoppingMap.values());
}

/**
 * Items를 "번호:이름(분류/역할)구매N회[/재고상태]" 한 줄씩으로 압축한다.
 * 번호는 반환하는 keys 배열의 인덱스와 같고, Gemini가 uses에 이 번호를 넣으면 keys[번호]로 item_key를 되돌린다.
 * 역할(meal_role: 메인/반찬/아침/간식/음료)을 넣는 이유: 이게 없으니 모델이 간식(과자)을
 * 반찬으로 쓰는 등 역할을 헷갈려 했다. 보관(storage)보다 역할이 조합 품질에 더 중요해서 바꿨다.
 */
function buildCompactItemLines_(items, inventory, limit) {
  const invStatus = {};
  inventory.forEach(inv => { invStatus[inv.item_key] = inv.status; });

  const top = items
    .slice()
    .sort((a, b) => (Number(b.purchase_count) || 0) - (Number(a.purchase_count) || 0))
    .slice(0, limit);

  const keys = top.map(it => it.item_key);
  const lines = top.map((it, idx) => {
    const status = invStatus[it.item_key];
    const stockTag = status ? '/재고' + status : '';
    return idx + ':' + it.name + '(' + it.category + '/' + (it.meal_role || '기타') + ')구매' + (it.purchase_count || 0) + '회' + stockTag;
  });

  return { lines: lines, keys: keys };
}

function buildPlanPrompt_(ctx) {
  const settings = ctx.settings;

  const lines = [
    ctx.weekStart + '부터 시작하는 주의 식단을 짜라.',
    '아래 칸만 짜서 meals에 그 칸들만 넣어라. 나머지 칸은 넣지 마라.',
    ctx.onlyCells.map(c => '- ' + c.day + ' ' + c.slot).join('\n'),
    '[품목] (번호:이름(분류/역할)구매N회[/재고상태]. 역할=메인/반찬/아침/간식/음료)',
    ctx.itemLines.join('\n') || '(데이터 없음)',
    '[설정] 식구 수 ' + (settings.headcount || '4') + ', 끼니별 인원 ' + (settings.slot_headcount || ''),
    '[제외 음식] ' + (settings.exclude_foods || '없음'),
    '[규칙] ' + (settings.rules || ''),
    '재고 있음·조금 품목을 먼저 쓰되(없음은 빼고, 조금은 곁들임으로만), 재고 표시가 없으면 구매횟수 기준으로 골라라.',
    '한 끼니는 보통 메인 요리 1개 + 반찬 1~2개를 같이 먹는 조합이다. 단품(아침·간식 등 원래 하나만 먹는 끼니)만 예외다.',
    'menu는 역할이 메인·아침인 품목(또는 그 조합 요리) 위주로 정하고, sides는 역할이 반찬인 품목으로만 골라라.',
    '간식·음료 역할 품목은 sides에 넣지 마라(과자·음료는 반찬이 아니다).',
    '점심·저녁은 특별한 사정이 없으면 sides를 빈 배열로 두지 말고 1~2개 채워라.',
    '같은 메인 메뉴는 3일 안에 반복하지 마라. 찌개류는 하루 한 번까지.',
    '아침은 요거트·우유·시리얼만 반복하지 말고, 대부분은 밥+국(또는 찌개) 조합이나 유부초밥 같은 한 손에 먹는 핑거푸드로 짜라. 빵(토스트·샌드위치 등) 위주 식단은 일주일에 1~2번만 넣어라.',
    'menu·sides 모두 짧게 써라(각 10자 이내 권장).',
    'uses에는 menu와 sides에 쓰인 재료를 모두 포함해 위 [품목] 번호로 넣어라. 해당 재료가 [품목] 목록에 없으면 비워 둬도 된다.',
    '각 끼니에 난도(쉬움/보통/손 많이 감)를 붙여라.'
  ];

  if (ctx.otherMeals && ctx.otherMeals.length) {
    lines.push('이번 주 이미 정해진 다른 끼니(3일 내 반복 금지 참고용):');
    ctx.otherMeals.forEach(m => lines.push('- ' + m.day + ' ' + m.slot + ': ' + m.menu));
  }

  return lines.join('\n');
}
