const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {financialState,applyOperation} = require('../js/core/ledger.js');
const strip = file => fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const initial = () => financialState({members:[{id:'a',name:'A'},{id:'b',name:'B'}],expenses:[],poolBalances:{JPY:1000}});
const expense = id => ({id,title:id,amount:100,currency:'JPY',payer:'pool',split:['a','b'],time:'2026-10-22T22:00'});
function server() { return {value:{state:initial(),meta:{createdAt:123}},listeners:[],fail:false}; }
function client(db, storage = new Map()) {
  const context = vm.createContext({
    state:initial(),DEFAULT_STATE:initial(),crypto:require('node:crypto').webcrypto,JSON,URL,Date,
    location:{href:'https://example.com/?room=test'},history:{replaceState(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),get length(){return storage.size;},key:i=>[...storage.keys()][i]},
    document:{getElementById:()=>null},db:{},auth:{},setTimeout:()=>0,clearTimeout(){},
    financialState,applyOperation,mergeState:financialState,setLocalRoom(){},saveLocalState(){},notify(){},
    setState:next=>{context.state=next;},sanitizeRoomId:x=>x,getShareUrl:x=>x,
    showToast(){},reportError(){},ref:(_,path)=>path,off(){},
    signInAnonymously:async()=>({user:{uid:require('node:crypto').randomUUID()}}),
    get:async()=>({exists:()=>true,val:()=>structuredClone(db.value)}),
    onValue:(path,cb)=>{if(path==='.info/connected'){cb({val:()=>true});}else{db.listeners.push(cb);cb({val:()=>structuredClone(db.value)});}},
    runTransaction:async(path,fn)=>{
      if(db.fail) throw new Error('network failure');
      const next=fn(structuredClone(db.value));
      if(next===undefined)return {committed:false};
      db.value=next;
      for(const cb of db.listeners)cb({val:()=>structuredClone(db.value)});
      return {committed:true,snapshot:{val:()=>structuredClone(db.value)}};
    }
  });
  vm.runInContext(strip('js/services/syncService.js'),context);
  return {context,storage,call:code=>vm.runInContext(code,context),start:async()=>{await context.initFirebaseAuth();await context.joinRoom('test');}};
}
test('two real sync controllers merge concurrent entries and preserve room metadata',async()=>{
  const db=server(),a=client(db),b=client(db);await a.start();await b.start();
  a.context.entry=expense('one');b.context.entry=expense('two');
  a.call("dispatchOperation('expense.save',entry)");b.call("dispatchOperation('expense.save',entry)");
  await Promise.all([a.context.syncToCloud(),b.context.syncToCloud()]);
  assert.equal(db.value.state.expenses.length,2);assert.equal(db.value.state.poolBalances.JPY,800);
  assert.equal(db.value.meta.createdAt,123);assert.equal(a.context.getSyncContext().pendingCount,0);
});
test('failed synchronization survives reload and retries once without duplicate spending',async()=>{
  const db=server(),a=client(db);await a.start();a.context.entry=expense('one');a.call("dispatchOperation('expense.save',entry)");
  db.fail=true;await a.context.syncToCloud();assert.equal(a.context.getSyncContext().status,'error');
  const reloaded=client(db,a.storage);await reloaded.start();assert.equal(reloaded.context.getSyncContext().pendingCount,1);
  db.fail=false;await reloaded.context.syncToCloud();await reloaded.context.syncToCloud();
  assert.equal(db.value.state.expenses.length,1);assert.equal(db.value.state.poolBalances.JPY,900);
});
test('stale concurrent edit is retained as conflict and never overwrites cloud',async()=>{
  const db=server();db.value.state=applyOperation(db.value.state,{id:'seed',type:'expense.save',data:expense('e'),expectedRevision:0});
  const a=client(db),b=client(db);await a.start();await b.start();
  a.context.entry={...expense('e'),amount:200};b.context.entry={...expense('e'),amount:300};
  a.call("dispatchOperation('expense.save',entry,1)");b.call("dispatchOperation('expense.save',entry,1)");
  await a.context.syncToCloud();await b.context.syncToCloud();
  assert.equal(db.value.state.expenses[0].amount,200);assert.equal(b.context.getSyncContext().status,'conflict');
  assert.equal(b.context.getSyncContext().pendingCount,1);
});
test('member creation and archive dispatch operations for automatic cloud synchronization',()=>{
  const calls=[];let state={...initial(),editingMemberId:null};
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,getState:()=>state,showToast(){},dispatchOperation:(...args)=>{calls.push(args);state=applyOperation(state,{id:`op${calls.length}`,type:args[0],data:args[1],expectedRevision:args[2]});return true;}});
  vm.runInContext(strip('js/services/memberService.js'),context);
  assert.equal(context.saveCurrentMember('New','🙂'),true);assert.equal(context.deleteMemberById('a'),true);
  assert.deepEqual(calls.map(c=>c[0]),['member.save','member.archive']);
});

test('editing before initial room load is blocked rather than treated as a local-only change',()=>{
  const a=client(server());a.context.entry=expense('early');
  assert.throws(()=>a.call("dispatchOperation('expense.save',entry)"),/尚未讀取完成/);
});
test('two tabs sharing localStorage cannot overwrite each others durable outbox',async()=>{
  const db=server(),storage=new Map(),a=client(db,storage),b=client(db,storage);await a.start();await b.start();
  a.context.entry=expense('a');b.context.entry=expense('b');
  a.call("dispatchOperation('expense.save',entry)");b.call("dispatchOperation('expense.save',entry)");
  const reloaded=client(db,storage);await reloaded.start();
  assert.equal(reloaded.context.getSyncContext().pendingCount,2);
  await reloaded.context.syncToCloud();assert.equal(db.value.state.expenses.length,2);
});
