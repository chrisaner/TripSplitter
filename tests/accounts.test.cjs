const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const policy=require('../functions/access-policy.cjs');
const ledger=require('../js/core/ledger.js');
const owner={uid:'owner',email:'chrisaner@gmail.com',name:'Owner'},alice={uid:'alice',email:'alice@example.com',name:'Alice'},bob={uid:'bob',email:'bob@example.com',name:'Bob'};
const legacy=()=>({state:ledger.financialState({members:[{id:'kris',name:'kris'},{id:'mj',name:'MJ'}],expenses:[],poolBalances:{JPY:5791}}),meta:{createdAt:1}});
const own=()=>policy.reduceRoom(legacy(),{action:'join'},owner,ledger);
const invite=(room,user,role='member')=>policy.reduceRoom(room,{action:'invite',email:user.email,role,memberId:'mj'},owner,ledger);
const join=(room,user)=>policy.reduceRoom(room,{action:'join'},user,ledger);
const operation=(id='expense')=>({id,epoch:0,expectedRevision:0,type:'expense.save',actor:{uid:'forged',name:'forged'},data:{id:'e',title:'Lunch',amount:100,currency:'JPY',time:'2026-10-23T12:00',payer:'kris',split:['kris','mj']}});
test('anonymous and unverified accounts cannot use management API',()=>{
  for(const auth of [null,{uid:'x',token:{}},{uid:'x',token:{email:'a@b.com',email_verified:false}},{uid:'x',token:{email:'a@b.com',email_verified:true,firebase:{sign_in_provider:'anonymous'}}}])assert.throws(()=>policy.identity(auth),e=>e.code==='unauthenticated');
  assert.equal(policy.identity({uid:'x',token:{email:'A@b.com',email_verified:true}}).email,'a@b.com');
});
test('only approved verified owner can claim legacy room without changing financial data',()=>{
  const original=legacy();assert.throws(()=>join(original,alice),e=>e.code==='permission-denied');
  const room=join(original,owner);assert.deepEqual(room.state,original.state);assert.deepEqual(room.meta,original.meta);assert.equal(room.access.users.owner.memberId,'kris');
});
test('invite claim requires exact verified email, preserves role and consumes invitation',()=>{
  const invited=invite(own(),alice,'viewer');assert.throws(()=>join(invited,bob),e=>e.code==='permission-denied');
  const room=join(invited,alice);assert.equal(room.access.users.alice.role,'viewer');assert.equal(Object.keys(room.access.invites).length,0);
  assert.deepEqual(policy.info(room,alice).users.map(u=>u.uid),['alice']);assert.deepEqual(policy.info(room,alice).invites,[]);
});
test('viewer cannot mutate any ledger item or grant access',()=>{
  const room=join(invite(own(),alice,'viewer'),alice);
  for(const input of [{action:'operation',operation:operation()},{action:'invite',email:bob.email,role:'admin'},{action:'removeUser',uid:'owner'}])assert.throws(()=>policy.reduceRoom(room,input,alice,ledger),e=>e.code==='permission-denied');
});
test('member can record expense and deposit but cannot restore backup, purge logs or refund pool',()=>{
  const room=join(invite(own(),alice),alice);
  const changed=policy.reduceRoom(room,{action:'operation',operation:operation()},alice,ledger,'2026-10-23T12:00:00Z');
  assert.equal(changed.state.history.expense.actor.uid,'alice');assert.equal(changed.state.history.expense.actor.name,'MJ');assert.equal(changed.state.history.expense.actor.email,alice.email);assert.equal(changed.state.history.expense.at,'2026-10-23T12:00:00Z');
  for(const op of [{...operation(),type:'history.delete',data:{id:'expense'}},{...operation(),type:'backup.restore'},{...operation(),type:'pool.change',data:{mode:'refund'}},{...operation(),type:'member.save'}])assert.throws(()=>policy.reduceRoom(room,{action:'operation',operation:op},alice,ledger),e=>e.code==='permission-denied');
  const deposited=policy.reduceRoom(room,{action:'operation',operation:{...operation('deposit'),type:'pool.change',data:{mode:'add',currency:'JPY',amount:100}}},alice,ledger);
  assert.equal(deposited.state.poolBalances.JPY,5891);
});
test('account removal revokes next transaction while keeping ledger and historical members',()=>{
  let room=join(invite(own(),alice),alice);const financial=structuredClone(room.state);
  room=policy.reduceRoom(room,{action:'removeUser',uid:'alice'},owner,ledger);assert.deepEqual(room.state,financial);
  assert.throws(()=>policy.reduceRoom(room,{action:'operation',operation:operation()},alice,ledger),e=>e.code==='permission-denied');
  assert.throws(()=>join(room,alice),e=>e.code==='permission-denied');
});
test('owner cannot remove self, admin cannot promote self or alter owner or other admins',()=>{
  let room=join(invite(own(),alice,'admin'),alice);room=join(invite(room,bob,'admin'),bob);
  assert.throws(()=>policy.reduceRoom(room,{action:'removeUser',uid:'owner'},owner,ledger),e=>e.code==='failed-precondition');
  for(const input of [{action:'setUser',uid:'alice',role:'owner'},{action:'removeUser',uid:'owner'},{action:'setUser',uid:'bob',role:'viewer'},{action:'invite',email:'evil@example.com',role:'admin'}])assert.throws(()=>policy.reduceRoom(room,input,alice,ledger));
});
test('backup restore affects financial data only, preserving account access and owner',()=>{
  const room=own();const next=policy.reduceRoom(room,{action:'operation',operation:{...operation('restore'),type:'backup.restore',data:{snapshot:ledger.financialState(legacy().state)}}},owner,ledger);
  assert.deepEqual(next.access,room.access);assert.equal(next.state.epoch,1);
});
test('retries and stale concurrent changes remain safe in cloud-authorized operations',()=>{
  const first=policy.reduceRoom(own(),{action:'operation',operation:operation()},owner,ledger);
  const retry=policy.reduceRoom(first,{action:'operation',operation:operation()},owner,ledger);assert.equal(retry.state.expenses.length,1);
  const edit={...operation('edit'),expectedRevision:1,data:{...operation().data,amount:200}};
  const updated=policy.reduceRoom(first,{action:'operation',operation:edit},owner,ledger);
  assert.throws(()=>policy.reduceRoom(updated,{action:'operation',operation:{...edit,id:'stale'}},owner,ledger),e=>e.code==='failed-precondition');
});
test('server ledger is byte-identical to client domain implementation',()=>{
  assert.equal(fs.readFileSync('functions/ledger.mjs','utf8'),fs.readFileSync('js/core/ledger.js','utf8'));
});
test('account caches never load before login or across accounts and signout preserves only pending recovery data',()=>{
  const values=new Map([
    ['tripSplitterLocalState:alice:private',JSON.stringify({...legacy().state,expenses:[{id:'secret',title:'Secret'}]})],
    ['tripSplitterLocalState:private','legacy private cache'],
    ['tripSplitterOutbox:alice:private:op:pending','pending recovery data']
  ]);
  const context=vm.createContext({URLSearchParams,structuredClone,financialState:ledger.financialState,location:{search:'?room=private'},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}}});
  vm.runInContext(fs.readFileSync('js/state.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),context);
  assert.equal(context.loadLocalState().expenses.length,0);
  context.setLocalUser('alice');assert.equal(context.loadLocalState().expenses[0].title,'Secret');
  context.setLocalUser('bob');assert.equal(context.loadLocalState().expenses.length,0);
  context.clearAccountCache('alice');assert.equal(values.has('tripSplitterLocalState:alice:private'),false);assert.equal(values.has('tripSplitterLocalState:private'),false);
  assert.equal(values.get('tripSplitterOutbox:alice:private:op:pending'),'pending recovery data');
});
