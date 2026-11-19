/**
 * 식단 생성(plan.generate)·가벼운 한 끼(plan.lightOptions)·조회(plan.list).
 *
 * 실행 로그에서 7일(21끼)을 한 번에 요청하면 200~360초가 걸려 GAS 6분 제한에 걸리는 걸 확인했다.
 * 그래서 이 함수는 항상 only_cells로 범위를 받는다(없으면 전체 21칸으로 간주) — 기본 흐름은
 * 클라이언트가 월~목/금~일로 쪼개 두 번 호출하고, 규칙 위반 칸만 다시 요청할 때도 같은 길을 쓴다.
 * 출력을 더 줄이기 위해:
 * - uses는 item_key 문자열이 아니라 프롬프트에 함께 보낸 품목 "번호"(정수)로 받아 서버에서 item_key로 되돌린다.
 * - note·light_options·shopping은 스키마에서 뺐다. light_options는 별도 액션(plan.lightOptions)으로,
 *   shopping은 Gemini가 만들지 않고 서버가 uses+Inventory로 계산한다.
 */
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOTS = ['아침', '점심', '저녁'];
const DIFFICULTIES = ['쉬움', '보통', '손 많이 감'];
const TOP_ITEMS_LIMIT = 30;
const PLAN_MAX_OUTPUT_TOKENS = 1536;
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

function actionPlanGenerate_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');

  const onlyCells = body.only_cells && body.only_cells.length
    ? body.only_cells
    : DAYS.reduce((acc, day) => acc.concat(SLOTS.map(slot => ({ day: day, slot: slot }))), []);
  const replaceWeek = !!body.replace_week;

  const items = readRows('Items').filter(it => it.meal_role !== '제외');
  const inventory = readRows('Inventory');
  const settings = readSettingsMap_();
  const compact = buildCompactItemLines_(items, inventory, TOP_ITEMS_LIMIT);

  const existingMeals = readRows('MealPlans').filter(m => m.week_start === weekStart);
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
  const meals = result.meals || [];
  if (meals.length !== onlyCells.length) {
    console.log('plan.generate 경고 — 요청 ' + onlyCells.length + '칸, 응답 ' + meals.length + '칸');
  }

  if (replaceWeek) {
    deleteRowsByMatch('MealPlans', { week_start: weekStart });
  }

  meals.forEach(m => {
    upsertByMatch('MealPlans', { week_start: weekStart, day: m.day, slot: m.slot }, {
      week_start: weekStart,
      day: m.day,
      slot: m.slot,
      menu: m.menu,
      uses: resolveUsesKeys_(m.uses, compact.keys).join(','),
      difficulty: m.difficulty,
      kind: '기본',
      status: '예정',
      rating: ''
    });
  });

  const savedMeals = readRows('MealPlans').filter(m => m.week_start === weekStart);
  const shopping = computeShoppingList_(savedMeals, readRows('Items'), inventory);

  return { meals: savedMeals.map(formatMealRow_), shopping: shopping };
}

function actionPlanLightOptions_() {
  const items = readRows('Items').filter(it => it.meal_role !== '제외');
  const inventory = readRows('Inventory');
  const compact = buildCompactItemLines_(items, inventory, TOP_ITEMS_LIMIT);

  const prompt = [
    '재고와 자주 사는 품목으로 다이어트용 가벼운 한 끼 후보 3개를 제안하라.',
    '[품목] (번호:이름(분류/보관)구매N회[/재고상태])',
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
  const meals = readRows('MealPlans').filter(m => m.week_start === weekStart);
  const shopping = computeShoppingList_(meals, items, inventory);

  return { meals: meals.map(formatMealRow_), shopping: shopping };
}

function resolveUsesKeys_(uses, keys) {
  return (uses || []).map(i => keys[i]).filter(Boolean);
}

function formatMealRow_(m) {
  return {
    day: m.day,
    slot: m.slot,
    menu: m.menu,
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
 * Items를 "번호:이름(분류/보관)구매N회[/재고상태]" 한 줄씩으로 압축한다.
 * 번호는 반환하는 keys 배열의 인덱스와 같고, Gemini가 uses에 이 번호를 넣으면 keys[번호]로 item_key를 되돌린다.
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
    return idx + ':' + it.name + '(' + it.category + '/' + it.storage + ')구매' + (it.purchase_count || 0) + '회' + stockTag;
  });

  return { lines: lines, keys: keys };
}

function buildPlanPrompt_(ctx) {
  const settings = ctx.settings;

  const lines = [
    ctx.weekStart + '부터 시작하는 주의 식단을 짜라.',
    '아래 칸만 짜서 meals에 그 칸들만 넣어라. 나머지 칸은 넣지 마라.',
    ctx.onlyCells.map(c => '- ' + c.day + ' ' + c.slot).join('\n'),
    '[품목] (번호:이름(분류/보관)구매N회[/재고상태])',
    ctx.itemLines.join('\n') || '(데이터 없음)',
    '[설정] 식구 수 ' + (settings.headcount || '4') + ', 끼니별 인원 ' + (settings.slot_headcount || ''),
    '[제외 음식] ' + (settings.exclude_foods || '없음'),
    '[규칙] ' + (settings.rules || ''),
    '재고 있음·조금 품목을 먼저 쓰되(없음은 빼고, 조금은 곁들임으로만), 재고 표시가 없으면 구매횟수 기준으로 골라라.',
    '같은 메인 메뉴는 3일 안에 반복하지 마라. 찌개류는 하루 한 번까지.',
    '아침은 유제품·유부초밥·샌드위치·과일 조합으로 가볍게 짜라.',
    '메뉴명은 짧게 써라(10자 이내 권장).',
    'uses는 위 [품목] 번호만 정수 배열로 넣어라. 재료가 필요 없으면 빈 배열.',
    '각 끼니에 난도(쉬움/보통/손 많이 감)를 붙여라.'
  ];

  if (ctx.otherMeals && ctx.otherMeals.length) {
    lines.push('이번 주 이미 정해진 다른 끼니(3일 내 반복 금지 참고용):');
    ctx.otherMeals.forEach(m => lines.push('- ' + m.day + ' ' + m.slot + ': ' + m.menu));
  }

  return lines.join('\n');
}
