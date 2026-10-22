import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, financialState, settlement, validateAmount, units } from '../js/core/ledger.js';
const base = () => financialState({ members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], expenses: [], poolBalances: { JPY: 1000 } });
let seq = 0;
const op = (type, data, expectedRevision = 0) => ({ id: `op${++seq}`, type, data, expectedRevision, at: '2026-10-22T14:00:00.000Z', actor: { uid: 'test', name: 'A' } });
const expense = (id, payer = 'a', amount = 100, currency = 'JPY') => ({ id, payer, amount, currency, time: '2026-10-22T22:00', title: 'Dinner', split: ['a', 'b', 'c'] });
test('archiving preserves every historical expense and balance', () => {
  let state = applyOperation(base(), op('expense.save', expense('e')));
  const before = structuredClone(state);
  state = applyOperation(state, op('member.archive', { id: 'a', archived: true }));
  assert.deepEqual(state.expenses, before.expenses);
  assert.deepEqual(state.poolBalances, before.poolBalances);
  assert.deepEqual(settlement(state, 'JPY'), settlement(before, 'JPY'));
});
test('independent concurrent inserts preserve both entries in either transaction order', () => {
  const a = op('expense.save', expense('a')), b = op('expense.save', expense('b'));
  for (const [first, second] of [[a,b], [b,a]]) {
    const state = applyOperation(applyOperation(base(), first), second);
    assert.equal(state.expenses.length, 2);
  }
});
test('concurrent pool spending is accumulated and transaction retry is idempotent', () => {
  const a = op('expense.save', expense('a', 'pool', 100)), b = op('expense.save', expense('b', 'pool', 200));
  const state = applyOperation(applyOperation(base(), a), b);
  assert.equal(state.poolBalances.JPY, 700);
  assert.deepEqual(applyOperation(state, a), state);
});
test('stale edit is rejected rather than silently overwriting another edit', () => {
  const initial = applyOperation(base(), op('expense.save', expense('e')));
  const state = applyOperation(initial, op('expense.save', expense('e', 'a', 200), 1));
  assert.throws(() => applyOperation(state, op('expense.save', expense('e', 'b'), 1)), /其他人修改/);
});
test('negative, infinite, unsupported and fractional-yen amounts are rejected', () => {
  for (const amount of [-1, 0, NaN, Infinity, '', null, 1.2]) assert.throws(() => validateAmount(amount, 'JPY'));
  assert.throws(() => validateAmount(10, 'FAKE'));
  assert.equal(validateAmount(1.23, 'USD'), 1.23);
});
test('invalid members, duplicate splits and archived members cannot enter new expenses', () => {
  const state = base();
  for (const patch of [{payer:'missing'}, {split:['a','a']}, {split:[]}, {split:['missing']}, {time:'invalid'}]) {
    assert.throws(() => applyOperation(state, op('expense.save', {...expense('e'), ...patch})));
  }
  state.members[0].archived = true;
  assert.throws(() => applyOperation(state, op('expense.save', expense('e'))), /停用/);
});
test('integer remainder allocation conserves every currency and all transfer balances', () => {
  for (const currency of ['JPY','TWD','KRW','USD','EUR','CNY']) {
    for (let amount = 1; amount <= 130; amount++) {
      const state = base(); state.expenses = [expense('e','a',amount,currency)];
      const {balances, transactions} = settlement(state, currency);
      assert.equal(Object.values(balances).reduce((s,n)=>s+n,0),0);
      const result = {...balances};
      for (const t of transactions) { result[t.from] += units(t.amount,currency); result[t.to] -= units(t.amount,currency); }
      assert.ok(Object.values(result).every(n=>n===0));
      if (currency === 'JPY') assert.ok(transactions.every(t=>Number.isInteger(t.amount)));
    }
  }
});
test('pool spending and adding TWD do not change JPY settlement', () => {
  let state = applyOperation(base(), op('expense.save', expense('j')));
  const before = settlement(state,'JPY');
  state = applyOperation(state, op('expense.save', expense('p','pool',10000)));
  for (let n=0;n<100;n++) state = applyOperation(state, op('expense.save', expense(`t${n}`,'b',100,'TWD')));
  assert.deepEqual(settlement(state,'JPY'),before);
});
