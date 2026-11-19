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

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
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

function initPlanScreen() {
  const weekInput = document.getElementById('week-start');
  weekInput.value = getMondayDateString(new Date());

  document.getElementById('btn-generate-plan').addEventListener('click', () => {
    generatePlan(weekInput.value, null);
  });
}

async function generatePlan(weekStart, onlyCells) {
  const statusEl = document.getElementById('plan-status');
  statusEl.textContent = onlyCells ? '선택한 칸 다시 짜는 중...' : '식단 생성 중...';

  try {
    const result = await callApi('plan.generate', {
      week_start: weekStart,
      only_cells: onlyCells || undefined
    }, 170000);
    planMeals = result.meals || [];
    planShopping = result.shopping || [];
    renderPlanGrid(weekStart);
    renderPlanDetail();
    renderShoppingList();

    const violations = checkRules(planMeals, []);
    if (violations.length === 0) {
      statusEl.textContent = '완료: 21끼 생성, 규칙 위반 없음';
      return;
    }

    statusEl.textContent = `규칙 위반 ${violations.length}건 발견, 해당 칸만 다시 짜는 중...`;
    const retryCells = Array.from(
      new Map(violations.map(v => [v.day + v.slot, { day: v.day, slot: v.slot }])).values()
    );
    const retryResult = await callApi('plan.generate', { week_start: weekStart, only_cells: retryCells }, 170000);
    planMeals = retryResult.meals || [];
    planShopping = retryResult.shopping || [];
    renderPlanGrid(weekStart);
    renderPlanDetail();
    renderShoppingList();

    const remaining = checkRules(planMeals, []);
    statusEl.textContent = remaining.length
      ? `완료 (규칙 위반 ${remaining.length}건 남음)`
      : '완료: 21끼 생성, 규칙 위반 없음';
  } catch (err) {
    statusEl.textContent = '오류: ' + err.message;
  }
}

function renderPlanGrid(weekStart) {
  const grid = document.getElementById('plan-grid');
  const todayStr = new Date().toISOString().slice(0, 10);

  const dayDate = {};
  DAYS.forEach((day, idx) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + idx);
    dayDate[day] = date.toISOString().slice(0, 10);
  });

  let html = '<tr><th></th>' + DAYS.map(day => (
    `<th class="${dayDate[day] === todayStr ? 'today' : ''}">${day}</th>`
  )).join('') + '</tr>';

  SLOTS.forEach(slot => {
    html += `<tr><th>${slot}</th>`;
    DAYS.forEach(day => {
      const meal = planMeals.find(m => m.day === day && m.slot === slot);
      const cellClass = dayDate[day] === todayStr ? 'today' : '';
      if (meal) {
        html += `<td class="${cellClass}" data-day="${day}" data-slot="${slot}">
          <div class="menu">${escapeAttr(meal.menu)}</div>
          <span class="difficulty-badge" data-level="${escapeAttr(meal.difficulty)}">${escapeAttr(meal.difficulty)}</span>
        </td>`;
      } else {
        html += `<td class="${cellClass} empty" data-day="${day}" data-slot="${slot}">-</td>`;
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

  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="detail-header">${meal.day} ${meal.slot}</div>
    <div class="detail-menu">${escapeAttr(meal.menu)}</div>
    <div class="detail-meta">난도: ${escapeAttr(meal.difficulty)}</div>
    <div class="detail-meta">재료: ${(meal.uses || []).join(', ') || '없음'}</div>
    <button id="btn-regenerate-cell" class="btn-secondary">이 칸 다시 짜기</button>
  `;

  document.getElementById('btn-regenerate-cell').addEventListener('click', () => {
    const weekStart = document.getElementById('week-start').value;
    generatePlan(weekStart, [selectedCell]);
  });
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
    progress.textContent = '오류: ' + err.message;
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
      <span>묶음 ${f.idx + 1} 실패: ${escapeAttr(f.error)}</span>
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
initSettingsScreen();
