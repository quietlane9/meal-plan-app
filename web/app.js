/**
 * 탭 전환 + 업로드/검수/식단/설정 화면 동작. 재고 화면은 Stage 3에서 만든다.
 */
const BATCH_SIZE = 2;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOTS = ['아침', '점심', '저녁'];

let selectedFiles = [];
let reviewItems = []; // { ...추출필드, keep, mergeSelected }

let encodedBatches = []; // [[{mime,data}, ...], ...]
let batchStates = []; // [{ status: 'pending'|'loading'|'success'|'error', result?, error? }]

let planMeals = [];
let planShopping = [];
let selectedCell = null; // { day, slot }

/** 짧은 사용자 문구 + 자세히(접힌 원문)로 오류를 렌더링한다. */
function friendlySummary(message) {
  if (/503|high demand|과부하/i.test(message)) {
    return '모델이 붐벼요. 잠시 후 다시 시도해 주세요.';
  }
  if (/429|quota|rate limit/i.test(message)) {
    return '요청이 많아 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.';
  }
  if (/인증 실패/.test(message)) {
    return '토큰이 맞지 않아요. 설정 탭에서 확인해 주세요.';
  }
  if (/시간.*(초과|넘게)/.test(message)) {
    return '응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.';
  }
  return '오류가 발생했어요.';
}

function errorHtml(err) {
  return `${escapeAttr(friendlySummary(err.message))} <details><summary>자세히</summary>${escapeAttr(err.message)}</details>`;
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
      if (btn.dataset.screen === 'inventory') loadInventory();
    });
  });
}

async function initSettingsScreen() {
  const tokenInput = document.getElementById('token-input');
  tokenInput.value = getToken();

  document.getElementById('btn-save-token').addEventListener('click', () => {
    setToken(tokenInput.value.trim());
    alert('토큰을 저장했습니다.');
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  try {
    await loadSettings();
  } catch (err) {
    // 토큰이 아직 없을 때는 조용히 넘어간다.
  }
}

async function loadSettings() {
  const { settings } = await callApi('settings.get', {});
  document.getElementById('setting-headcount').value = settings.headcount || '';

  let slotHeadcount = {};
  try {
    slotHeadcount = JSON.parse(settings.slot_headcount || '{}');
  } catch (err) {
    slotHeadcount = {};
  }
  const weekday = slotHeadcount.weekday || {};
  const weekend = slotHeadcount.weekend || {};
  document.getElementById('setting-weekday-breakfast').value = weekday['아침'] ?? '';
  document.getElementById('setting-weekday-lunch').value = weekday['점심'] ?? '';
  document.getElementById('setting-weekday-dinner').value = weekday['저녁'] ?? '';
  document.getElementById('setting-weekend-breakfast').value = weekend['아침'] ?? '';
  document.getElementById('setting-weekend-lunch').value = weekend['점심'] ?? '';
  document.getElementById('setting-weekend-dinner').value = weekend['저녁'] ?? '';

  document.getElementById('setting-exclude').value = settings.exclude_foods || '';

  let rules = [];
  try {
    rules = JSON.parse(settings.rules || '[]');
  } catch (err) {
    rules = [];
  }
  document.getElementById('setting-rules').value = rules.join('\n');
}

async function saveSettings() {
  const resultEl = document.getElementById('settings-save-result');
  resultEl.textContent = '저장 중...';

  const slotHeadcount = {
    weekday: {
      '아침': Number(document.getElementById('setting-weekday-breakfast').value) || 0,
      '점심': Number(document.getElementById('setting-weekday-lunch').value) || 0,
      '저녁': Number(document.getElementById('setting-weekday-dinner').value) || 0
    },
    weekend: {
      '아침': Number(document.getElementById('setting-weekend-breakfast').value) || 0,
      '점심': Number(document.getElementById('setting-weekend-lunch').value) || 0,
      '저녁': Number(document.getElementById('setting-weekend-dinner').value) || 0
    }
  };

  const rules = document.getElementById('setting-rules').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  try {
    await Promise.all([
      callApi('settings.set', { key: 'headcount', value: document.getElementById('setting-headcount').value }),
      callApi('settings.set', { key: 'slot_headcount', value: JSON.stringify(slotHeadcount) }),
      callApi('settings.set', { key: 'exclude_foods', value: document.getElementById('setting-exclude').value }),
      callApi('settings.set', { key: 'rules', value: JSON.stringify(rules) })
    ]);
    resultEl.textContent = '설정을 저장했습니다.';
  } catch (err) {
    resultEl.textContent = '오류: ' + err.message;
  }
}

function getMondayDateString(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const PLAN_CALL_TIMEOUT_MS = 90000; // gas/gemini.js의 전체 시간 상한(90초)과 맞춤
const CELL_CHUNK_SIZE = 12; // 한 번의 plan.generate 호출에 넣는 최대 칸 수

function cellsForDays(days) {
  const cells = [];
  days.forEach(day => SLOTS.forEach(slot => cells.push({ day, slot })));
  return cells;
}

function allCells() {
  return cellsForDays(DAYS);
}

function computeDayDates(weekStart) {
  const map = {};
  DAYS.forEach((day, idx) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + idx);
    map[day] = date.toISOString().slice(0, 10);
  });
  return map;
}

function hasExistingPlan() {
  return planMeals.some(m => m.menu);
}

function updateGenerateButtonLabel() {
  document.getElementById('btn-generate-plan').textContent = hasExistingPlan() ? '새로 만들기' : '이번 주 식단 만들기';
}

/** 실제로 몇 칸이 채워졌는지 확인하고 요약한다. checkRules가 빈 식단도 "위반 없음"으로 보길래, 채움 여부를 직접 센다. */
function describePlanStatus(meals) {
  const filled = allCells().filter(c => meals.some(m => m.day === c.day && m.slot === c.slot && m.menu)).length;
  if (filled < 21) {
    return `${filled}/21끼만 채워졌습니다. 다시 시도하거나 빈 칸을 눌러 다시 짜 보세요.`;
  }
  const violations = checkRules(meals, []);
  return violations.length
    ? `완료 (규칙 위반 ${violations.length}건 남음)`
    : '완료: 21끼 생성, 규칙 위반 없음';
}

function initPlanScreen() {
  const weekInput = document.getElementById('week-start');
  weekInput.value = getMondayDateString(new Date());

  weekInput.addEventListener('change', () => loadPlanForWeek(weekInput.value));
  document.getElementById('btn-generate-plan').addEventListener('click', () => onGenerateClick(weekInput.value));
  document.getElementById('btn-light-options').addEventListener('click', loadLightOptions);

  loadPlanForWeek(weekInput.value);
}

/** 탭을 열거나 주를 바꾸면 먼저 저장된 식단을 불러와 표에 보여준다. */
async function loadPlanForWeek(weekStart) {
  const statusEl = document.getElementById('plan-status');
  statusEl.textContent = '불러오는 중...';

  try {
    const result = await callApi('plan.list', { week_start: weekStart });
    planMeals = result.meals || [];
    planShopping = result.shopping || [];
    renderPlanGrid(weekStart);
    renderPlanDetail();
    renderShoppingList();
    updateGenerateButtonLabel();
    statusEl.textContent = hasExistingPlan() ? describePlanStatus(planMeals) : '';
  } catch (err) {
    statusEl.innerHTML = errorHtml(err);
  }
}

/**
 * 메인 버튼 클릭. 이미 식단이 있으면("새로 만들기") 확인을 받고, '오늘 이후만 다시 짜기'가
 * 켜져 있으면 지난 날과 먹음·외식 칸은 대상에서 뺀다. 처음 만들 때는 항상 21칸 전체를 만든다.
 */
async function onGenerateClick(weekStart) {
  const existing = hasExistingPlan();
  if (existing) {
    const ok = confirm('기존 식단을 새로 만든 식단으로 바꿀까요?');
    if (!ok) return;
  }

  const onlyFuture = existing && document.getElementById('opt-only-future').checked;
  const dayDates = computeDayDates(weekStart);
  const todayStr = new Date().toISOString().slice(0, 10);

  const targetCells = allCells().filter(c => {
    if (!onlyFuture) return true;
    const existingMeal = planMeals.find(m => m.day === c.day && m.slot === c.slot);
    if (existingMeal && (existingMeal.status === '먹음' || existingMeal.status === '외식')) return false;
    return dayDates[c.day] >= todayStr;
  });

  if (targetCells.length === 0) {
    alert('이 주는 "오늘 이후" 칸이 없어서 다시 짤 게 없습니다. 체크를 해제하거나 다른 주를 선택해 주세요.');
    return;
  }

  await generatePlan(weekStart, targetCells);
}

/**
 * targetCells만 Gemini로 미리 생성(저장 안 함) → 규칙 위반 칸만 한 번 더 생성 → 전부 모은 뒤에만
 * plan.commit으로 저장한다. 생성 중 하나라도 실패하면 아무것도 저장하지 않아 기존 식단이 그대로 남는다.
 */
async function generatePlan(weekStart, targetCells) {
  const statusEl = document.getElementById('plan-status');

  try {
    const generated = [];
    const chunks = chunk(targetCells, CELL_CHUNK_SIZE);

    for (let i = 0; i < chunks.length; i++) {
      statusEl.textContent = chunks.length > 1 ? `식단 생성 중... (${i + 1}/${chunks.length})` : '식단 생성 중...';
      const result = await callApi('plan.generate', {
        week_start: weekStart,
        only_cells: chunks[i]
      }, PLAN_CALL_TIMEOUT_MS);
      generated.push(...(result.meals || []));
    }

    // 3일 내 반복 등을 제대로 잡으려면, 그대로 둘 기존 칸까지 합쳐서 검사해야 한다.
    const untouchedMeals = planMeals.filter(m => !targetCells.some(c => c.day === m.day && c.slot === m.slot));
    const combined = untouchedMeals.concat(generated);
    const violations = checkRules(combined, []).filter(v => targetCells.some(c => c.day === v.day && c.slot === v.slot));

    if (violations.length) {
      statusEl.textContent = `규칙 위반 ${violations.length}건 발견, 해당 칸만 다시 짜는 중...`;
      const retryCells = Array.from(
        new Map(violations.map(v => [v.day + v.slot, { day: v.day, slot: v.slot }])).values()
      );
      const retryResult = await callApi('plan.generate', { week_start: weekStart, only_cells: retryCells }, PLAN_CALL_TIMEOUT_MS);
      (retryResult.meals || []).forEach(rm => {
        const idx = generated.findIndex(g => g.day === rm.day && g.slot === rm.slot);
        if (idx !== -1) generated[idx] = rm; else generated.push(rm);
      });
    }

    statusEl.textContent = '저장 중...';
    const commitResult = await callApi('plan.commit', {
      week_start: weekStart,
      meals: generated,
      target_cells: targetCells
    }, PLAN_CALL_TIMEOUT_MS);

    planMeals = commitResult.meals || [];
    planShopping = commitResult.shopping || [];
    renderPlanGrid(weekStart);
    renderPlanDetail();
    renderShoppingList();
    updateGenerateButtonLabel();
    statusEl.textContent = describePlanStatus(planMeals);
  } catch (err) {
    // 저장(plan.commit) 전에 실패했으므로 planMeals·시트 모두 그대로다. 오류만 보여준다.
    statusEl.innerHTML = errorHtml(err);
  }
}

async function loadLightOptions() {
  const container = document.getElementById('light-options');
  container.innerHTML = '<p class="muted">불러오는 중...</p>';

  try {
    const result = await callApi('plan.lightOptions', {}, PLAN_CALL_TIMEOUT_MS);
    const options = result.light_options || [];

    container.innerHTML = options.length
      ? options.map(o => `
        <div class="light-option">
          <span class="light-menu">${escapeAttr(o.menu)}</span>
          <span class="difficulty-badge" data-level="${escapeAttr(o.difficulty)}">${escapeAttr(o.difficulty)}</span>
        </div>
      `).join('')
      : '<p class="muted">추천 결과가 없습니다.</p>';
  } catch (err) {
    container.innerHTML = `<p class="muted">${errorHtml(err)}</p>`;
  }
}

/**
 * 요일을 행, 끼니를 열로 둔다(요일을 열로 두면 모바일 폭에 8칸이 들어가야 해서 가로 스크롤이
 * 생기고 하단 탭바까지 같이 늘어나 버렸다 — 3칸(아침/점심/저녁)이면 좁은 화면에도 맞는다).
 */
/** 저장값(status)은 spec의 예정/먹음/바뀜/외식 그대로 두고, 화면 표시만 자연스럽게 바꾼다. */
function statusLabel(status) {
  return status === '먹음' ? '먹었음' : status;
}

function renderPlanGrid(weekStart) {
  const grid = document.getElementById('plan-grid');
  const todayStr = new Date().toISOString().slice(0, 10);
  const dayDate = computeDayDates(weekStart);

  let html = '<tr><th></th>' + SLOTS.map(slot => `<th>${slot}</th>`).join('') + '</tr>';

  DAYS.forEach(day => {
    const rowClass = dayDate[day] === todayStr ? 'today' : '';
    html += `<tr><th class="${rowClass}">${day}</th>`;
    SLOTS.forEach(slot => {
      const meal = planMeals.find(m => m.day === day && m.slot === slot);
      if (meal) {
        const statusTag = meal.status && meal.status !== '예정'
          ? `<span class="grid-status-tag">${escapeAttr(statusLabel(meal.status))}</span>`
          : '';
        const sidesText = (meal.sides || []).length ? `<div class="sides">+ ${escapeAttr(meal.sides.join(', '))}</div>` : '';
        html += `<td class="${rowClass}" data-day="${day}" data-slot="${slot}">
          <div class="menu">${escapeAttr(meal.menu)}</div>
          ${sidesText}
          <span class="difficulty-badge" data-level="${escapeAttr(meal.difficulty)}">${escapeAttr(meal.difficulty)}</span>
          ${statusTag}
        </td>`;
      } else {
        html += `<td class="${rowClass} empty" data-day="${day}" data-slot="${slot}">-</td>`;
      }
    });
    html += '</tr>';
  });

  grid.innerHTML = html;

  grid.querySelectorAll('td[data-day]').forEach(td => {
    td.addEventListener('click', () => {
      selectedCell = { day: td.dataset.day, slot: td.dataset.slot };
      renderPlanDetail();
    });
  });
}

function renderPlanDetail() {
  const detail = document.getElementById('plan-detail');
  const meal = selectedCell
    ? planMeals.find(m => m.day === selectedCell.day && m.slot === selectedCell.slot)
    : null;

  if (!meal) {
    detail.classList.add('hidden');
    return;
  }

  const statusTag = meal.status && meal.status !== '예정'
    ? `<span class="status-tag">${escapeAttr(statusLabel(meal.status))}</span>`
    : '';

  const sidesLine = (meal.sides || []).length
    ? `<div class="detail-meta">반찬: ${escapeAttr(meal.sides.join(', '))}</div>`
    : '';

  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="detail-header">${meal.day} ${meal.slot}${statusTag}</div>
    <div class="detail-menu">${escapeAttr(meal.menu)}</div>
    ${sidesLine}
    <div class="detail-meta">난도: ${escapeAttr(meal.difficulty)}</div>
    <div class="detail-meta">재료: ${(meal.uses || []).join(', ') || '없음'}</div>
    <div class="detail-actions">
      <button class="btn-secondary" data-action="먹음">먹었음</button>
      <button class="btn-secondary" data-action="외식">외식</button>
      <button id="btn-regenerate-cell" class="btn-secondary">바꾸기</button>
    </div>
    <div class="detail-actions">
      <button class="btn-secondary" data-rating="좋아요">좋아요</button>
      <button class="btn-secondary" data-rating="싫어요">싫어요</button>
    </div>
    <div id="reason-chips" class="reason-chips hidden"></div>
  `;

  detail.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => updateMealStatus(selectedCell, btn.dataset.action));
  });
  detail.querySelector('[data-rating="좋아요"]').addEventListener('click', () => updateMealRating(selectedCell, '좋아요', ''));
  detail.querySelector('[data-rating="싫어요"]').addEventListener('click', () => showReasonChips(selectedCell));

  document.getElementById('btn-regenerate-cell').addEventListener('click', () => {
    const weekStart = document.getElementById('week-start').value;
    generatePlan(weekStart, [selectedCell]);
  });
}

function showReasonChips(cell) {
  const container = document.getElementById('reason-chips');
  const reasons = ['맛없음', '양 적음', '질림', '손 많이 감'];
  container.classList.remove('hidden');
  container.innerHTML = reasons.map(r => `<button class="chip" data-reason="${r}">${r}</button>`).join('');
  container.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => updateMealRating(cell, '싫어요', btn.dataset.reason));
  });
}

async function updateMealStatus(cell, status) {
  const weekStart = document.getElementById('week-start').value;
  try {
    await callApi('meal.update', { week_start: weekStart, day: cell.day, slot: cell.slot, status: status });
    applyLocalMealUpdate(cell, { status: status });
    renderPlanGrid(weekStart);
    renderPlanDetail();
  } catch (err) {
    alert(friendlySummary(err.message));
  }
}

async function updateMealRating(cell, rating, reason) {
  const weekStart = document.getElementById('week-start').value;
  try {
    await callApi('meal.update', { week_start: weekStart, day: cell.day, slot: cell.slot, rating: rating, reason: reason });
    applyLocalMealUpdate(cell, { rating: rating });
    renderPlanDetail();
  } catch (err) {
    alert(friendlySummary(err.message));
  }
}

function applyLocalMealUpdate(cell, patch) {
  const meal = planMeals.find(m => m.day === cell.day && m.slot === cell.slot);
  if (meal) Object.assign(meal, patch);
}

let inventoryRows = [];
let currentStorageTab = '냉장';

function initInventoryScreen() {
  document.querySelectorAll('.storage-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.storage-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStorageTab = btn.dataset.storage;
      renderInventoryList();
    });
  });
}

async function loadInventory() {
  const list = document.getElementById('inventory-list');
  try {
    const result = await callApi('inventory.list', {});
    inventoryRows = result.rows || [];
    renderInventoryList();
  } catch (err) {
    list.innerHTML = `<p class="muted">${errorHtml(err)}</p>`;
  }
}

/** 소비기한(추정)이 임박한 순서로 보여준다. 재고가 '없음'인 품목은 서버에서 이미 빠져 있다. */
function renderInventoryList() {
  const list = document.getElementById('inventory-list');
  const rows = inventoryRows.filter(r => r.storage === currentStorageTab);

  if (rows.length === 0) {
    list.innerHTML = '<p class="muted">없음</p>';
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  list.innerHTML = rows.map((r, idx) => {
    const dday = r.expected_until
      ? Math.round((new Date(r.expected_until) - new Date(todayStr)) / 86400000)
      : null;
    const ddayText = dday === null
      ? '소비기한 정보 없음'
      : (dday >= 0 ? `D-${dday}(추정)` : '소비기한 지남(추정)');

    return `
      <div class="inventory-item" data-idx="${idx}">
        <div class="inventory-name">${escapeAttr(r.name)}</div>
        <div class="inventory-meta">
          <span class="status-badge" data-status="${escapeAttr(r.status)}">${escapeAttr(r.status)}</span>
          <span>구매일 ${escapeAttr(r.bought_at || '-')}</span>
          <span>${ddayText}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.inventory-item').forEach(el => {
    el.addEventListener('click', () => cycleInventoryStatus(rows[Number(el.dataset.idx)]));
  });
}

/** 누를 때마다 있음→조금→없음. '없음'이 되면 다음 불러올 때 목록에서 빠진다. */
async function cycleInventoryStatus(row) {
  const next = row.status === '있음' ? '조금' : '없음';
  try {
    await callApi('inventory.set', { item_key: row.item_key, status: next });
    await loadInventory();
  } catch (err) {
    alert(friendlySummary(err.message));
  }
}

function renderShoppingList() {
  const list = document.getElementById('shopping-list');

  if (planShopping.length === 0) {
    list.innerHTML = '<p class="muted">장보기 목록이 없습니다.</p>';
    return;
  }

  list.innerHTML = planShopping.map((s, idx) => `
    <div class="shopping-item">
      <span class="shopping-name">${escapeAttr(s.name)}</span>
      <a class="ssg-link" href="https://www.ssg.com/search.ssg?query=${encodeURIComponent(s.name)}" target="_blank" rel="noopener">SSG 검색</a>
      <button class="btn-have" data-idx="${idx}">집에 있음</button>
    </div>
  `).join('');

  list.querySelectorAll('.btn-have').forEach(btn => {
    btn.addEventListener('click', () => markHaveAtHome(Number(btn.dataset.idx)));
  });
}

async function markHaveAtHome(idx) {
  const item = planShopping[idx];
  if (!item) return;

  try {
    await callApi('inventory.set', { item_key: item.item_key, status: '있음' });
    planShopping = planShopping.filter((_, i) => i !== idx);
    renderShoppingList();
  } catch (err) {
    alert('오류: ' + err.message);
  }
}

function initUploadScreen() {
  const fileInput = document.getElementById('file-input');
  const fileSummary = document.getElementById('file-summary');
  const extractBtn = document.getElementById('btn-extract');

  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files);
    fileSummary.textContent = selectedFiles.length
      ? `선택한 이미지 ${selectedFiles.length}장`
      : '';
    extractBtn.disabled = selectedFiles.length === 0;
    reviewItems = [];
    renderReviewList();
  });

  extractBtn.addEventListener('click', startExtraction);

  document.getElementById('btn-merge-selected').addEventListener('click', mergeSelectedCards);
  document.getElementById('btn-save').addEventListener('click', saveReviewedItems);
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function startExtraction() {
  const progress = document.getElementById('progress');
  const extractBtn = document.getElementById('btn-extract');

  extractBtn.disabled = true;
  progress.textContent = '이미지 줄이는 중...';

  try {
    const encoded = await Promise.all(
      selectedFiles.map(async file => ({
        mime: 'image/jpeg',
        data: await resizeImageToJpegBase64(file)
      }))
    );

    encodedBatches = chunk(encoded, BATCH_SIZE);
    batchStates = encodedBatches.map(() => ({ status: 'pending' }));

    await runBatches(encodedBatches.map((_, i) => i));
  } catch (err) {
    progress.innerHTML = errorHtml(err);
  } finally {
    extractBtn.disabled = selectedFiles.length === 0;
  }
}

/** indices에 해당하는 묶음만 (다시) 호출한다. 실패한 묶음만 골라 재시도할 때도 이 함수를 쓴다. */
async function runBatches(indices) {
  const uploadType = document.getElementById('upload-type').value;

  for (const idx of indices) {
    batchStates[idx] = { status: 'loading' };
    renderBatchStatus();

    try {
      const result = await callApi('extract', { upload_type: uploadType, images: encodedBatches[idx] });
      batchStates[idx] = { status: 'success', result };
    } catch (err) {
      batchStates[idx] = { status: 'error', error: err.message };
    }

    renderBatchStatus();
    updateReviewFromBatches();
  }
}

function renderBatchStatus() {
  const progress = document.getElementById('progress');
  const total = batchStates.length;
  const done = batchStates.filter(b => b.status === 'success').length;
  const failed = batchStates
    .map((b, idx) => Object.assign({ idx }, b))
    .filter(b => b.status === 'error');

  progress.textContent = failed.length
    ? `진행: ${done}/${total}개 묶음 완료, 실패 ${failed.length}개`
    : `진행: ${done}/${total}개 묶음 완료`;

  renderFailedBatches(failed);
}

function renderFailedBatches(failed) {
  const container = document.getElementById('failed-batches');

  if (failed.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = failed.map(f => `
    <div class="failed-batch">
      <span>묶음 ${f.idx + 1} 실패: ${friendlySummary(f.error)} <details><summary>자세히</summary>${escapeAttr(f.error)}</details></span>
      <button class="btn-secondary btn-retry-batch" data-idx="${f.idx}">다시 시도</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-retry-batch').forEach(btn => {
    btn.addEventListener('click', () => runBatches([Number(btn.dataset.idx)]));
  });
}

/** 지금까지 성공한 묶음들만 모아 검수 목록을 다시 계산한다. 아직 실패/대기 중인 묶음은 빠진다. */
function updateReviewFromBatches() {
  const successResults = batchStates.filter(b => b.status === 'success').map(b => b.result);
  const merged = mergeExtractedItems(successResults);
  reviewItems = merged.map(item => Object.assign({ keep: true, mergeSelected: false }, item));
  renderReviewList();
}

function renderReviewList() {
  const list = document.getElementById('review-list');
  const actions = document.getElementById('review-actions');
  list.innerHTML = '';

  if (reviewItems.length === 0) {
    actions.classList.add('hidden');
    return;
  }
  actions.classList.remove('hidden');

  reviewItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'review-card' + ((item.confidence || 0) < 0.7 ? ' low-confidence' : '');

    card.innerHTML = `
      <div class="row">
        <input type="text" data-field="brand" placeholder="브랜드" value="${escapeAttr(item.brand)}" />
        <input type="text" data-field="name" placeholder="상품명" value="${escapeAttr(item.name)}" />
      </div>
      <div class="row">
        <input type="text" data-field="size" placeholder="용량" value="${escapeAttr(item.size)}" />
        <input type="number" data-field="price" placeholder="가격" value="${item.price ?? ''}" />
        <input type="number" data-field="purchase_count" placeholder="구매횟수" value="${item.purchase_count ?? ''}" />
      </div>
      <div class="row">
        <input type="text" data-field="category" placeholder="분류" value="${escapeAttr(item.category)}" />
        <select data-field="storage">
          ${['냉장', '냉동', '실온'].map(v => `<option value="${v}" ${item.storage === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select data-field="meal_role">
          ${['메인', '반찬', '아침', '간식', '음료', '제외'].map(v => `<option value="${v}" ${item.meal_role === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="meta">
        <span>confidence ${(item.confidence ?? 0).toFixed(2)} · item_key: ${makeItemKey(item.brand, item.name, item.size)}</span>
      </div>
      <div class="flags">
        <label><input type="checkbox" data-flag="keep" ${item.keep ? 'checked' : ''} /> 포함</label>
        <label><input type="checkbox" data-flag="mergeSelected" ${item.mergeSelected ? 'checked' : ''} /> 병합 선택</label>
      </div>
    `;

    card.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        reviewItems[idx][el.dataset.field] = el.type === 'number' ? Number(el.value) : el.value;
      });
    });
    card.querySelectorAll('[data-flag]').forEach(el => {
      el.addEventListener('change', () => {
        reviewItems[idx][el.dataset.flag] = el.checked;
      });
    });

    list.appendChild(card);
  });
}

function escapeAttr(value) {
  return (value ?? '').toString().replace(/"/g, '&quot;');
}

/** '병합 선택'으로 체크된 카드들을 하나로 합친다. 첫 번째 카드를 기준으로 구매횟수는 최댓값을 쓴다. */
function mergeSelectedCards() {
  const selectedIdx = reviewItems
    .map((item, idx) => (item.mergeSelected ? idx : -1))
    .filter(idx => idx !== -1);

  if (selectedIdx.length < 2) {
    alert('병합할 품목을 2개 이상 선택하세요.');
    return;
  }

  const selected = selectedIdx.map(idx => reviewItems[idx]);
  const base = selected[0];
  base.purchase_count = Math.max(...selected.map(i => i.purchase_count || 0));
  base.mergeSelected = false;

  reviewItems = reviewItems.filter((_, idx) => !selectedIdx.slice(1).includes(idx));
  renderReviewList();
}

async function saveReviewedItems() {
  const resultEl = document.getElementById('save-result');
  const uploadType = document.getElementById('upload-type').value;
  const itemsToSave = reviewItems
    .filter(item => item.keep)
    .map(({ keep, mergeSelected, ...rest }) => rest);

  if (itemsToSave.length === 0) {
    alert('포함된 품목이 없습니다.');
    return;
  }

  resultEl.textContent = '저장 중...';
  try {
    const result = await callApi('save', { upload_type: uploadType, items: itemsToSave });
    resultEl.textContent = `저장 완료: 신규 ${result.saved}개, 갱신 ${result.updated}개`;
  } catch (err) {
    resultEl.textContent = '오류: ' + err.message;
  }
}

initTabs();
initPlanScreen();
initUploadScreen();
initInventoryScreen();
initSettingsScreen();
