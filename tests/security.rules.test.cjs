const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');

test('real Firebase rules deny anonymous access, cross-room access, forged writes, OCR injection and direct receipt access', {skip:!process.env.FIREBASE_DATABASE_EMULATOR_HOST},async()=>{
  const tools=createRequire(path.resolve(__dirname,'../../diagnostics/auth-tools/package.json'));
  const {initializeTestEnvironment,assertFails,assertSucceeds}=tools('@firebase/rules-unit-testing');
  const environment=await initializeTestEnvironment({projectId:'demo-tripsplitter-auth',database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')},storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('storage.rules','utf8')}});
  try {
    await environment.withSecurityRulesDisabled(async context=>context.database().ref().set({trips:{private:{state:{members:[{id:'a',name:'Secret'}]},access:{users:{alice:{role:'owner'},bob:{role:'member'}}}}},ocrJobs:{job:{roomId:'private',createdBy:'alice',status:'done'}}}));
    const user=(uid,verified=true)=>environment.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:verified}).database();
    await assertFails(environment.unauthenticatedContext().database().ref('trips/private/state').once('value'));
    await assertFails(user('alice',false).ref('trips/private/state').once('value'));
    await assertFails(user('stranger').ref('trips/private/state').once('value'));
    await assertSucceeds(user('alice').ref('trips/private/state').once('value'));
    await assertSucceeds(user('bob').ref('trips/private/state').once('value'));
    await assertFails(user('alice').ref('trips/private').once('value'));
    await assertFails(user('alice').ref('trips/private/state').set({hacked:true}));
    await assertFails(user('alice').ref('trips/private/access/users/stranger').set({role:'owner'}));
    await assertFails(user('bob').ref('ocrJobs/injected').set({roomId:'private',createdBy:'bob',status:'pending'}));
    await assertSucceeds(user('alice').ref('ocrJobs/job').once('value'));
    await assertFails(user('bob').ref('ocrJobs/job').once('value'));
    await environment.withSecurityRulesDisabled(async context=>context.database().ref('trips/private/access/users/bob').remove());
    await assertFails(user('bob').ref('trips/private/state').once('value'));
    assert.equal((await assertSucceeds(user('bob').ref('trips/private/access/users/bob').once('value'))).exists(),false);
    const storage=tools('firebase/storage');
    await assertFails(storage.uploadBytes(storage.ref(environment.authenticatedContext('alice',{email_verified:true}).storage(),'receipts/private/test.png'),new Uint8Array([1,2,3])));
  } finally {await environment.cleanup();}
});
