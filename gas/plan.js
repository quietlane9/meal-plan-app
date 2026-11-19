/**
 * 식단 생성(plan.generate)·조회(plan.list). docs/spec.md 3·4·7장 기준.
 * 요청당 Gemini 호출은 1회만: only_cells가 있으면 그 칸만 다시 짜서 MealPlans의 해당 행만 덮어쓴다.
 */
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOTS = ['아침', '점심', '저녁'];

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          slot: { type: 'string', enum: SLOTS },
          menu: { type: 'string' },
          uses: { type: 'array', items: { type: 'string' } },
          difficulty: { type: 'string', enum: ['쉬움', '보통', '손 많이 감'] },
          note: { type: 'string' }
        },
        required: ['day', 'slot', 'menu', 'difficulty']
      }
    },
    light_options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          menu: { type: 'string' },
          uses: { type: 'array', items: { type: 'string' } },
          difficulty: { type: 'string', enum: ['쉬움', '보통', '손 많이 감'] }
        },
        required: ['menu', 'difficulty']
      }
    },
    shopping: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['name']
      }
    }
  },
  required: ['meals', 'shopping']
};

function actionPlanGenerate_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');
  const onlyCells = body.only_cells && body.only_cells.length ? body.only_cells : null;

  const items = readRows('Items');
  const inventory = readRows('Inventory');
  const settings = readSettingsMap_();
  const existingMeals = onlyCells
    ? readRows('MealPlans').filter(m => m.week_start === weekStart)
    : [];

  const prompt = buildPlanPrompt_({ weekStart, items, inventory, settings, onlyCells, existingMeals });
  const result = callGeminiJson_([{ text: prompt }], PLAN_SCHEMA, 0.7);
  const meals = result.meals || [];

  if (onlyCells) {
    meals.forEach(m => {
      upsertByMatch('MealPlans', { week_start: weekStart, day: m.day, slot: m.slot }, {
        week_start: weekStart,
        day: m.day,
        slot: m.slot,
        menu: m.menu,
        uses: (m.uses || []).join(','),
        difficulty: m.difficulty,
        kind: '기본',
        status: '예정',
        rating: ''
      });
    });
  } else {
    deleteRowsByMatch('MealPlans', { week_start: weekStart });
    meals.forEach(m => {
      appendRow('MealPlans', {
        week_start: weekStart,
        day: m.day,
        slot: m.slot,
        menu: m.menu,
        uses: (m.uses || []).join(','),
        difficulty: m.difficulty,
        kind: '기본',
        status: '예정',
        rating: ''
      });
    });
  }

  const savedMeals = readRows('MealPlans').filter(m => m.week_start === weekStart);
  const shopping = computeShoppingList_(savedMeals, items, inventory, result.shopping || []);

  return {
    meals: savedMeals.map(formatMealRow_),
    light_options: result.light_options || [],
    shopping: shopping
  };
}

function actionPlanList_(body) {
  const weekStart = body.week_start;
  if (!weekStart) throw new Error('week_start가 필요합니다.');

  const items = readRows('Items');
  const inventory = readRows('Inventory');
  const meals = readRows('MealPlans').filter(m => m.week_start === weekStart);
  const shopping = computeShoppingList_(meals, items, inventory, []);

  return { meals: meals.map(formatMealRow_), shopping: shopping };
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

/**
 * 식단에 쓰인 재료(uses) 중 재고가 '있음'·'조금'이 아닌 것과,
 * Gemini가 직접 꼽은 shopping 항목을 합쳐 장보기 목록을 만든다.
 */
function computeShoppingList_(meals, items, inventory, geminiShopping) {
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

  geminiShopping.forEach(s => {
    const key = makeItemKey('', s.name, '');
    if (!key || shoppingMap.has(key)) return;
    shoppingMap.set(key, { item_key: key, name: s.name, reason: s.reason || '식단에 필요' });
  });

  return Array.from(shoppingMap.values());
}

function buildPlanPrompt_(ctx) {
  const items = ctx.items;
  const inventory = ctx.inventory;
  const settings = ctx.settings;

  const stockLines = inventory
    .filter(inv => inv.status === '있음' || inv.status === '조금')
    .map(inv => inv.item_key + '(' + inv.status + ')')
    .join(', ');

  const topItems = items
    .filter(it => it.meal_role !== '제외')
    .sort((a, b) => (Number(b.purchase_count) || 0) - (Number(a.purchase_count) || 0))
    .slice(0, 30)
    .map(it => it.item_key + '/' + it.name + '/구매 ' + (it.purchase_count || 0) + '회' + (it.preference ? '/선호 ' + it.preference : ''))
    .join('\n');

  const lines = [
    ctx.weekStart + '부터 7일간(월~일) 아침·점심·저녁 식단을 짜라.',
    '[재고] ' + (stockLines || '재고 정보 없음. 아래 자주 사는 품목과 취향만 기준으로 짜라.'),
    '[자주 사는 품목 구매횟수 상위 30개]',
    topItems || '(데이터 없음)',
    '[설정] 식구 수 ' + (settings.headcount || '4') + ', 끼니별 인원 ' + (settings.slot_headcount || ''),
    '[제외 음식] ' + (settings.exclude_foods || '없음'),
    '[규칙] ' + (settings.rules || ''),
    '재고의 있음·조금 품목을 먼저 쓰되(없음은 빼고, 조금은 곁들임으로만), 재고가 비어 있으면 구매횟수와 취향 상위 품목 위주로 짜라.',
    '같은 메인 메뉴는 3일 안에 반복하지 마라. 찌개류는 하루 한 번까지.',
    '아침은 유제품·유부초밥·샌드위치·과일 조합으로 가볍게 짜라.',
    "식단역할이 '제외'인 품목은 쓰지 마라.",
    '각 끼니에 난도(쉬움/보통/손 많이 감)를 붙여라.',
    '다이어트용 가벼운 한 끼 후보 3개를 light_options에 따로 제안하라.',
    '재고에 없는 재료는 shopping 목록에 넣어라.'
  ];

  if (ctx.onlyCells) {
    lines.push('--- 다시 짜기 ---');
    lines.push('아래 칸만 다시 짜서 meals에 그 칸들만 넣어라. 나머지 칸은 넣지 마라.');
    ctx.onlyCells.forEach(c => lines.push('- ' + c.day + ' ' + c.slot));

    const others = ctx.existingMeals.filter(m => !ctx.onlyCells.some(c => c.day === m.day && c.slot === m.slot));
    if (others.length) {
      lines.push('이번 주 이미 정해진 다른 끼니(3일 내 반복 금지 참고용):');
      others.forEach(m => lines.push('- ' + m.day + ' ' + m.slot + ': ' + m.menu));
    }
  }

  return lines.join('\n');
}
