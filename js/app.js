import { renderSettlement } from './ui/settlementUI.js?v=20261023-travel1';
import { state } from './state.js?v=20261023-travel1';
import { getPoolBalance } from './data.js?v=20261023-travel1';
import { renderActivity, renderAll } from './ui.js?v=20261023-travel1';
import { dispatchOperation } from './services/syncService.js?v=20261023-travel1';
import { showToast } from './services/errorService.js?v=20261023-travel1';
import { money, CURRENCIES } from './core/ledger.js?v=20261023-travel1';
import { renderPoolDetails } from './ui/managementUI.js?v=20261023-travel1';

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
export function calculateSettle() { renderSettlement(); }
export function startPoolRotation() { /* Header uses the current balances; no false sync acknowledgements. */ }
