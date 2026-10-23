const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const ledger=require('../js/core/ledger.js');

test('authenticated callable integration: legacy owner, invitation, accounting, viewer and revocation', {skip:!process.env.FIREBASE_AUTH_EMULATOR_HOST,timeout:120000},async()=>{
  const backend=createRequire(path.resolve('functions/package.json'));
  const {initializeApp,deleteApp}=backend('firebase-admin/app');
  const {getAuth}=backend('firebase-admin/auth'),{getDatabase}=backend('firebase-admin/database');
  const app=initializeApp({projectId:'demo-tripsplitter-auth',databaseURL:'https://demo-tripsplitter-auth.firebaseio.com',storageBucket:'demo-tripsplitter-auth.appspot.com'},'integration');
  const db=getDatabase(app),auth=getAuth(app);
  async function token(email) {
    let user;try{user=await auth.getUserByEmail(email);}catch{user=await auth.createUser({email,password:'Local-test-2026-only!',emailVerified:true,displayName:email.split('@')[0]});}
    const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-demo-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Local-test-2026-only!',returnSecureToken:true})});
    const data=await response.json();assert.ok(data.idToken,JSON.stringify(data));return {uid:user.uid,token:data.idToken};
  }
  async function call(account,data) {
    const response=await fetch('http://127.0.0.1:5001/demo-tripsplitter-auth/asia-southeast1/roomApi',{method:'POST',headers:{'content-type':'application/json',...(account?{authorization:`Bearer ${account.token}`}:{})},body:JSON.stringify({data:{roomId:'qa-accounts',...data}})});
    const body=await response.json();return {status:response.status,result:body.result,error:body.error};
  }
  try {
    const owner=await token('chrisaner@gmail.com'),alice=await token('alice@example.com');
    const financial=ledger.financialState({members:[{id:'kris',name:'kris'},{id:'mj',name:'MJ'}],expenses:[],poolBalances:{JPY:5791}});
    await db.ref('trips/qa-accounts').set({state:financial,meta:{createdAt:123}});
    assert.equal((await call(null,{action:'join'})).status,401);
    assert.equal((await call(alice,{action:'join'})).status,403);
    assert.equal((await call(owner,{action:'join'})).result.access.role,'owner');
    assert.deepEqual(ledger.financialState((await db.ref('trips/qa-accounts/state').get()).val()),financial);
    assert.equal((await call(owner,{action:'invite',email:'alice@example.com',role:'member',memberId:'mj'})).status,200);
    assert.equal((await call(alice,{action:'join'})).result.access.role,'member');
    const operation={id:'integration-expense',epoch:0,expectedRevision:0,type:'expense.save',actor:{uid:'forged'},data:{id:'e1',title:'Lunch',currency:'JPY',amount:100,payer:'kris',split:['kris','mj'],time:'2026-10-23T12:00'}};
    const saved=await call(alice,{action:'operation',operation});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.result.state.history['integration-expense'].actor.uid,alice.uid);
    const settle={id:'cross-rates',epoch:0,expectedRevision:saved.result.state.revision,type:'settlement.settings',data:{currency:'TWD',rates:{TWD:1,JPY:.22}}};
    const configured=await call(owner,{action:'operation',operation:settle});assert.equal(configured.status,200,JSON.stringify(configured));
    assert.equal((await call(alice,{action:'operation',operation:{...settle,id:'forged-rates'}})).status,403);
    const payment={id:'pay-operation',epoch:0,expectedRevision:0,type:'repayment.save',data:{id:'payment',from:'mj',to:'kris',amount:5,currency:'TWD'}};
    const paid=await call(alice,{action:'operation',operation:payment});assert.equal(paid.status,200,JSON.stringify(paid));
    assert.equal(ledger.settlementReport(paid.result.state)[0].balances.mj,-11);
    const confirm={id:'confirm-operation',epoch:0,expectedRevision:1,type:'repayment.confirm',data:{id:'payment'}};
    assert.equal((await call(alice,{action:'operation',operation:confirm})).status,403);
    const confirmed=await call(owner,{action:'operation',operation:confirm});assert.equal(confirmed.status,200,JSON.stringify(confirmed));
    assert.equal(ledger.settlementReport(confirmed.result.state)[0].balances.mj,-6);
    assert.equal((await call(owner,{action:'setUser',uid:alice.uid,role:'viewer',memberId:'mj'})).status,200);
    assert.equal((await call(alice,{action:'operation',operation:{...operation,id:'forbidden'}})).status,403);
    assert.equal((await call(owner,{action:'removeUser',uid:alice.uid})).status,200);
    assert.equal((await call(alice,{action:'info'})).status,403);
    assert.equal((await call(owner,{action:'list'})).result.rooms.some(r=>r.roomId==='qa-accounts'),true);
  } finally {await deleteApp(app);}
});
