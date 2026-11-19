/**
 * 생성된 21끼를 검사해 규칙 위반 칸을 찾는다. 위반 칸만 only_cells로 다시 생성 요청한다.
 * - 같은 메인 메뉴가 3일 안에 반복되면 위반
 * - 찌개류가 하루에 2번 이상이면 위반
 * - 식단역할이 '제외'인 품목을 쓰면 위반(items를 넘겼을 때만 검사)
 */
(function (global) {
  const DAY_INDEX = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };

  function isStew(menu) {
    return /찌개/.test(menu || '');
  }

  function checkRules(meals, items) {
    const itemMap = {};
    (items || []).forEach(it => { itemMap[it.item_key] = it; });

    const violations = [];

    for (let i = 0; i < meals.length; i++) {
      for (let j = i + 1; j < meals.length; j++) {
        const a = meals[i];
        const b = meals[j];
        if (a.menu !== b.menu) continue;
        const da = DAY_INDEX[a.day];
        const db = DAY_INDEX[b.day];
        if (da === undefined || db === undefined) continue;
        if (Math.abs(da - db) < 3) {
          violations.push({ day: b.day, slot: b.slot, reason: '3일 내 같은 메뉴 반복: ' + b.menu });
        }
      }
    }

    const stewCountByDay = {};
    meals.forEach(m => {
      if (isStew(m.menu)) {
        stewCountByDay[m.day] = (stewCountByDay[m.day] || 0) + 1;
      }
    });
    meals.forEach(m => {
      if (isStew(m.menu) && stewCountByDay[m.day] > 1) {
        violations.push({ day: m.day, slot: m.slot, reason: '찌개류가 하루에 2번 이상: ' + m.menu });
      }
    });

    meals.forEach(m => {
      (m.uses || []).forEach(key => {
        const item = itemMap[key];
        if (item && item.meal_role === '제외') {
          violations.push({ day: m.day, slot: m.slot, reason: '제외 품목 사용: ' + key });
        }
      });
    });

    return violations;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkRules, isStew };
  } else {
    global.checkRules = checkRules;
    global.isStew = isStew;
  }
})(typeof window !== 'undefined' ? window : globalThis);
