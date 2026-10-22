const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { settlement, money } = require('../js/core/ledger.js');
const { escapeHtml } = require('../js/utils.js');

// Exercise the production renderer without importing Firebase or writing any accounts.
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const settleSource = source.slice(
  source.indexOf('export function calculateSettle()'),
  source.indexOf('export function startPoolRotation()'),
).replace('export function', 'function');

const expense = (currency, payer, amount) => ({ currency, payer, amount, split: ['a', 'b'] });
function render(expenses, filter = 'all') {
  const state = { members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], expenses };
  const before = JSON.stringify(state);
  const container = { innerHTML: '' };
  const context = vm.createContext({
    state, settlement, money, escapeHtml,
    document: { getElementById: id => id === 'settle-currency-groups' ? container : { value: filter } },
    reportError: error => { throw error; },
  });
  vm.runInContext(`${settleSource}\ncalculateSettle();`, context);
  assert.equal(JSON.stringify(state), before, 'Rendering must not change financial records');
  return container.innerHTML;
}

test('JPY personal advances survive large pool spending', () => {
  const html = render([expense('JPY', 'a', 400), expense('JPY', 'pool', 100000)]);
  assert.match(html, /JPY 結算區/);
  assert.match(html, /200 JPY/);
  assert.match(html, /B ➜ A/);
});

test('100 added TWD expenses leave JPY settlement unchanged', () => {
  const expenses = [expense('JPY', 'a', 400), expense('JPY', 'pool', 100000)];
  for (let i = 0; i < 100; i++) expenses.push(expense('TWD', 'b', 100));
  const html = render(expenses);
  assert.match(html, /200 JPY/);
  assert.match(html, /5,000 TWD/);
});

test('pool-only currency stays visible with an explanation', () => {
  const html = render([expense('JPY', 'pool', 1000)]);
  assert.match(html, /JPY 結算區/);
  assert.match(html, /皆由公積金支付，無須個人轉帳/);
  assert.doesNotMatch(html, /➜/);
});

test('balanced personal advances retain the currency heading', () => {
  const html = render([expense('JPY', 'a', 400), expense('JPY', 'b', 400)]);
  assert.match(html, /JPY 結算區/);
  assert.match(html, /此幣別無須個人轉帳/);
});

test('payer filter shows only outgoing payments and keeps empty currencies', () => {
  const expenses = [expense('JPY', 'a', 400), expense('TWD', 'b', 100)];
  const html = render(expenses, 'a');
  assert.match(html, /JPY 結算區/);
  assert.match(html, /該成員在此幣別無須支付款項/);
  assert.doesNotMatch(html, /200 JPY/);
  assert.match(html, /50 TWD/);
  assert.match(render(expenses, 'b'), /200 JPY/);
});

test('empty ledger explains that no settlement data exists', () => {
  assert.match(render([]), /暫無結算資料/);
});

test('settlement renderer escapes names and emojis', () => {
  const state = {members:[{id:'a',name:'<img src=x onerror=alert(1)>',emoji:'<svg onload=alert(2)>'},{id:'b',name:'B'}],expenses:[expense('JPY','a',400)]};
  const container = {innerHTML:''};
  const context = vm.createContext({state, settlement, money, escapeHtml, document:{getElementById:id=>id==='settle-currency-groups'?container:{value:'all'}}});
  vm.runInContext(settleSource+'\ncalculateSettle();',context);
  assert.doesNotMatch(container.innerHTML, /<img|<svg/);
  assert.match(container.innerHTML, /&lt;img/);
});
