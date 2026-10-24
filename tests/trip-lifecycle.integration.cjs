const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const {purgeRoom}=require('../functions/trip-cleanup-service.cjs');const {RETENTION_MS}=require('../functions/trip-lifecycle.cjs');
const ledger=require('../js/core/ledger.js');
test('real Firebase trip lifecycle: owner delete, access revoked, restore, expiry and receipt/OCR cleanup',{skip:!process.env.FIREBASE_AUTH_EMULATOR_HOST,timeout:120000},async()=>{
  const backend=createRequire(path.resolve('functions/package.json')),{initializeApp,deleteApp}=backend('firebase-admin/app'),{getAuth}=backend('firebase-admin/auth'),{getDatabase}=backend('firebase-admin/database'),{getStorage}=backend('firebase-admin/storage');
  const app=initializeApp({projectId:'demo-tripsplitter-auth',databaseURL:'https://demo-tripsplitter-auth.firebaseio.com',storageBucket:'demo-tripsplitter-auth.appspot.com'},'trip-lifecycle-test'),db=getDatabase(app),auth=getAuth(app),bucket=getStorage(app).bucket();
  const id='qa-lifecycle',password='Local-test-2026-only!';
  const tools=createRequire(path.resolve('../diagnostics/auth-tools/package.json'));
  let rulesEnv;
  async function account(email){let user;try{user=await auth.getUserByEmail(email);}catch{user=await auth.createUser({email,password,emailVerified:true});}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const data=await response.json();assert.ok(data.idToken);return {uid:user.uid,email,token:data.idToken};}
  async function call(user,input){const response=await fetch('http://127.0.0.1:5001/demo-tripsplitter-auth/asia-southeast1/roomApi',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${user.token}`},body:JSON.stringify({data:{roomId:id,...input}})});return {status:response.status,...await response.json()};}
  try {
    const owner=await account('lifecycle-owner@example.com'),admin=await account('lifecycle-admin@example.com'),member=await account('lifecycle-member@example.com');
    await db.ref(`trips/${id}`).remove();
    assert.equal((await call(owner,{action:'create'})).status,200);
    for(const [user,role] of [[admin,'admin'],[member,'member']]){assert.equal((await call(owner,{action:'invite',email:user.email,role,memberId:'m1'})).status,200);assert.equal((await call(user,{action:'join'})).status,200);}
    const op={id:'advance',type:'expense.save',epoch:0,expectedRevision:0,data:{id:'e',title:'Dinner',time:'2026-10-24T10:00',payer:'m1',split:['m1'],amount:100,currency:'JPY'}};
    const saved=await call(owner,{action:'operation',operation:op});assert.equal(saved.status,200);const before=ledger.financialState(saved.result.state);
    await bucket.file(`receipts/${id}/one.png`).save(Buffer.from([1,2,3]),{metadata:{contentType:'image/png'}});
    await bucket.file(`receipts/${id}-other/keep.png`).save(Buffer.from([4,5,6]));
    await db.ref('ocrJobs/lifecycle-job').set({roomId:id,status:'done',createdBy:owner.uid,imagePath:`receipts/${id}/one.png`});
    await db.ref('ocrJobs/lifecycle-other-job').set({roomId:id+'-other',status:'done',createdBy:owner.uid});
    const deletion={action:'deleteRoom',confirmation:id,requestId:'first-delete',expectedRevision:before.revision,expectedEpoch:before.epoch};
    assert.equal((await call(admin,deletion)).status,403);assert.equal((await call(member,deletion)).status,403);
    assert.equal((await call(owner,{...deletion,confirmation:'wrong'})).status,400);
    assert.equal((await call(owner,{...deletion,expectedRevision:0})).status,400);
    const {initializeTestEnvironment,assertFails}=tools('@firebase/rules-unit-testing');rulesEnv=await initializeTestEnvironment({projectId:'demo-tripsplitter-auth',database:{host:'127.0.0.1',port:9000,rules:require('fs').readFileSync('database.rules.json','utf8')}});
    const client=rulesEnv.authenticatedContext(member.uid,{email:member.email,email_verified:true}).database();
    const readRef=client.ref(`trips/${id}/meta/deletion`);let cancel;
    const cancelled=new Promise(resolve=>{cancel=resolve;});
    await new Promise((resolve,reject)=>{readRef.on('value',snap=>{if(snap.exists())cancel();resolve();},reject);});
    const deleted=await call(owner,deletion);assert.equal(deleted.status,200,JSON.stringify(deleted.error));
    const meta=deleted.result.deletion;assert.equal(meta.purgeAfter-meta.deletedAt,RETENTION_MS);
    assert.equal((await call(owner,deletion)).result.deletion.purgeAfter,meta.purgeAfter);
    await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Realtime reader was not revoked')),5000))]);readRef.off();
    const freshClient=rulesEnv.authenticatedContext(member.uid,{email:member.email,email_verified:true}).database();await assertFails(freshClient.ref(`trips/${id}/state`).once('value'));await assertFails(client.ref('ocrJobs/lifecycle-job').once('value'));
    for(const action of ['join','info','uploadReceipt','readReceipt','operation'])assert.equal((await call(owner,{action,operation:{...op,id:'blocked'}})).status,400);
    const ownerRooms=await call(owner,{action:'list'});assert.equal(ownerRooms.result.rooms.find(r=>r.roomId===id).deletion.canRestore,true);
    for(const user of [admin,member])assert.equal((await call(user,{action:'list'})).result.rooms.some(r=>r.roomId===id),false);
    assert.equal((await call(admin,{action:'restoreRoom',deletionId:meta.id})).status,403);
    const restored=await call(owner,{action:'restoreRoom',deletionId:meta.id});assert.equal(restored.status,200);
    const restoredState=ledger.financialState((await db.ref(`trips/${id}/state`).get()).val());assert.deepEqual(restoredState.expenses,before.expenses);assert.equal(restoredState.epoch,2);
    assert.equal((await call(owner,{action:'operation',operation:{...op,id:'old-pending',data:{...op.data,id:'stale'}}})).status,400);
    assert.equal((await call(owner,{action:'deleteRoom',confirmation:id,requestId:'second-delete',expectedRevision:restoredState.revision,expectedEpoch:restoredState.epoch})).status,200);
    assert.equal((await call(owner,{action:'restoreRoom',deletionId:meta.id})).status,400);
    const old=Date.now()-RETENTION_MS-10000;await db.ref(`trips/${id}/meta/deletion`).update({deletedAt:old,purgeAfter:old+RETENTION_MS});
    assert.equal((await call(owner,{action:'restoreRoom',deletionId:'second-delete'})).status,400);
    await assert.rejects(purgeRoom(db,{deleteFiles:async()=>{throw new Error('Storage outage');}},id));assert.equal((await db.ref(`trips/${id}/meta/deletion/status`).get()).val(),'purging');assert.ok((await db.ref(`trips/${id}/state`).get()).exists());
    assert.equal(await purgeRoom(db,bucket,id),true);
    const retired=(await db.ref(`trips/${id}`).get()).val();assert.ok(retired.meta.retiredAt);assert.equal(retired.state,undefined);assert.equal(retired.access,undefined);
    assert.equal((await bucket.file(`receipts/${id}/one.png`).exists())[0],false);assert.equal((await bucket.file(`receipts/${id}-other/keep.png`).exists())[0],true);
    assert.equal((await db.ref('ocrJobs/lifecycle-job').get()).exists(),false);assert.equal((await db.ref('ocrJobs/lifecycle-other-job').get()).exists(),true);
    for(const user of [owner,admin,member])assert.equal((await db.ref(`accountRooms/${user.uid}/${id}`).get()).exists(),false);
    assert.equal((await call(owner,{action:'create'})).status,409);assert.ok(await auth.getUser(owner.uid));
    let called=false;assert.equal(await purgeRoom(db,{deleteFiles:async()=>{called=true;}},id),false);assert.equal(called,false);
  } finally {await rulesEnv?.cleanup();await deleteApp(app);}
});
