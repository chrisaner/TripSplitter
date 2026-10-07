import { state } from './state.js';
import { handleRoomJoinPrompt } from './services/syncService.js';
import { getLocalISOString } from './utils.js'; // ⭐ 引入時間 Helper
import {
  triggerReceiptUpload,
  handleReceiptFile,
  removeReceipt,
  viewFullReceipt,
  applyOCRCandidate
} from './services/ocrService.js';

import {
  switchTab,
  applyFilters,
  calculateSettle,
  updatePool,
  refreshPoolModalDisplay
} from './app.js';

import {
  closeModal,
  openMemberModal,
  openExpenseModal,
  openPoolModal,
  setTempEmoji
} from './modal.js';

import {
  saveExpenseDraft,
  deleteExpenseDraft
} from './services/expenseService.js';

import {
  saveCurrentMember,
  deleteMemberById
} from './services/memberService.js';

import {
  getExpenseDraft,
  updateExpenseDraft,
  updateExpenseDraftSplit
} from './state/modalStore.js';

import {
  renderExpenseModal
} from './ui/expenseModalUI.js';

export function bindStaticEvents() {
  document.getElementById('auth-btn')?.addEventListener('click', handleRoomJoinPrompt);
  document.getElementById('pool-btn')?.addEventListener('click', openPoolModal);

  document.getElementById('nav-activity')?.addEventListener('click', () => switchTab('activity'));
  document.getElementById('nav-members')?.addEventListener('click', () => switchTab('members'));
  document.getElementById('nav-settle')?.addEventListener('click', () => switchTab('settle'));
  
  // ⭐ 新增支出：點擊時帶入預設 UTC+8 當前時間
  document.getElementById('add-expense-btn')?.addEventListener('click', () => {
    openExpenseModal();
    const expTimeInput = document.getElementById('exp-time');
    if (expTimeInput) {
      const nowUtc8 = getLocalISOString();
      expTimeInput.value = nowUtc8;
      updateExpenseDraft({ time: nowUtc8 });
    }
  });

  document.getElementById('add-member-btn')?.addEventListener('click', () => openMemberModal());

  document.getElementById('expense-modal-close-btn')?.addEventListener('click', () => closeModal(null, 'expenseModal'));
  document.getElementById('member-modal-close-btn')?.addEventListener('click', () => closeModal(null, 'memberModal'));
  document.getElementById('image-viewer-close-btn')?.addEventListener('click', () => closeModal(null, 'imageViewerModal'));

  document.getElementById('save-expense-btn')?.addEventListener('click', () => {
    const ok = saveExpenseDraft();
    if (ok) {
      closeModal(null, 'expenseModal');
      switchTab('activity');
    }
  });

  document.getElementById('delete-exp-btn')?.addEventListener('click', () => {
    const ok = deleteExpenseDraft();
    if (ok) {
      closeModal(null, 'expenseModal');
    }
  });

  document.getElementById('member-save-btn')?.addEventListener('click', () => {
    const name = document.getElementById('member-name')?.value || '';
    const emoji = document.getElementById('member-emoji-display')?.innerText || '👤';

    const ok = saveCurrentMember(name, emoji);
    if (ok) {
      closeModal(null, 'memberModal');
    }
  });

  document.getElementById('trigger-receipt-upload-btn')?.addEventListener('click', triggerReceiptUpload);
  document.getElementById('receipt-image')?.addEventListener('click', viewFullReceipt);
  document.getElementById('remove-receipt-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removeReceipt();
  });

  document.getElementById('receipt-input')?.addEventListener('change', async (e) => {
    await handleReceiptFile(e.target);
  });

  document.getElementById('exp-title')?.addEventListener('input', (e) => {
    updateExpenseDraft({ title: e.target.value });
  });

  document.getElementById('exp-amount')?.addEventListener('input', (e) => {
    updateExpenseDraft({ amount: e.target.value });
  });

  document.getElementById('exp-currency')?.addEventListener('change', (e) => {
    updateExpenseDraft({ currency: e.target.value });
  });

  document.getElementById('exp-time')?.addEventListener('change', (e) => {
    updateExpenseDraft({ time: e.target.value });
  });

  document.getElementById('pool-currency-select')?.addEventListener('change', refreshPoolModalDisplay);
  document.getElementById('pool-add-btn')?.addEventListener('click', () => updatePool('add'));
  document.getElementById('pool-set-btn')?.addEventListener('click', () => updatePool('set'));

  document.getElementById('filter-date-select')?.addEventListener('change', applyFilters);
  document.getElementById('filter-member-select')?.addEventListener('change', applyFilters);
  document.getElementById('settle-member-filter')?.addEventListener('change', calculateSettle);

  document.getElementById('split-select-all-btn')?.addEventListener('click', () => {
    const next = getExpenseDraft().split.length === state.members.length
      ? []
      : state.members.map((m) => m.id);

    updateExpenseDraftSplit(next);
  });

  document.getElementById('expenseModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'expenseModal') closeModal(e, 'expenseModal');
  });

  document.getElementById('memberModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'memberModal') closeModal(e, 'memberModal');
  });

  document.getElementById('poolModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'poolModal') closeModal(e, 'poolModal');
  });

  document.getElementById('imageViewerModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'imageViewerModal') closeModal(e, 'imageViewerModal');
  });

  document.querySelectorAll('.modal-content').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });
}

export function bindDelegatedEvents() {
  document.getElementById('main-cats')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="draft-select-cat"]');
    if (!btn) return;

    const catKey = btn.dataset.catKey;
    const firstSub = state.categories[catKey]?.subs?.[0] || '';

    updateExpenseDraft({
      cat: catKey,
      sub: firstSub,
      title: firstSub
    });

    localStorage.setItem('lastCategory', catKey);
    localStorage.setItem('lastSub', firstSub);
  });

  document.getElementById('sub-cats')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="draft-select-sub"]');
    if (!btn) return;

    const sub = btn.dataset.sub;

    updateExpenseDraft({
      sub,
      title: sub
    });

    localStorage.setItem('lastSub', sub);
    renderExpenseModal();
  });

  document.getElementById('member-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'edit-member') {
      openMemberModal(btn.dataset.memberId);
      return;
    }

    if (btn.dataset.action === 'delete-member') {
      deleteMemberById(btn.dataset.memberId);
    }
  });

  document.getElementById('activity-list')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="edit-expense"]');
    if (!card) return;
    openExpenseModal(Number(card.dataset.expenseId));
  });

  document.getElementById('payer-scroll')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="draft-set-payer"]');
    if (!card) return;

    updateExpenseDraft({ payer: card.dataset.payerId });
  });

  document.getElementById('split-scroll')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="draft-toggle-split"]');
    if (!card) return;

    const memberId = card.dataset.memberId;
    const draft = getExpenseDraft();

    const nextSplit = draft.split.includes(memberId)
      ? draft.split.filter((m) => m !== memberId)
      : [...draft.split, memberId];

    updateExpenseDraftSplit(nextSplit);
    renderExpenseModal();
  });

  document.getElementById('emoji-picker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pick-emoji"]');
    if (!btn) return;
    setTempEmoji(btn.dataset.emoji);
  });

  document.getElementById('ocr-candidates')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="draft-apply-ocr-candidate"]');
    if (!btn) return;

    applyOCRCandidate(Number(btn.dataset.index));
  });
}