export const CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'CNY'];
export const decimals = c => ['TWD', 'JPY', 'KRW'].includes(c) ? 0 : 2;
export const units = (a, c) => Math.round(Number(a) * 10 ** decimals(c));
export const money = (a, c) => Number(a).toLocaleString('zh-TW', { minimumFractionDigits: decimals(c), maximumFractionDigits: decimals(c) });
const list = v => Array.isArray(v) ? v.filter(Boolean) : Object.values(v || {});
const clone = v => JSON.parse(JSON.stringify(v));
const fail = m => { throw new Error(m); };
export function normalizeLedger(raw = {}) {
  return { ...raw, schemaVersion: 2, revision: Number(raw.revision || 0), members: list(raw.members), expenses: list(raw.expenses),
    poolBalances: Object.fromEntries(CURRENCIES.map(c => [c, Number(raw.poolBalances?.[c] ?? (c === 'TWD' ? raw.pool || 0 : 0))])), appliedOps: raw.appliedOps || {}, tombstones: raw.tombstones || {} };
}
export function financialState(state) {
  const { schemaVersion, revision, members, expenses, poolBalances, appliedOps, tombstones } = normalizeLedger(state);
  return clone({ schemaVersion, revision, members, expenses, poolBalances, appliedOps, tombstones });
}
export function validateAmount(amount, currency, allowZero = false) {
  if (!CURRENCIES.includes(currency)) fail('請選擇支援的幣別');
  const value = Number(amount);
  if (amount === '' || amount === null || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) fail('金額必須是有效的正數');
  const scaled = value * 10 ** decimals(currency);
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.000001) fail(`${currency} 最多可輸入 ${decimals(currency)} 位小數`);
  return value;
}
export function validateExpense(data, state, previous) {
  const amount = validateAmount(data.amount, data.currency);
  const exists = id => state.members.some(m => m.id === id);
  if (data.payer !== 'pool' && !exists(data.payer)) fail('付款成員不存在');
  if (!Array.isArray(data.split) || !data.split.length || new Set(data.split).size !== data.split.length || data.split.some(id => !exists(id))) fail('請選擇有效且不重複的分攤成員');
  const archived = id => state.members.find(m => m.id === id)?.archived;
  if ((archived(data.payer) && previous?.payer !== data.payer) || data.split.some(id => archived(id) && !previous?.split?.includes(id))) fail('已停用成員不可加入新帳目');
  if (typeof data.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.time) || !Number.isFinite(Date.parse(data.time))) fail('請輸入有效的記帳日期');
  const title = String(data.title || data.sub || '').trim();
  if (!title || title.length > 200) fail('請輸入 1 至 200 字的支出名稱');
  if (data.receipt && (typeof data.receipt !== 'string' || !/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(data.receipt))) fail('收據格式不正確');
  return { ...data, amount, title, split: [...data.split], receipt: data.receipt || null };
}
export function applyOperation(raw, op) {
  const state = normalizeLedger(clone(raw));
  if (state.appliedOps[op.id]) return state;
  const data = op.data;
  if (op.type.startsWith('expense.')) {
    const index = state.expenses.findIndex(e => String(e.id) === String(data.id));
    const old = state.expenses[index];
    if (state.tombstones[data.id]) fail('這筆支出已刪除，請到刪除復原功能處理');
    if ((old?._rev || 0) !== op.expectedRevision || (index < 0 && op.expectedRevision > 0)) fail('這筆支出已被其他人修改，請重新開啟後再儲存');
    if (op.type === 'expense.save') {
      const entry = { ...validateExpense(data, state, old), _rev: (old?._rev || 0) + 1 };
      if (old?.payer === 'pool') state.poolBalances[old.currency] += Number(old.amount);
      if (entry.payer === 'pool') state.poolBalances[entry.currency] -= entry.amount;
      if (index < 0) state.expenses.push(entry); else state.expenses[index] = entry;
    } else if (op.type === 'expense.delete') {
      if (!old) fail('找不到要刪除的支出');
      if (old.payer === 'pool') state.poolBalances[old.currency] += Number(old.amount);
      state.expenses.splice(index, 1);
      state.tombstones[data.id] = (old._rev || 0) + 1;
    } else fail('不支援的支出操作');
  } else if (op.type.startsWith('member.')) {
    const old = state.members.find(m => m.id === data.id);
    if ((old?._rev || 0) !== op.expectedRevision) fail('成員已被其他人修改，請重新開啟');
    if (op.type === 'member.save') {
      const name = String(data.name || '').trim();
      if (!name || name.length > 40) fail('成員名稱必須為 1 至 40 字');
      const member = { ...old, id: data.id, name, emoji: String(data.emoji || '👤').slice(0, 30), _rev: (old?._rev || 0) + 1 };
      if (old) Object.assign(old, member); else state.members.push(member);
    } else if (op.type === 'member.archive') {
      if (!old) fail('成員不存在');
      old.archived = Boolean(data.archived); old._rev = (old._rev || 0) + 1;
    } else fail('不支援的成員操作');
  } else if (op.type === 'pool.change') {
    const amount = validateAmount(data.amount, data.currency, data.mode === 'set');
    if (data.mode === 'set' && state.poolBalances[data.currency] !== data.previousBalance) fail('公積金餘額已更新，請確認最新餘額後再調整');
    state.poolBalances[data.currency] = data.mode === 'set' ? amount : state.poolBalances[data.currency] + amount;
  } else fail('不支援的操作');
  for (const c of CURRENCIES) state.poolBalances[c] = Math.round(state.poolBalances[c] * 100) / 100;
  state.revision++; state.appliedOps[op.id] = true;
  return state;
}
export function settlement(state, currency) {
  const balances = Object.fromEntries(state.members.map(m => [m.id, 0]));
  state.expenses.filter(e => e.currency === currency && e.payer !== 'pool').forEach(e => {
    const split = [...new Set(e.split || [])].sort();
    if (!split.length || !(e.payer in balances) || split.some(id => !(id in balances))) fail('帳目包含不存在的成員，請先修正帳目');
    const amount = units(e.amount, currency); balances[e.payer] += amount;
    const base = Math.floor(amount / split.length), remainder = amount % split.length;
    split.forEach((id, i) => balances[id] -= base + (i < remainder ? 1 : 0));
  });
  const debt = Object.entries(balances).filter(([, n]) => n < 0).map(([id, n]) => ({ id, amount: -n }));
  const credit = Object.entries(balances).filter(([, n]) => n > 0).map(([id, amount]) => ({ id, amount }));
  const transactions = []; let i = 0, j = 0;
  while (i < debt.length && j < credit.length) {
    const amount = Math.min(debt[i].amount, credit[j].amount);
    transactions.push({ from: debt[i].id, to: credit[j].id, amount: amount / 10 ** decimals(currency) });
    debt[i].amount -= amount; credit[j].amount -= amount;
    if (!debt[i].amount) i++; if (!credit[j].amount) j++;
  }
  return { balances, transactions };
}
