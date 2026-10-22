export const CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'CNY'];
export const decimals = c => ['TWD', 'JPY', 'KRW'].includes(c) ? 0 : 2;
export const units = (a, c) => Math.round(Number(a) * 10 ** decimals(c));
export const money = (a, c) => (Number(a) || 0).toLocaleString('zh-TW', { minimumFractionDigits: decimals(c), maximumFractionDigits: decimals(c) });
const list = v => Array.isArray(v) ? v.filter(Boolean) : Object.values(v || {});
const clone = v => JSON.parse(JSON.stringify(v));
const fail = m => { throw new Error(m); };
export function normalizeLedger(raw = {}) {
  const expenses = list(raw.expenses), poolEntries = list(raw.poolEntries);
  const poolBalances = Object.fromEntries(CURRENCIES.map(c => [c, Number(raw.poolBalances?.[c] ?? (c === 'TWD' ? raw.pool || 0 : 0))]));
  // Legacy deposits were not attributed. Preserve the balance without inventing contributors.
  const poolOpening = Object.fromEntries(CURRENCIES.map(c => [c, Number(raw.poolOpening?.[c] ?? Math.round((poolBalances[c] + expenses.filter(e => e.payer === 'pool' && e.currency === c).reduce((sum,e)=>sum+Number(e.amount),0) - poolEntries.filter(e=>e.currency===c).reduce((sum,e)=>sum+Number(e.amount),0))*100)/100)]));
  return { ...raw, schemaVersion: 2, revision: Number(raw.revision || 0), epoch: Number(raw.epoch || 0), members: list(raw.members), expenses,
    poolBalances, poolOpening, poolEntries, trash: list(raw.trash), history: raw.history || {}, appliedOps: raw.appliedOps || {}, tombstones: raw.tombstones || {} };
}
export function financialState(state) {
  const { schemaVersion, revision, epoch, members, expenses, poolBalances, appliedOps, tombstones, poolOpening, poolEntries, trash, history } = normalizeLedger(state);
  return clone({ schemaVersion, revision, epoch, members, expenses, poolBalances, appliedOps, tombstones, poolOpening, poolEntries, trash, history });
}
export function recomputePool(state) {
  for (const c of CURRENCIES) {
    const opening = Math.round(Number(state.poolOpening[c] || 0) * 100);
    const entries = state.poolEntries.filter(e=>e.currency===c).reduce((sum,e)=>sum+Math.round(e.amount*100),0);
    const spending = state.expenses.filter(e=>e.currency===c && e.payer==='pool').reduce((sum,e)=>sum+Math.round(e.amount*100),0);
    state.poolBalances[c] = (opening + entries - spending) / 100;
  }
  return state;
}
export function validateAmount(amount, currency, allowZero = false) {
  if (!CURRENCIES.includes(currency)) fail('請選擇支援的幣別');
  const value = Number(amount);
  if (!['number','string'].includes(typeof amount) || String(amount).trim() === '' || !Number.isFinite(value) || value > 1e12 || (allowZero ? value < 0 : value <= 0)) fail('金額必須是有效的正數，且不可超過一兆');
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
  if (op.epoch !== undefined && op.epoch !== state.epoch) fail('房間已還原備份，請採用雲端版本並重新確認帳目');
  const data = op.data;
  let before = null, after = null;
  if (op.type.startsWith('expense.')) {
    const index = state.expenses.findIndex(e => String(e.id) === String(data.id));
    const old = state.expenses[index];
    before = old ? clone(old) : null;
    if (op.type === 'expense.restore') {
      const deleted = state.trash.find(e => String(e.id) === String(data.id));
      if (old || !deleted || state.tombstones[data.id] !== op.expectedRevision) fail('刪除紀錄已變更，請重新確認');
      const {_deletedAt, _deletedBy, ...entry} = deleted;
      after = { ...validateExpense(entry, state, entry), _rev: op.expectedRevision + 1 };
      state.expenses.push(after); state.trash = state.trash.filter(e => String(e.id) !== String(data.id));
      delete state.tombstones[data.id];
    } else {
      if (state.tombstones[data.id]) fail('這筆支出已刪除，請到刪除復原功能處理');
      if ((old?._rev || 0) !== op.expectedRevision || (index < 0 && op.expectedRevision > 0)) fail('這筆支出已被其他人修改，請重新開啟後再儲存');
      if (op.type === 'expense.save') {
      const entry = { ...validateExpense(data, state, old), _rev: (old?._rev || 0) + 1 };
      after = entry;
      if (index < 0) state.expenses.push(entry); else state.expenses[index] = entry;
      } else if (op.type === 'expense.delete') {
      if (!old) fail('找不到要刪除的支出');
      state.expenses.splice(index, 1);
      state.tombstones[data.id] = (old._rev || 0) + 1;
      state.trash.push({ ...old, _rev: state.tombstones[data.id], _deletedAt: op.at, _deletedBy: op.actor });
      } else fail('不支援的支出操作');
    }
  } else if (op.type.startsWith('member.')) {
    const old = state.members.find(m => m.id === data.id);
    before = old ? clone(old) : null;
    if ((old?._rev || 0) !== op.expectedRevision) fail('成員已被其他人修改，請重新開啟');
    if (op.type === 'member.save') {
      const name = String(data.name || '').trim();
      if (!name || name.length > 40) fail('成員名稱必須為 1 至 40 字');
      const member = { ...old, id: data.id, name, emoji: String(data.emoji || '👤').slice(0, 30), _rev: (old?._rev || 0) + 1 };
      if (old) Object.assign(old, member); else state.members.push(member);
      after = member;
    } else if (op.type === 'member.archive') {
      if (!old) fail('成員不存在');
      old.archived = Boolean(data.archived); old._rev = (old._rev || 0) + 1;
      after = clone(old);
    } else fail('不支援的成員操作');
  } else if (op.type === 'pool.change') {
    const amount = validateAmount(data.amount, data.currency, data.mode === 'set');
    if (!['set','add','refund'].includes(data.mode)) fail('請選擇有效的公積金操作');
    if (data.mode === 'set' && state.poolBalances[data.currency] !== data.previousBalance) fail('公積金餘額已更新，請確認最新餘額後再調整');
    if (data.memberId && !state.members.some(m=>m.id===data.memberId)) fail('公積金成員不存在');
    if (data.mode === 'refund' && (!data.memberId || amount > state.poolBalances[data.currency])) fail('退款必須指定成員，且不可超過目前餘額');
    const note = String(data.note || '').trim();
    if (data.mode === 'set' && !note) fail('調整餘額必須填寫原因');
    before = { balance: state.poolBalances[data.currency] };
    after = { id: op.id, currency: data.currency, kind: data.mode === 'set' ? 'adjustment' : data.mode === 'refund' ? 'refund' : 'deposit',
      amount: data.mode === 'set' ? amount - state.poolBalances[data.currency] : data.mode === 'refund' ? -amount : amount,
      memberId: data.memberId || null, note: note.slice(0,200), at: op.at, actor: op.actor };
    state.poolEntries.push(after);
  } else if (op.type === 'backup.restore') {
    if (state.revision !== op.expectedRevision) fail('預覽後帳目已變更，請重新載入備份並確認');
    const restored = validateSnapshot(data.snapshot);
    before = { members: state.members.length, expenses: state.expenses.length, poolBalances: clone(state.poolBalances) };
    for (const entry of restored.expenses) entry._rev = Math.max(entry._rev || 0, state.expenses.find(e=>String(e.id)===String(entry.id))?._rev || 0, state.tombstones[entry.id] || 0) + 1;
    for (const entry of restored.expenses) delete restored.tombstones[entry.id];
    for (const entry of restored.trash) {
      entry._rev = Math.max(entry._rev || 0, state.expenses.find(e=>String(e.id)===String(entry.id))?._rev || 0, state.tombstones[entry.id] || 0) + 1;
      restored.tombstones[entry.id] = entry._rev;
    }
    for (const member of restored.members) member._rev = Math.max(member._rev || 0, state.members.find(m=>m.id===member.id)?._rev || 0) + 1;
    // Keep deletion barriers for records removed by restoring an older snapshot.
    for (const entry of state.expenses) if (!restored.expenses.some(e=>String(e.id)===String(entry.id))) restored.tombstones[entry.id] = Math.max(restored.tombstones[entry.id] || 0, (entry._rev || 0) + 1);
    for (const [id,rev] of Object.entries(state.tombstones)) if (!restored.expenses.some(e=>String(e.id)===id)) restored.tombstones[id] = Math.max(restored.tombstones[id] || 0, rev);
    const appliedOps = { ...state.appliedOps, ...restored.appliedOps };
    const history = { ...restored.history, ...state.history };
    const revision = state.revision;
    const epoch = state.epoch + 1;
    Object.assign(state, restored, { appliedOps, history, revision, epoch });
    after = { members: state.members.length, expenses: state.expenses.length, poolBalances: clone(state.poolBalances) };
  } else fail('不支援的操作');
  recomputePool(state);
  state.history[op.id] = { id: op.id, type: op.type, targetId: data.id || op.id, at: op.at || new Date(0).toISOString(), actor: op.actor || {uid:'unknown',name:'未指定操作者'}, before, after };
  state.revision++; state.appliedOps[op.id] = true;
  return state;
}

const validId = id => (typeof id === 'string' || typeof id === 'number') && !Object.hasOwn(Object.prototype,String(id)) && String(id) !== 'prototype' && /^[a-zA-Z0-9_-]{1,160}$/.test(String(id));
export function validateSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.schemaVersion && raw.schemaVersion !== 2)) fail('不支援的帳目備份版本');
  if (!Array.isArray(raw.members) || !Array.isArray(raw.expenses) || raw.members.length > 1000 || raw.expenses.length > 50000) fail('備份帳目格式不正確');
  const state = financialState(raw);
  const validRevision = value => Number.isSafeInteger(value) && value >= 0;
  if (!validRevision(state.revision) || !validRevision(state.epoch)) fail('備份版本號不正確');
  const ids = new Set();
  state.members = state.members.map(m => {
    if (!validId(m.id) || typeof m.id !== 'string' || ids.has(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40 || !validRevision(Number(m._rev || 0))) fail('備份成員格式不正確或 ID 重複');
    ids.add(m.id);
    return { id:m.id, name:m.name, emoji:String(m.emoji || '👤').slice(0,30), archived:Boolean(m.archived), _rev:Number(m._rev || 0) };
  });
  ids.clear();
  const cleanExpense = (e, deleted = false) => {
    if (!validId(e.id) || ids.has(String(e.id)) || !validRevision(Number(e._rev || 0))) fail('備份支出 ID 不正確或重複');
    ids.add(String(e.id));
    const entry = {id:e.id,cat:String(e.cat || 'other'),sub:String(e.sub || ''),title:e.title,amount:e.amount,currency:e.currency,time:e.time,payer:e.payer,split:e.split,receipt:e.receipt || null,_rev:Number(e._rev || 0)};
    const result = validateExpense(entry,state,entry);
    if (deleted) Object.assign(result,{_deletedAt:e._deletedAt || '',_deletedBy:e._deletedBy || null});
    return result;
  };
  state.expenses = state.expenses.map(e=>cleanExpense(e));
  state.trash = state.trash.map(e=>cleanExpense(e,true));
  for (const e of state.expenses) if (state.tombstones[e.id]) fail('有效帳目不可同時標記為已刪除');
  for (const e of state.trash) if (state.tombstones[e.id] !== e._rev) fail('刪除紀錄與版本不一致');
  for (const [id,revision] of Object.entries(state.tombstones)) if (!validId(id) || !validRevision(revision)) fail('刪除紀錄版本不正確');
  for (const c of CURRENCIES) if (!Number.isFinite(state.poolOpening[c]) || !Number.isFinite(state.poolBalances[c])) fail('備份公積金金額不正確');
  ids.clear();
  for (const e of state.poolEntries) {
    if (!validId(e.id) || !CURRENCIES.includes(e.currency) || !Number.isFinite(e.amount) || !['deposit','refund','adjustment'].includes(e.kind) || (e.memberId && !state.members.some(m=>m.id===e.memberId))) fail('備份公積金明細不正確');
    if (ids.has(e.id) || (e.kind === 'deposit' && e.amount <= 0) || (e.kind === 'refund' && (e.amount >= 0 || !e.memberId))) fail('備份公積金明細重複或金額不正確');
    ids.add(e.id);
  }
  const validActor = actor => actor && typeof actor.uid === 'string' && typeof actor.name === 'string';
  for (const [id,h] of Object.entries(state.history)) {
    if (!validId(id) || !h || typeof h.type !== 'string' || typeof h.at !== 'string' || !validActor(h.actor)) fail('備份異動紀錄不正確');
  }
  const expected = clone(state.poolBalances);
  recomputePool(state);
  for (const c of CURRENCIES) if (Math.abs(state.poolBalances[c]-expected[c]) > 0.005) fail('備份公積金明細與餘額不一致');
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
