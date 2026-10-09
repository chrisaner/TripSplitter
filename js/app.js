import { state } from './state.js';
import { getPoolBalance, addPoolBalance } from './data.js';
import { renderActivity, renderAll, updateSyncUI } from './ui.js';
import { scheduleSync } from './services/syncService.js';
import { reportError } from './services/errorService.js';

/**
 * 金額格式化輔助函式：
 * JPY, TWD, KRW 自動取整數
 * 其他幣別保留至多小數點 1 位
 */
function formatSettleAmount(amt, curr) {
  const noDecimalCurrencies = ['JPY', 'TWD', 'KRW'];
  if (noDecimalCurrencies.includes(curr)) {
    return Math.round(amt).toLocaleString();
  }
  const rounded = Math.round(amt * 10) / 10;
  return rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function switchTab(tab) {
  try {
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    document.getElementById(`page-${tab}`)?.classList.add('active');

    ['activity', 'members', 'settle'].forEach((name) => {
      const btn = document.getElementById(`nav-${name}`);
      btn?.classList.remove('text-[#5d5fef]');
      btn?.classList.add('text-gray-300');
    });

    const activeBtn = document.getElementById(`nav-${tab}`);
    activeBtn?.classList.remove('text-gray-300');
    activeBtn?.classList.add('text-[#5d5fef]');

    if (tab === 'settle') {
      calculateSettle();
    }
  } catch (error) {
    reportError(error, { scope: 'app.switchTab', level: 'error' });
  }
}

export function applyFilters() {
  try {
    state.filterDate = document.getElementById('filter-date-select')?.value || 'all';
    state.filterMemberId = document.getElementById('filter-member-select')?.value || 'all';
    renderActivity();
  } catch (error) {
    reportError(error, { scope: 'app.applyFilters', level: 'error' });
  }
}

export function updatePool(mode) {
  try {
    const currency = document.getElementById('pool-currency-select')?.value || 'TWD';
    const val = parseFloat(document.getElementById('pool-input')?.value) || 0;

    if (mode === 'add') {
      addPoolBalance(currency, val);
    } else {
      const diff = val - getPoolBalance(currency);
      addPoolBalance(currency, diff);
    }

    const input = document.getElementById('pool-input');
    if (input) input.value = '';

    refreshPoolModalDisplay();
    renderAll();
    scheduleSync();
  } catch (error) {
    reportError(error, { scope: 'app.updatePool', level: 'error' });
  }
}

export function refreshPoolModalDisplay() {
  try {
    const currency = document.getElementById('pool-currency-select')?.value || 'TWD';
    const display = document.getElementById('pool-modal-display');
    if (display) {
      display.innerText = getPoolBalance(currency).toLocaleString();
    }

    const list = document.getElementById('pool-balance-list');
    if (list) {
      const supported = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'CNY'];
      list.innerHTML = supported.map((cur) => `
        <div class="flex items-center justify-between bg-white rounded-xl px-4 py-3">
          <span class="font-black text-gray-500">${cur}</span>
          <span class="font-black text-[#3b3f8c]">${getPoolBalance(cur).toLocaleString()}</span>
        </div>
      `).join('');
    }
  } catch (error) {
    reportError(error, { scope: 'app.refreshPoolModalDisplay', level: 'error' });
  }
}

export function calculateSettle() {
  try {
    const container = document.getElementById('settle-currency-groups');
    if (!container) return;

    const payerFilter = document.getElementById('settle-member-filter')?.value || 'all';
    const currencies = [...new Set(state.expenses.map((e) => e.currency).filter(Boolean))];

    if (currencies.length === 0) {
      container.innerHTML = `<p class="text-center py-20 text-gray-300 font-bold">暫無結算資料</p>`;
      return;
    }

    container.innerHTML = currencies.map((curr) => {
      const balance = {};
      state.members.forEach((m) => {
        balance[m.id] = 0;
      });

      state.expenses
        .filter((e) => e.currency === curr)
        .forEach((e) => {
          if (!e.split || e.split.length === 0) return;

          const share = e.amount / e.split.length;

          if (e.payer !== 'pool') {
            balance[e.payer] += e.amount;
          }

          e.split.forEach((mid) => {
            if (balance[mid] !== undefined) {
              balance[mid] -= share;
            }
          });
        });

      const debtors = [];
      const creditors = [];

      Object.keys(balance).forEach((id) => {
        if (balance[id] < -0.01) debtors.push({ id, amt: -balance[id] });
        if (balance[id] > 0.01) creditors.push({ id, amt: balance[id] });
      });

      const transactions = [];
      const d = [...debtors];
      const c = [...creditors];
      let i = 0;
      let j = 0;

      while (i < d.length && j < c.length) {
        const amt = Math.min(d[i].amt, c[j].amt);
        transactions.push({ from: d[i].id, to: c[j].id, amt });
        d[i].amt -= amt;
        c[j].amt -= amt;
        if (d[i].amt < 0.01) i++;
        if (c[j].amt < 0.01) j++;
      }

      const displayTxs =
        payerFilter !== 'all'
          ? transactions.filter((t) => t.from === payerFilter)
          : transactions;

      if (displayTxs.length === 0) return '';

      return `
        <div class="space-y-4">
          <div class="flex items-center gap-2">
            <div class="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
            <h3 class="font-black text-lg text-[#3b3f8c]">${curr} 結算區</h3>
          </div>
          ${displayTxs.map((t) => `
            <div class="bg-white p-5 rounded-[2.5rem] border border-gray-100 flex items-center justify-between shadow-sm">
              <div class="flex items-center gap-3">
                <span class="text-2xl">${state.members.find((m) => m.id === t.from)?.emoji || '🙂'}</span>
                <i class="fas fa-arrow-right text-gray-200"></i>
                <span class="text-2xl">${state.members.find((m) => m.id === t.to)?.emoji || '🙂'}</span>
              </div>
              <div class="text-right">
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-tighter">
                  ${(state.members.find((m) => m.id === t.from)?.name \vert{}\vert{} '')} ➜${(state.members.find((m) => m.id === t.to)?.name || '')}
                </p>
                <p class="font-black text-indigo-500">${formatSettleAmount(t.amt, curr)}${curr}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }).filter(Boolean).join('');

    if (container.innerHTML === '') {
      container.innerHTML = `<p class="text-center py-20 text-gray-300 font-bold">該成員無須支付款項</p>`;
    }
  } catch (error) {
    reportError(error, { scope: 'app.calculateSettle', level: 'error' });
  }
}

export function startPoolRotation() {
  try {
    setInterval(() => {
      const supported = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'CNY'];
      const nonZero = supported.filter((cur) => getPoolBalance(cur) !== 0);
      if (nonZero.length > 1) {
        updateSyncUI(true);
      }
    }, 2500);
  } catch (error) {
    reportError(error, { scope: 'app.startPoolRotation', level: 'warn' });
  }
}
