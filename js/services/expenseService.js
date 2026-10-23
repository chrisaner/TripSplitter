import { getState } from '../state/store.js?v=20261023-travel2';
import { getExpenseDraft, clearExpenseDraft } from '../state/modalStore.js?v=20261023-travel2';
import { dispatchOperation } from './syncService.js?v=20261023-travel2';
import { showToast } from './errorService.js?v=20261023-travel2';

export function saveExpenseDraft() {
  const draft = getExpenseDraft();
  const ok = saveCurrentExpense(draft);
  if (ok) clearExpenseDraft();
  return ok;
}
export function deleteExpenseDraft() {
  const draft = getExpenseDraft();
  if (!draft.id || !confirm('刪除這筆支出？')) return false;
  const ok = deleteCurrentExpense(draft.id, draft.expectedRevision);
  if (ok) clearExpenseDraft();
  return ok;
}
export function saveCurrentExpense(data) {
  try {
    const old = getState().expenses.find(e => String(e.id) === String(data.id));
    const entry = { id: data.id || crypto.randomUUID(), cat: data.cat || 'other', sub: data.sub || '', title: data.title || data.sub,
      amount: data.amount, currency: data.currency, time: data.time, payer: data.payer, split: data.split, splitMode:data.splitMode || 'equal', splitValues:data.splitValues || {}, payers:data.payers || null, receipt: data.receipt || null };
    return dispatchOperation('expense.save', entry, data.expectedRevision ?? old?._rev ?? 0);
  } catch (error) { showToast(error.message, 'error'); return false; }
}
export function deleteCurrentExpense(id, expectedRevision) {
  try {
    const old = getState().expenses.find(e => String(e.id) === String(id));
    if (!old) return false;
    return dispatchOperation('expense.delete', { id: old.id }, expectedRevision ?? old._rev ?? 0);
  } catch (error) { showToast(error.message, 'error'); return false; }
}
