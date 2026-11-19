/**
 * 탭 전환 + 업로드/검수 화면 동작. 이번 단계(Stage 1)는 식단·재고 화면은 자리만 있다.
 */
const BATCH_SIZE = 4;

let selectedFiles = [];
let reviewItems = []; // { ...추출필드, keep, mergeSelected }

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

function initSettingsScreen() {
  const tokenInput = document.getElementById('token-input');
  tokenInput.value = getToken();

  document.getElementById('btn-save-token').addEventListener('click', () => {
    setToken(tokenInput.value.trim());
    alert('토큰을 저장했습니다.');
  });
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
  const uploadType = document.getElementById('upload-type').value;

  extractBtn.disabled = true;
  progress.textContent = '이미지 줄이는 중...';

  try {
    const encoded = await Promise.all(
      selectedFiles.map(async file => ({
        mime: 'image/jpeg',
        data: await resizeImageToJpegBase64(file)
      }))
    );

    const batches = chunk(encoded, BATCH_SIZE);
    const batchResults = [];

    for (let i = 0; i < batches.length; i++) {
      progress.textContent = `추출 중... (${i + 1}/${batches.length} 묶음)`;
      const result = await callApi('extract', { upload_type: uploadType, images: batches[i] });
      batchResults.push(result);
    }

    const merged = mergeExtractedItems(batchResults);
    reviewItems = merged.map(item => Object.assign({ keep: true, mergeSelected: false }, item));

    progress.textContent = `완료: ${reviewItems.length}개 품목 추출`;
    renderReviewList();
  } catch (err) {
    progress.textContent = '오류: ' + err.message;
  } finally {
    extractBtn.disabled = selectedFiles.length === 0;
  }
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
initUploadScreen();
initSettingsScreen();
