import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,financialState,expenseAllocation,settlement,settlementReport,validateSnapshot,units} from '../js/core/ledger.js';
import {createBackup,parseBackup,exportCsv} from '../js/core/backup.js';
import {tripReportHtml} from '../js/ui/tripReport.js';
import policy from '../functions/access-policy.cjs';
const base=()=>financialState({members:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],expenses:[],poolBalances:{JPY:1000}});
const expense=(patch={})=>({id:'e',title:'Dinner',amount:101,currency:'JPY',payer:'a',split:['a','b','c'],time:'2026-10-23T12:00',...patch});
let n=0;const op=(type,data,expectedRevision=0)=>({id:'t'+ ++n,type,data,expectedRevision,epoch:0,at:'2026-10-23T12:00:00Z',actor:{uid:'owner',name:'Owner'}});
const save=(s,e)=>applyOperation(s,op('expense.save',e));
const cross=s=>applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{TWD:1,JPY:0.22}},s.revision));
test('all split modes and multiple payers conserve smallest currency units',()=>{
  for(const currency of ['JPY','USD'])for(const amount of [1,101,1234])for(const [splitMode,splitValues] of [['equal',{}],['percent',{a:33.33,b:33.33,c:33.34}],['shares',{a:1,b:2,c:3}],['amount',{a:amount,b:0,c:0}]]) {
    const e=expense({currency,amount,splitMode,splitValues,payers:{a:amount-1,b:1}}),s=save(base(),e),allocation=expenseAllocation(e,s);
    assert.equal(Object.values(allocation.owed).reduce((a,b)=>a+b),units(amount,currency));
    assert.equal(Object.values(settlement(s,currency).balances).reduce((a,b)=>a+b),0);
  }
});
test('custom totals, precision, invalid weights and pool mixtures are rejected',()=>{
  for(const patch of [{splitMode:'amount',splitValues:{a:1,b:1,c:1}},{splitMode:'percent',splitValues:{a:30,b:30,c:30}},{splitMode:'shares',splitValues:{a:0,b:0,c:0}},{splitMode:'shares',splitValues:{a:-1,b:1,c:1}},{payers:{a:100}},{payer:'pool',payers:{a:101}},{payers:{missing:101}},{splitMode:'amount',splitValues:{a:100.5,b:.5,c:0}}])assert.throws(()=>save(base(),expense(patch)));
  const s=base();s.members[1].archived=true;assert.throws(()=>save(s,expense({split:['a'],payers:{a:50,b:51}})),/停用/);
});
test('cross currency uses fixed rates, conserves rounding and retains original amounts',()=>{
  let s=save(base(),expense({amount:100,split:['a','b']}));s=save(s,expense({id:'twd',currency:'TWD',payer:'b',amount:20,split:['a','b']}));
  const original=structuredClone(s.expenses);s=cross(s);
  assert.deepEqual(settlementReport(s)[0].balances,{a:1,b:-1,c:0});assert.deepEqual(s.expenses,original);
  assert.throws(()=>applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{TWD:1}},s.revision)),/JPY/);
  assert.throws(()=>applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{TWD:1,JPY:0}},s.revision)),/匯率/);
  s=save(base(),expense({amount:1,split:['a','b']}));s=applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{TWD:1,JPY:100}},s.revision));
  assert.deepEqual(settlementReport(s)[0].balances,{a:50,b:-50,c:0});
});
test('partial repayment is reserved pending, deducted only on receipt and cancellation reverses it',()=>{
  let s=save(base(),expense({amount:100,split:['a','b']}));
  s=applyOperation(s,op('repayment.save',{id:'r',from:'b',to:'a',amount:20,currency:'JPY'}));
  assert.equal(settlementReport(s)[0].balances.b,-50);
  assert.throws(()=>applyOperation(s,op('repayment.save',{id:'r2',from:'b',to:'a',amount:31,currency:'JPY'})),/超過/);
  assert.throws(()=>cross(s),/鎖定/);
  const confirm=op('repayment.confirm',{id:'r'},1);s=applyOperation(s,confirm);assert.equal(settlementReport(s)[0].balances.b,-30);
  assert.deepEqual(applyOperation(s,confirm),s);
  assert.throws(()=>applyOperation(s,op('repayment.cancel',{id:'r'},1)),/變更/);
  s=applyOperation(s,op('repayment.cancel',{id:'r'},2));assert.equal(settlementReport(s)[0].balances.b,-50);assert.ok(cross(s));
});
test('new data survives JSON round trip, CSV and escaped report includes personal and pool details',()=>{
  let s=save(base(),expense({splitMode:'shares',splitValues:{a:1,b:2,c:3},payers:{a:51,b:50}}));s=cross(s);
  s=applyOperation(s,op('pool.change',{mode:'refund',amount:100,currency:'JPY',memberId:'a',note:'refund'}));
  s=applyOperation(s,op('repayment.save',{id:'r',from:'c',to:'a',amount:1,currency:'TWD'}));
  const round=parseBackup(JSON.stringify(createBackup(s,'qa'))).data;assert.deepEqual(round.settlementSettings,s.settlementSettings);assert.deepEqual(round.repayments,s.repayments);assert.deepEqual(settlementReport(round),settlementReport(s));
  const csv=exportCsv(s);assert.match(csv,/還款/);assert.match(csv,/固定匯率/);
  s.members[0].name='<script>alert(1)</script>';const html=tripReportHtml(s,'<x>');assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);assert.match(html,/個人明細/);assert.match(html,/公積金收支與退款/);
  const bad=structuredClone(s);bad.repayments[0].from='missing';assert.throws(()=>validateSnapshot(bad));
});
test('server enforces who may record, confirm, cancel and change currency settings',()=>{
  const users={owner:{role:'owner',memberId:'a'},payer:{role:'member',memberId:'b'},payee:{role:'member',memberId:'a'},third:{role:'member',memberId:'c'},viewer:{role:'viewer',memberId:'b'}};
  const user=id=>({uid:id,email:id+'@example.com',name:id});
  let room={state:save(base(),expense({amount:100,split:['a','b']})),access:{ownerUid:'owner',users}};
  const run=(id,operation)=>policy.reduceRoom(room,{action:'operation',operation},user(id),{applyOperation});
  const payment=op('repayment.save',{id:'r',from:'b',to:'a',amount:20,currency:'JPY'});
  for(const id of ['third','payee','viewer'])assert.throws(()=>run(id,payment),e=>e.code==='permission-denied');
  room=run('payer',payment);assert.equal(room.state.repayments[0].actor.uid,'payer');
  const confirmation=op('repayment.confirm',{id:'r'},1);
  assert.throws(()=>run('payer',confirmation),e=>e.code==='permission-denied');assert.throws(()=>run('third',confirmation),e=>e.code==='permission-denied');
  room=run('payee',confirmation);assert.equal(room.state.repayments[0].status,'confirmed');
  assert.throws(()=>run('payer',op('repayment.cancel',{id:'r'},2)),e=>e.code==='permission-denied');
  room=run('owner',op('repayment.cancel',{id:'r'},2));assert.equal(room.state.repayments[0].status,'cancelled');
  assert.throws(()=>run('payer',op('settlement.settings',{},room.state.revision)),e=>e.code==='permission-denied');
});

test('frozen rates allow adding a currency but reject revaluation and stale setting writes',()=>{
  let s=cross(save(base(),expense({amount:100,split:['a','b']})));
  s=applyOperation(s,op('repayment.save',{id:'r',from:'b',to:'a',amount:1,currency:'TWD'}));
  assert.throws(()=>applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{TWD:1,JPY:.3}},s.revision)),/鎖定/);
  const extended=applyOperation(s,op('settlement.settings',{currency:'TWD',rates:{...s.settlementSettings.rates,USD:32}},s.revision));
  assert.equal(extended.settlementSettings.rates.USD,32);
  assert.deepEqual(settlementReport(extended),settlementReport(s));
  assert.throws(()=>applyOperation(extended,op('settlement.settings',{currency:'TWD',rates:extended.settlementSettings.rates},s.revision)),/變更/);
});
test('backup restore preserves split, fixed rates, repayments, balances and epoch barrier',()=>{
  let s=cross(save(base(),expense({amount:100,split:['a','b'],splitMode:'percent',splitValues:{a:30,b:70},payers:{a:60,b:40}})));
  s=applyOperation(s,op('repayment.save',{id:'r',from:'b',to:'a',amount:2,currency:'TWD'}));
  s=applyOperation(s,op('repayment.confirm',{id:'r'},1));
  const restored=applyOperation(s,op('backup.restore',{snapshot:parseBackup(JSON.stringify(createBackup(s,'qa'))).data},s.revision));
  assert.deepEqual(settlementReport(restored),settlementReport(s));assert.equal(restored.epoch,1);
  assert.throws(()=>applyOperation(restored,op('repayment.cancel',{id:'r'},2)),/還原/);
});
test('old client edits cannot silently erase new split modes or multiple payers',()=>{
  let s=save(base(),expense({splitMode:'shares',splitValues:{a:1,b:2,c:3},payers:{a:51,b:50}}));
  assert.throws(()=>applyOperation(s,op('expense.save',expense({title:'old client edit'}),1)),/重新整理/);
  s=applyOperation(s,op('expense.save',expense({splitMode:'equal',splitValues:{},payers:null}),1));
  assert.equal(s.expenses[0].splitMode,'equal');assert.equal(s.expenses[0].payers,null);
});
