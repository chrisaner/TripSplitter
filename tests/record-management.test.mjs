import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { financialState, applyOperation, money, settlement } from '../js/core/ledger.js';
import { recordPage, HISTORY_PAGE_SIZE, TRASH_PAGE_SIZE } from '../js/core/recordPages.js';
import { escapeHtml } from '../js/utils.js';

let sequence=0;
const op=(type,data,expectedRevision=0)=>({id:`cleanup-${++sequence}`,type,data,expectedRevision,at:'2026-10-22T14:00:00Z',actor:{uid:'test',name:'A'}});
const initial=()=>financialState({members:[{id:'a',name:'A'},{id:'b',name:'B'}],expenses:[],poolBalances:{JPY:1000}});
const expense=id=>({id,payer:'pool',split:['a','b'],title:id,amount:100,currency:'JPY',time:'2026-10-22T22:00'});
const dates=n=>`2026-10-22T14:00:${String(n).padStart(2,'0')}.000Z`;
test('history pagination shows latest ten and recovery pagination shows latest five without deleting records',()=>{
  const records=Array.from({length:12},(_,i)=>({id:String(i),at:dates(i),_deletedAt:dates(i)}));
  const before=structuredClone(records);
  assert.equal(recordPage(records,0,HISTORY_PAGE_SIZE,'at').items.length,10);
  assert.equal(recordPage(records,1,HISTORY_PAGE_SIZE,'at').items.length,2);
  assert.equal(recordPage(records,0,TRASH_PAGE_SIZE,'_deletedAt').items.length,5);
  assert.equal(recordPage(records,0,HISTORY_PAGE_SIZE,'at').items[0].id,'11');
  assert.deepEqual(records,before);
});
test('deleting a history record changes neither accounting nor pool and retries never recreate it',()=>{
  const entry=op('expense.save',expense('e'));
  const before=applyOperation(initial(),entry);
  const deletion=op('history.delete',{id:entry.id});
  const after=applyOperation(before,deletion);
  assert.equal(Object.keys(after.history).length,0);
  for(const field of ['expenses','members','poolBalances','poolEntries','poolOpening','trash'])assert.deepEqual(after[field],before[field]);
  assert.deepEqual(applyOperation(after,deletion),after);
  assert.deepEqual(applyOperation(after,entry),after);
});
test('removing recovery record keeps balance and deletion barrier, and prevents stale restoration',()=>{
  let state=applyOperation(initial(),op('expense.save',expense('e')));
  state=applyOperation(state,op('expense.delete',{id:'e'},1));
  const before=structuredClone(state);
  const purge=op('trash.delete',{id:'e'},2);
  state=applyOperation(state,purge);
  assert.equal(state.trash.length,0);assert.deepEqual(state.poolBalances,before.poolBalances);
  assert.deepEqual(state.history,before.history);assert.deepEqual(state.expenses,before.expenses);
  assert.equal(state.tombstones.e,2);
  assert.throws(()=>applyOperation(state,op('expense.restore',{id:'e'},2)),/已變更/);
  assert.throws(()=>applyOperation(state,op('expense.save',expense('e'))),/已刪除/);
  assert.deepEqual(applyOperation(state,purge),state);
});
test('if another device restored an expense first, removing its old recovery row cannot delete it',()=>{
  let state=applyOperation(initial(),op('expense.save',expense('e')));
  state=applyOperation(state,op('expense.delete',{id:'e'},1));
  state=applyOperation(state,op('expense.restore',{id:'e'},2));
  assert.throws(()=>applyOperation(state,op('trash.delete',{id:'e'},2)),/已復原/);
  assert.equal(state.expenses.length,1);assert.equal(state.poolBalances.JPY,900);
});
test('concurrent cleanup and a new expense preserve both changes in either order',()=>{
  const seed=op('expense.save',expense('original'));
  const state=applyOperation(initial(),seed);
  const cleanup=op('history.delete',{id:seed.id}), add=op('expense.save',expense('new'));
  for(const [first,second] of [[cleanup,add],[add,cleanup]]) {
    const result=applyOperation(applyOperation(state,first),second);
    assert.equal(result.expenses.length,2);assert.equal(result.poolBalances.JPY,800);
    assert.equal(result.history[seed.id],undefined);assert.ok(result.history[add.id]);
  }
});
test('actual management renderer caps rows, pages correctly, and clamps after last-row deletion',()=>{
  const state=initial();
  state.history=Object.fromEntries(Array.from({length:12},(_,i)=>[`h${i}`,{id:`h${i}`,type:'expense.save',at:dates(i),actor:{uid:'test',name:'<img src=x>'},after:{title:`History ${i}`}}]));
  state.trash=Array.from({length:8},(_,i)=>({...expense(`t${i}`),_deletedAt:dates(i)}));
  const before=JSON.stringify(state);
  const elements=Object.fromEntries(['audit-list','trash-list','audit-pagination','trash-pagination'].map(id=>[id,{innerHTML:''}]));
  const context=vm.createContext({state,recordPage,HISTORY_PAGE_SIZE,TRASH_PAGE_SIZE,money,settlement,escapeHtml,getSyncContext:()=>({currentRoomId:'test',pendingCount:0}),document:{getElementById:id=>elements[id]||null}});
  const source=readFileSync(new URL('../js/ui/managementUI.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  vm.runInContext(source,context);context.renderManagement();
  const count=(id,attribute)=>(elements[id].innerHTML.match(new RegExp(attribute+'=','g'))||[]).length;
  assert.equal(count('audit-list','data-history-delete-id'),10);
  assert.equal(count('trash-list','data-trash-delete-id'),5);
  assert.match(elements['audit-list'].innerHTML,/History 11/);assert.doesNotMatch(elements['audit-list'].innerHTML,/<img/);
  vm.runInContext('historyPage=1;trashPage=1;renderManagement();',context);
  assert.equal(count('audit-list','data-history-delete-id'),2);assert.equal(count('trash-list','data-trash-delete-id'),3);
  assert.equal(JSON.stringify(state),before);
  state.history={h0:state.history.h0};state.trash=state.trash.slice(0,1);context.renderManagement();
  assert.equal(count('audit-list','data-history-delete-id'),1);assert.equal(count('trash-list','data-trash-delete-id'),1);
  assert.match(elements['audit-pagination'].innerHTML,/第 1 \/ 1 頁/);
});
