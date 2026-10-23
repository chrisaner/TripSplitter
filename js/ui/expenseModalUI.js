import { expenseAllocation, money, decimals } from '../core/ledger.js?v=20261023-travel1';
import { state } from '../state.js?v=20261023-travel1';
import { getExpenseDraft } from '../state/modalStore.js?v=20261023-travel1';
import { escapeHtml, getLocalISOString, getDeviceTimeZoneLabel } from '../utils.js?v=20261023-travel1';

export function renderExpenseModal() {
  const draft = getExpenseDraft();

  const modalTitle = document.getElementById('exp-modal-title');
  const amountInput = document.getElementById('exp-amount');
  const titleInput = document.getElementById('exp-title');
  const currencySelect = document.getElementById('exp-currency');
  const timeInput = document.getElementById('exp-time');
  const deleteBtn = document.getElementById('delete-exp-btn');
  const receiptContainer = document.getElementById('receipt-preview-container');
  const receiptImage = document.getElementById('receipt-image');

  if (modalTitle) {
    modalTitle.innerText = draft.id ? '編輯支出' : '新增支出';
  }

  if (amountInput) amountInput.value = draft.amount ?? '';
  if (titleInput) titleInput.value = draft.title ?? '';
  if (currencySelect) currencySelect.value = draft.currency || 'TWD';
  
  // Keep recorded times when editing; new drafts use the device's current local time.
  if (timeInput) timeInput.value = draft.time || getLocalISOString();
  const timeHint = document.getElementById('expense-time-hint');
  if (timeHint) timeHint.textContent = draft.id ? '編輯保留原記帳時間；可自行調整。' : `使用裝置當地時間：${getDeviceTimeZoneLabel()}`;

  if (deleteBtn) {
    deleteBtn.classList.toggle('hidden', !draft.id);
  }

  if (receiptContainer) {
    receiptContainer.style.display = draft.receipt ? 'block' : 'none';
  }

  if (receiptImage && draft.receipt) {
    receiptImage.src = draft.receipt;
  }

  renderExpenseCategories();
  renderExpenseSelectors();
  renderExpenseOCR();
  renderFlexibleFields();
}

export function renderExpenseCategories() {
  const draft = getExpenseDraft();

  const mainCats = document.getElementById('main-cats');
  const subCats = document.getElementById('sub-cats');

  if (mainCats) {
    mainCats.innerHTML = Object.entries(state.categories).map(([key, item]) => `
      <button
        data-action="draft-select-cat"
        data-cat-key="${key}"
        class="category-btn flex-shrink-0 w-16 h-16 bg-gray-50 rounded-[1.5rem] flex flex-col items-center justify-center transition-all ${draft.cat === key ? 'active' : ''}"
      >
        <span class="text-2xl">${item.icon}</span>
        <span class="text-[9px] font-black mt-1">${item.label}</span>
      </button>
    `).join('');
  }

  if (subCats) {
    const subs = state.categories[draft.cat]?.subs || [];
    subCats.innerHTML = subs.map((sub) => `
      <button
        data-action="draft-select-sub"
        data-sub="${escapeHtml(sub)}"
        class="sub-btn px-4 py-2 bg-gray-50 rounded-xl text-[10px] font-black text-gray-400 ${draft.sub === sub ? 'active' : ''}"
      >
        ${escapeHtml(sub)}
      </button>
    `).join('');
  }
}

export function renderExpenseSelectors() {
  const draft = getExpenseDraft();

  const payerContainer = document.getElementById('payer-scroll');
  const splitContainer = document.getElementById('split-scroll');

  if (payerContainer) {
    let html = `
      <div
        data-action="draft-set-payer"
        data-payer-id="pool"
        class="avatar-card flex-shrink-0 w-16 h-20 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer bg-gray-50 ${draft.payer === 'pool' ? 'selected' : ''}"
      >
        <span class="text-xl">💰</span>
        <span class="text-[8px] font-black uppercase">Pool</span>
      </div>
    `;

    html += state.members.filter(m => !m.archived || draft.payer === m.id).map((m) => `
      <div
        data-action="draft-set-payer"
        data-payer-id="${m.id}"
        class="avatar-card flex-shrink-0 w-16 h-20 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer bg-gray-50 ${draft.payer === m.id ? 'selected' : ''}"
      >
        <span class="text-xl">${escapeHtml(m.emoji)}</span>
        <span class="text-[8px] font-black">${escapeHtml(m.name)}</span>
      </div>
    `).join('');

    payerContainer.innerHTML = html;
  }

  if (splitContainer) {
    splitContainer.innerHTML = state.members.filter(m => !m.archived || draft.split.includes(m.id)).map((m) => `
      <div
        data-action="draft-toggle-split"
        data-member-id="${m.id}"
        class="avatar-card relative w-16 h-20 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer bg-gray-50 ${draft.split.includes(m.id) ? 'selected' : ''}"
      >
        <span class="text-xl">${escapeHtml(m.emoji)}</span>
        <span class="text-[8px] font-black">${escapeHtml(m.name)}</span>
        <div class="check-mark absolute -top-1 -right-1 w-5 h-5 bg-[#5d5fef] text-white rounded-full ${draft.split.includes(m.id) ? 'flex' : 'hidden'} items-center justify-center border-2 border-white">
          <i class="fas fa-check text-[8px]"></i>
        </div>
      </div>
    `).join('');
  }
}

export function renderExpenseOCR() {
  const draft = getExpenseDraft();

  const box = document.getElementById('ocr-status-box');
  const text = document.getElementById('ocr-status-text');
  const candidates = document.getElementById('ocr-candidates');

  if (!box || !text || !candidates) return;

  const ocr = draft.ocr || {};

  if (!ocr.status || ocr.status === 'idle') {
    box.classList.add('hidden');
    text.innerText = '';
    candidates.innerHTML = '';
    return;
  }

  box.classList.remove('hidden');
  candidates.innerHTML = '';

  if (ocr.status === 'uploading') {
    text.innerText = '📤 正在上傳收據...';
    return;
  }

  if (ocr.status === 'processing') {
    text.innerText = '🔍 正在辨識收據金額...';
    return;
  }

  if (ocr.status === 'done') {
    const result = ocr.result || {};
    text.innerText = `✅ 已辨識：${result.amount ?? '-'} ${result.currency ?? ''}`;

    if (Array.isArray(result.candidates) && result.candidates.length > 0) {
      candidates.innerHTML = result.candidates.map((c, idx) => `
        <button
          data-action="draft-apply-ocr-candidate"
          data-index="${idx}"
          class="block w-full text-left bg-white rounded-xl px-3 py-2 border border-indigo-100 active:scale-[0.98] transition"
        >
          ${c.amount ?? '-'} ${escapeHtml(c.currency ?? '')} ${c.label ? `（${escapeHtml(c.label)}）` : ''}
        </button>
      `).join('');
    }

    return;
  }

  if (ocr.status === 'error') {
    text.innerText = `⚠️ ${ocr.error || '無法自動辨識，請手動輸入'}`;
  }
}

function renderFlexibleFields() {
  if(document.activeElement?.matches('[data-flex-kind]'))return;
  const draft=getExpenseDraft(), mode=draft.splitMode || 'equal';
  document.getElementById('split-mode').value=mode;
  document.getElementById('multiple-payers').checked=Boolean(draft.payers);
  const field=(m,kind,value,unit)=>`<label class="flex items-center justify-between gap-3"><span>${escapeHtml(m.name)} · ${escapeHtml(unit)}</span><input aria-label="${escapeHtml(m.name)}${kind==='split'?'分攤':'代付'}" class="management-input" style="width:50%" type="number" min="0" step="any" data-flex-kind="${kind}" data-member="${m.id}" value="${escapeHtml(value ?? '')}"></label>`;
  document.getElementById('payer-detail').innerHTML=draft.payers ? state.members.filter(m=>!m.archived || Object.hasOwn(draft.payers,m.id)).map(m=>field(m,'payer',draft.payers[m.id] ?? 0,draft.currency)).join('') : '';
  let html=mode==='equal' ? '' : state.members.filter(m=>draft.split.includes(m.id)).map(m=>field(m,'split',draft.splitValues?.[m.id],mode==='percent'?'%':mode==='shares'?'份':draft.currency)).join('');
  try {
    const allocation=expenseAllocation({...draft,amount:Number(draft.amount)},state);
    html+=`<p class="empty-note">實際分攤：${Object.entries(allocation.owed).map(([id,n])=>escapeHtml(state.members.find(m=>m.id===id)?.name || id)+' '+money(n/10**decimals(draft.currency),draft.currency)).join('、')} ${draft.currency}</p>`;
  } catch(error) {html+=`<p class="empty-note">${escapeHtml(error.message)}</p>`;}
  document.getElementById('split-detail').innerHTML=html;
}
