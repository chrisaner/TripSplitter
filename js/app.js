import { state } from './state.js?v=20261023-auth2';
import { getPoolBalance } from './data.js?v=20261023-auth2';
import { renderActivity, renderAll } from './ui.js?v=20261023-auth2';
import { dispatchOperation } from './services/syncService.js?v=20261023-auth2';
import { showToast } from './services/errorService.js?v=20261023-auth2';
import { settlement, money, CURRENCIES } from './core/ledger.js?v=20261023-auth2';
import { escapeHtml } from './utils.js?v=20261023-auth2';
import { renderPoolDetails } from './ui/managementUI.js?v=20261023-auth2';

export function switchTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${tab}`)?.classList.add('active');
  ['activity', 'members', 'settle', 'tools'].forEach(name => {
    const button = document.getElementById(`nav-${name}`);
    button?.classList.toggle('text-[#5d5fef]', name === tab);
    button?.classList.toggle('text-gray-300', name !== tab);
  });
  if (tab === 'settle') calculateSettle();
}
export function applyFilters() {
  state.filterDate = document.getElementById('filter-date-select')?.value || 'all';
  state.filterMemberId = document.getElementById('filter-member-select')?.value || 'all';
  renderActivity();
}
export function updatePool(mode) {
  const amountInput = document.getElementById('pool-input');
  const inputError = document.getElementById('pool-input-error');
  if (!amountInput.value.trim()) {
    if (inputError) {
      inputError.textContent = '請先在「金額（必填）」輸入金額。備註欄的數字不會計入儲值金額。';
      inputError.hidden = false;
    }
    amountInput.focus();
    amountInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (inputError) inputError.hidden = true;
  try {
    const currency = document.getElementById('pool-currency-select').value;
    dispatchOperation('pool.change', { mode, currency, amount: amountInput.value, previousBalance: getPoolBalance(currency),
      memberId: document.getElementById('pool-member-select')?.value || null, note: document.getElementById('pool-note')?.value || '' });
    document.getElementById('pool-input').value = '';
    if (document.getElementById('pool-note')) document.getElementById('pool-note').value = '';
    refreshPoolModalDisplay(); renderAll();
  } catch (error) { showToast(error.message, 'error'); }
}
export function refreshPoolModalDisplay() {
  const currency = document.getElementById('pool-currency-select')?.value || 'TWD';
  const display = document.getElementById('pool-modal-display');
  if (display) display.textContent = money(getPoolBalance(currency), currency);
  const list = document.getElementById('pool-balance-list');
  if (list) list.innerHTML = CURRENCIES.map(c => `<div class="flex justify-between bg-white rounded-xl px-4 py-3"><span>${c}</span><strong>${money(getPoolBalance(c), c)}</strong></div>`).join('');
  renderPoolDetails();
}
export function calculateSettle() {
  const container = document.getElementById('settle-currency-groups');
  if (!container) return;
  try {
    const filter = document.getElementById('settle-member-filter')?.value || 'all';
    const currencies = [...new Set(state.expenses.map(e => e.currency))];
    const member = id => state.members.find(m => m.id === id);
    container.innerHTML = currencies.map(c => {
      const transactions = settlement(state, c).transactions.filter(t => filter === 'all' || t.from === filter);
      const message = filter !== 'all' ? '該成員在此幣別無須支付款項' : state.expenses.filter(e => e.currency === c).every(e => e.payer === 'pool') ? '此幣別皆由公積金支付，無須個人轉帳' : '此幣別無須個人轉帳';
      return `<div class="space-y-4"><h3 class="font-black text-lg text-[#3b3f8c]">${escapeHtml(c)} 結算區</h3>${transactions.length ? transactions.map(t => `<div class="bg-white p-5 rounded-[2.5rem] border border-gray-100 flex items-center justify-between shadow-sm"><div class="text-2xl">${escapeHtml(member(t.from)?.emoji || '🙂')} → ${escapeHtml(member(t.to)?.emoji || '🙂')}</div><div class="text-right"><p class="text-xs text-gray-500">${escapeHtml(member(t.from)?.name || '')} ➜ ${escapeHtml(member(t.to)?.name || '')}</p><p class="font-black text-indigo-500">${money(t.amount, c)} ${escapeHtml(c)}</p></div></div>`).join('') : `<p class="text-center py-6 text-gray-400 font-bold">${message}</p>`}</div>`;
    }).join('') || '<p class="text-center py-20 text-gray-400">暫無結算資料</p>';
  } catch (error) { container.textContent = error.message; }
}
export function startPoolRotation() { /* Header uses the current balances; no false sync acknowledgements. */ }
