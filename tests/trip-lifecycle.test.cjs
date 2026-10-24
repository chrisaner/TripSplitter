const {test}=require('node:test'),assert=require('node:assert/strict');
const policy=require('../functions/access-policy.cjs'),ledger=require('../js/core/ledger.js'),life=require('../functions/trip-lifecycle.cjs');
const owner={uid:'o',email:'owner@example.com',name:'Owner'},admin={uid:'a',email:'admin@example.com',name:'Admin'},member={uid:'m',email:'member@example.com',name:'Member'},outsider={uid:'x',email:'x@example.com',name:'X'};
const now='2026-10-24T00:00:00.000Z';
function base(){return {state:ledger.financialState({members:[{id:'a',name:'A'},{id:'b',name:'B'}],expenses:[{id:'e',title:'Dinner',payer:'a',split:['a','b'],currency:'JPY',amount:100,time:'2026-10-24T10:00',_rev:1}],poolBalances:{JPY:5791}}),meta:{createdAt:now},access:{ownerUid:'o',users:{o:{role:'owner',email:owner.email},a:{role:'admin'},m:{role:'member'}},invites:{invite:{email:'future@example.com'}}}};}
const deletion=(room,patch={})=>({action:'deleteRoom',roomId:'trip',confirmation:'trip',requestId:'delete1',expectedRevision:room.state.revision,expectedEpoch:room.state.epoch,...patch});
const run=(room,input,user=owner,time=now)=>policy.reduceRoom(room,input,user,ledger,time);
test('only actual owner can delete and restore; admins and forged owners cannot',()=>{
  const room=base(),del=deletion(room);
  for(const user of [admin,member,outsider])assert.throws(()=>run(room,del,user),e=>e.code==='permission-denied');
  const deleted=run(room,del);
  for(const user of [admin,member,outsider])assert.throws(()=>run(deleted,{action:'restoreRoom',deletionId:'delete1'},user),e=>e.code==='permission-denied');
  room.access.users.a.role='owner';assert.throws(()=>run(room,del,admin),e=>e.code==='permission-denied');
});
test('typed code, revision and epoch prevent stale or accidental journey deletion',()=>{
  const room=base();for(const patch of [{confirmation:'other'},{requestId:'../bad'},{expectedRevision:3},{expectedEpoch:1},{expectedRevision:undefined}])assert.throws(()=>run(room,deletion(room,patch)));
});
test('delete keeps all finance and membership, fixes deadline and is idempotent',()=>{
  const room=base(),del=deletion(room),deleted=run(room,del),d=deleted.meta.deletion;
  assert.equal(d.purgeAfter-Date.parse(now),life.RETENTION_MS);assert.equal(deleted.state.epoch,1);assert.equal(deleted.state.revision,1);
  for(const key of ['expenses','members','poolBalances','poolEntries','settlementSettings','repayments'])assert.deepEqual(deleted.state[key],room.state[key]);assert.deepEqual(deleted.access,room.access);
  assert.deepEqual(run(deleted,del,owner,'2026-10-25T00:00:00Z'),deleted);
  assert.throws(()=>run(deleted,{...del,requestId:'new-delete'}),/已刪除/);
});
test('all reads and mutations are rejected while deleted, including old owner claims and backup restore',()=>{
  const deleted=run(base(),deletion(base()));
  for(const user of [owner,admin,member]){
    assert.throws(()=>policy.member(deleted,user),/已刪除/);assert.throws(()=>policy.info(deleted,user),/已刪除/);
    for(const action of ['join','invite','operation','removeUser'])assert.throws(()=>run(deleted,{action},user),/已刪除/);
  }
});
test('restore before exact deadline preserves finance and rejects queued pre-delete operations',()=>{
  const room=base(),deleted=run(room,deletion(room)),restored=run(deleted,{action:'restoreRoom',roomId:'trip',deletionId:'delete1'},owner,'2026-11-22T23:59:59Z');
  assert.equal(restored.meta.deletion,undefined);assert.equal(restored.state.epoch,2);assert.deepEqual(restored.state.expenses,room.state.expenses);assert.deepEqual(restored.access,room.access);
  assert.deepEqual(run(restored,{action:'restoreRoom',deletionId:'delete1'}),restored);
  assert.throws(()=>run(restored,{action:'operation',operation:{id:'old',epoch:0,expectedRevision:1,type:'expense.delete',data:{id:'e'}}}),/還原備份/);
});
test('expiry, in-progress purge and old delete generations cannot be restored',()=>{
  const deleted=run(base(),deletion(base()));
  assert.throws(()=>run(deleted,{action:'restoreRoom',deletionId:'wrong'}),/版本/);
  assert.throws(()=>run(deleted,{action:'restoreRoom',deletionId:'delete1'},owner,new Date(deleted.meta.deletion.purgeAfter).toISOString()),/期限/);
  deleted.meta.deletion.status='purging';assert.throws(()=>run(deleted,{action:'restoreRoom',deletionId:'delete1'}),/清除/);
});
test('purger eligibility never includes active rooms or premature/invalid deletion markers',()=>{
  const room=base(),deleted=run(room,deletion(room)),at=deleted.meta.deletion.purgeAfter;
  assert.equal(life.due(room,at),false);assert.equal(life.due(deleted,at-1),false);assert.equal(life.due(deleted,at),true);
  const corrupt=structuredClone(deleted);corrupt.meta.deletion.purgeAfter=Date.parse(now)+1;assert.equal(life.due(corrupt,at),false);
  assert.throws(()=>run({meta:{retiredAt:at}},{action:'create'}),/永久停用/);
});
