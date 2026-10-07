import { getState, commit } from '../state/store.js';
import { addPoolBalance } from '../data.js';
import { getExpenseDraft, clearExpenseDraft } from '../state/modalStore.js';
import { scheduleSync } from './syncService.js';

export function saveExpenseDraft() {
  const draft = getExpenseDraft();

  const payload = {
    id: draft.id,
    cat: draft.cat,
    sub: draft.sub,
    title: draft.title,
    amount: Number(draft.amount),
    currency: draft.currency,
    time: draft.time,
    payer: draft.payer,
    split: [...draft.split],
    receipt: draft.receipt
  };

  const ok = saveCurrentExpense(payload);

  if (ok) {
    scheduleSync();
    clearExpenseDraft();
  }

  return ok;
}

export function deleteExpenseDraft() {
  const draft = getExpenseDraft();
  if (!draft.id) return false;

  const ok = deleteCurrentExpense(draft.id);

  if (ok) {
    scheduleSync();
    clearExpenseDraft();
  }

  return ok;
}

export function saveCurrentExpense(data) {
  if (!data.amount || !data.split || data.split.length === 0) return false;

  commit((root) => {
    const expense = {
      id: data.id || Date.now(),
      cat: data.cat,
      sub: data.sub,
      title: data.title || data.sub,
      amount: Number(data.amount),
      currency: data.currency,
      time: data.time,
      payer: data.payer,
      split: [...data.split],
      receipt: data.receipt || null
    };

    const ensurePoolCurrency = (currency) => {
      if (!root.poolBalances) root.poolBalances = {};
      if (typeof root.poolBalances[currency] !== 'number') {
        root.poolBalances[currency] = 0;
      }
    };

    const idx = root.expenses.findIndex((e) => e.id === expense.id);

    if (idx !== -1) {
      const oldExp = root.expenses[idx];

      if (oldExp.payer === 'pool') {
        ensurePoolCurrency(oldExp.currency);
        root.poolBalances[oldExp.currency] += Number(oldExp.amount);
      }

      root.expenses[idx] = expense;

      if (expense.payer === 'pool') {
        ensurePoolCurrency(expense.currency);
        root.poolBalances[expense.currency] -= Number(expense.amount);
      }
    } else {
      root.expenses.push(expense);

      if (expense.payer === 'pool') {
        ensurePoolCurrency(expense.currency);
        root.poolBalances[expense.currency] -= Number(expense.amount);
      }
    }
  });

  return true;
}

export function deleteCurrentExpense(expenseId) {
  const current = getState();
  const target = current.expenses.find((e) => e.id === expenseId);
  if (!target) return false;

  commit((root) => {
    if (target.payer === 'pool') {
      if (!root.poolBalances) root.poolBalances = {};
      if (typeof root.poolBalances[target.currency] !== 'number') {
        root.poolBalances[target.currency] = 0;
      }
      root.poolBalances[target.currency] += Number(target.amount);
    }

    root.expenses = root.expenses.filter((e) => e.id !== expenseId);
  });

  return true;
}