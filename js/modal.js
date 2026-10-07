import { state, emojiList } from './state.js';
import { resetExpenseDraft } from './state/modalStore.js';
import { renderExpenseModal } from './ui/expenseModalUI.js';
import { refreshPoolModalDisplay } from './app.js';

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.style.display = 'flex';

  setTimeout(() => {
    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'translateY(0)';
  }, 10);
}

export function closeModal(e, id) {
  if (e && e.target && e.target.id !== id) return;

  const modal = document.getElementById(id);
  if (!modal) return;

  const content = modal.querySelector('.modal-content');
  if (content) {
    content.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    content.style.transform = 'translateY(100%)';
  }

  if (id === 'memberModal') {
    state.editingMemberId = null;
    state.tempEmoji = '👤';
  }

  setTimeout(() => {
    modal.style.display = 'none';
    if (content) content.style.transition = '';
  }, 250);
}

export function setTempEmoji(emoji) {
  state.tempEmoji = emoji;
  const display = document.getElementById('member-emoji-display');
  if (display) display.innerText = emoji;
}

export function openMemberModal(editId = null) {
  const picker = document.getElementById('emoji-picker');

  if (editId) {
    const member = state.members.find((m) => m.id === editId);
    if (!member) return;

    state.editingMemberId = editId;
    state.tempEmoji = member.emoji;

    document.getElementById('member-modal-title').innerText = '編輯夥伴';
    document.getElementById('member-save-btn').innerText = '儲存修改';
    document.getElementById('member-emoji-display').innerText = member.emoji;
    document.getElementById('member-name').value = member.name;
  } else {
    state.editingMemberId = null;
    state.tempEmoji = '👤';

    document.getElementById('member-modal-title').innerText = '新增夥伴';
    document.getElementById('member-save-btn').innerText = '確定新增';
    document.getElementById('member-emoji-display').innerText = '👤';
    document.getElementById('member-name').value = '';
  }

  if (picker) {
    picker.innerHTML = emojiList.map((e) => `
      <button
        data-action="pick-emoji"
        data-emoji="${e}"
        class="w-10 h-10 flex items-center justify-center text-xl bg-gray-50 rounded-xl active:scale-90 transition-transform"
      >
        ${e}
      </button>
    `).join('');
  }

  openModal('memberModal');
}

export function openExpenseModal(editId = null) {
  if (editId) {
    const exp = state.expenses.find((e) => e.id === editId);
    if (!exp) return;

    resetExpenseDraft({
      id: exp.id,
      cat: exp.cat,
      sub: exp.sub || exp.title,
      title: exp.title,
      amount: exp.amount,
      currency: exp.currency,
      time: exp.time,
      payer: exp.payer,
      split: [...exp.split],
	  titleTouched: false,
      receipt: exp.receipt || null,
      ocr: {
        status: 'idle',
        jobId: null,
        draftId: null,
        result: null,
        error: null
      }
    });
  } else {
    const lastCategory = localStorage.getItem('lastCategory') || 'food';
    const firstSub = state.categories[lastCategory]?.subs?.[0] || '午餐';

    resetExpenseDraft({
      id: null,
      cat: lastCategory,
      sub: firstSub,
      title: firstSub,
      amount: '',
      currency: 'TWD',
      time: new Date().toISOString().slice(0, 16),
      payer: 'pool',
      split: state.members.map((m) => m.id),
      receipt: null,
      ocr: {
        status: 'idle',
        jobId: null,
        draftId: null,
        result: null,
        error: null
      }
    });
  }

  renderExpenseModal();
  openModal('expenseModal');
}

export function openPoolModal() {
  const select = document.getElementById('pool-currency-select');
  if (select && !select.value) select.value = 'TWD';

  const input = document.getElementById('pool-input');
  if (input) input.value = '';

  // 先刷新內容
  refreshPoolModalDisplay();

  const modal = document.getElementById('poolModal');
  if (!modal) return;

  modal.style.display = 'flex';

  setTimeout(() => {
    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'translateY(0)';
  }, 10);
}