import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financialState, applyOperation, validateSnapshot, settlement } from '../js/core/ledger.js';
import { createBackup, parseBackup, exportCsv } from '../js/core/backup.js';
let sequence=0;
const op=(type,data,expectedRevision=0)=>({id:`op${++sequence}`,type,data,expectedRevision,at:'2026-10-22T14:00:00.000Z',actor:{uid:'device-a',name:'A'}});
const initial=()=>financialState({members:[{id:'a',name:'A'},{id:'b',name:'B'}],expenses:[],poolBalances:{JPY:1000}});
const expense=(id,payer='pool',amount=100)=>({id,payer,amount,currency:'JPY',title:'Dinner',time:'2026-10-22T22:00',split:['a','b']});
test('legacy migration preserves actual balance and distinguishes unattributed historical opening',()=>{
  const state=financialState({members:initial().members,expenses:[expense('old')],poolBalances:{JPY:900}});
  assert.equal(state.poolOpening.JPY,1000);assert.equal(state.poolBalances.JPY,900);
  assert.equal(state.poolEntries.length,0);assert.equal(Object.keys(state.history).length,0);
  assert.deepEqual(financialState(state),state);
});
test('deposit, spending, refund, adjustment, edit, deletion and restore reconcile the ledger',()=>{
  let state=applyOperation(initial(),op('pool.change',{mode:'add',amount:200,currency:'JPY',memberId:'a',note:'A deposit'}));
  state=applyOperation(state,op('expense.save',expense('e')));
  state=applyOperation(state,op('pool.change',{mode:'refund',amount:300,currency:'JPY',memberId:'b',note:'Trip end'}));
  assert.equal(state.poolBalances.JPY,800);
  state=applyOperation(state,op('pool.change',{mode:'set',amount:850,previousBalance:800,currency:'JPY',note:'Cash count'}));
  assert.equal(state.poolEntries.at(-1).amount,50);
  state=applyOperation(state,op('expense.save',expense('e','pool',150),1));assert.equal(state.poolBalances.JPY,800);
  state=applyOperation(state,op('expense.delete',{id:'e'},2));assert.equal(state.poolBalances.JPY,950);assert.equal(state.trash.length,1);
  state=applyOperation(state,op('expense.restore',{id:'e'},3));assert.equal(state.poolBalances.JPY,800);assert.equal(state.trash.length,0);
  assert.equal(Object.keys(state.history).length,7);
});
test('refunds cannot overdraw even when two clients act on the same starting balance',()=>{
  const a=op('pool.change',{mode:'refund',amount:800,currency:'JPY',memberId:'a'});
  const b=op('pool.change',{mode:'refund',amount:800,currency:'JPY',memberId:'b'});
  const state=applyOperation(initial(),a);assert.equal(state.poolBalances.JPY,200);
  assert.throws(()=>applyOperation(state,b),/不可超過/);
  assert.throws(()=>applyOperation(initial(),op('pool.change',{mode:'refund',amount:100,currency:'JPY'})),/指定成員/);
  assert.throws(()=>applyOperation(initial(),op('pool.change',{mode:'set',amount:100,previousBalance:1000,currency:'JPY'})),/原因/);
});
test('audit keeps complete before/after values and actor; transaction retries add no duplicate logs',()=>{
  const a=op('expense.save',expense('e','a'));
  let state=applyOperation(initial(),a);
  const b=op('expense.save',expense('e','a',200),1);state=applyOperation(state,b);
  assert.equal(state.history[b.id].before.amount,100);assert.equal(state.history[b.id].after.amount,200);
  assert.equal(state.history[b.id].actor.uid,'device-a');
  assert.deepEqual(applyOperation(state,b),state);
});
test('deleted advances restore the original payer, split and archived member with no duplicate refund',()=>{
  let state=applyOperation(initial(),op('expense.save',expense('e','a')));
  const balance=settlement(state,'JPY');
  state=applyOperation(state,op('expense.delete',{id:'e'},1));
  assert.throws(()=>applyOperation(state,op('expense.save',expense('e','a'))),/已刪除/);
  state=applyOperation(state,op('member.archive',{id:'a',archived:true}));
  const restore=op('expense.restore',{id:'e'},2);state=applyOperation(state,restore);
  assert.deepEqual(settlement(state,'JPY'),balance);assert.equal(state.expenses[0].payer,'a');
  assert.deepEqual(applyOperation(state,restore),state);
  assert.throws(()=>applyOperation(state,op('expense.restore',{id:'e'},2)),/已變更/);
});
test('JSON round trip includes trash, pool entries and history and rejects broken formats',()=>{
  let state=applyOperation(initial(),op('expense.save',expense('e')));
  state=applyOperation(state,op('expense.delete',{id:'e'},1));
  const backup=createBackup(state,'test-room');
  assert.deepEqual(parseBackup(JSON.stringify(backup)).data,validateSnapshot(state));
  for(const text of ['{', '{}', JSON.stringify({...backup,version:99})]) assert.throws(()=>parseBackup(text));
  const invalid=structuredClone(backup);invalid.data.poolBalances.JPY=123;
  assert.throws(()=>parseBackup(JSON.stringify(invalid)),/不一致/);
  const duplicate=structuredClone(backup);duplicate.data.members.push({...duplicate.data.members[0]});
  assert.throws(()=>parseBackup(JSON.stringify(duplicate)),/重複/);
});
test('restore is atomic, version checked and retains the current audit trail',()=>{
  const backup=initial();let state=applyOperation(initial(),op('expense.save',expense('new')));
  const history=Object.keys(state.history);
  assert.throws(()=>applyOperation(state,op('backup.restore',{snapshot:backup},0)),/預覽後/);
  state=applyOperation(state,op('backup.restore',{snapshot:backup},state.revision));
  assert.equal(state.expenses.length,0);assert.ok(history.every(id=>state.history[id]));
  assert.throws(()=>applyOperation(state,op('expense.save',expense('new'),1)),/已刪除/);
});
test('CSV quotes delimiters, line breaks, formulas and includes deleted and pool records',()=>{
  let state=applyOperation(initial(),op('expense.save',{...expense('e'),title:'=1+1,"quoted"\nnext'}));
  state=applyOperation(state,op('pool.change',{mode:'refund',currency:'JPY',amount:10,memberId:'a'}));
  state=applyOperation(state,op('expense.delete',{id:'e'},1));
  const csv=exportCsv(state);
  assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/'=1\+1,""quoted""/);
  assert.match(csv,/已刪除/);assert.match(csv,/退款/);assert.match(csv,/公積金歷史期初/);
});

test('restoring old trash cannot reuse a prior revision and admit a stale edit',()=>{
  const original=applyOperation(initial(),op('expense.save',expense('e','a')));
  const oldBackup=applyOperation(original,op('expense.delete',{id:'e'},1));
  let current=applyOperation(original,op('expense.save',expense('e','a',200),1));
  current=applyOperation(current,op('expense.save',expense('e','a',300),2));
  current=applyOperation(current,op('backup.restore',{snapshot:oldBackup},current.revision));
  current=applyOperation(current,op('expense.restore',{id:'e'},current.tombstones.e));
  assert.ok(current.expenses[0]._rev>3);
  assert.throws(()=>applyOperation(current,op('expense.save',expense('e','a',999),3)),/其他人修改/);
});
test('backup restore rejects all queued pre-restore operations, including legacy revision zero',()=>{
  const stale={...op('member.save',{id:'a',name:'Stale',emoji:'🙂'}),epoch:0};
  const state=applyOperation(initial(),op('backup.restore',{snapshot:initial()},0));
  assert.equal(state.epoch,1);
  assert.throws(()=>applyOperation(state,stale),/已還原備份/);
});
