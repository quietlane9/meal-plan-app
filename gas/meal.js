/**
 * 식단 칸 상태 변경(먹음/바꿈/외식)과 평가(좋아요/싫어요 + 이유). plan.js의 DAYS·
 * dedupeLatestByDaySlot_과 inventory.js의 actionInventorySet_을 그대로 쓴다.
 * - status가 '먹음'이면 그 칸이 쓴 재료(uses)의 재고를 한 단계씩 내린다(있음→조금→없음).
 * - rating(좋아요/싫어요)이 오면 Feedback에 한 줄 남긴다(reason은 선택).
 */
function actionMealUpdate_(body) {
  const weekStart = body.week_start;
  const day = body.day;
  const slot = body.slot;
  if (!weekStart || !day || !slot) throw new Error('week_start, day, slot이 필요합니다.');

  const meals = dedupeLatestByDaySlot_(readRows('MealPlans').filter(m => m.week_start === weekStart));
  const meal = meals.find(m => m.day === day && m.slot === slot);
  if (!meal) throw new Error('해당 칸의 식단을 찾을 수 없습니다.');

  const update = {};
  if (body.status) update.status = body.status;
  if (body.rating) update.rating = body.rating;

  if (Object.keys(update).length) {
    upsertByMatch('MealPlans', { week_start: weekStart, day: day, slot: slot }, update);
  }

  if (body.status === '먹음') {
    const uses = meal.uses ? String(meal.uses).split(',').filter(Boolean) : [];
    uses.forEach(stepDownInventory_);
  }

  if (body.rating === '좋아요' || body.rating === '싫어요') {
    const settings = readSettingsMap_();
    appendRow('Feedback', {
      date: dateForDay_(weekStart, day),
      slot: slot,
      menu: meal.menu,
      rating: body.rating,
      reason: body.reason || '',
      headcount: settings.headcount || ''
    });
  }

  return { ok: true };
}

/** 있음→조금, 조금→없음. Inventory에 그 품목 행이 없으면 아무것도 안 한다. */
function stepDownInventory_(itemKey) {
  const invRow = readRows('Inventory').find(r => r.item_key === itemKey);
  if (!invRow) return;

  const next = invRow.status === '있음' ? '조금' : (invRow.status === '조금' ? '없음' : null);
  if (!next) return;

  actionInventorySet_({ item_key: itemKey, status: next });
}

function dateForDay_(weekStart, day) {
  const idx = DAYS.indexOf(day);
  if (idx === -1) return weekStart;
  const d = new Date(weekStart);
  d.setDate(d.getDate() + idx);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}
