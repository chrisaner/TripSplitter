const {getDatabase}=require('firebase-admin/database');
const {getStorage}=require('firebase-admin/storage');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {randomUUID}=require('node:crypto');
const policy=require('./access-policy.cjs');
const ledgerPromise=import('./ledger.mjs');
const options={region:'asia-southeast1',maxInstances:2,memory:'256MiB',timeoutSeconds:60};

async function handler(request) {
  const user=policy.identity(request.auth), input=request.data || {}, action=input.action;
  const db=getDatabase();
  if(action==='list') {
    const entries=(await db.ref(`accountRooms/${user.uid}`).get()).val() || {};
    const rooms=[];
    for(const id of Object.keys(entries).slice(0,100)) {
      const access=(await db.ref(`trips/${id}/access/users/${user.uid}`).get()).val();
      if(access)rooms.push({roomId:id,role:access.role});
    }
    return {rooms};
  }
  const id=policy.roomId(input.roomId), roomRef=db.ref(`trips/${id}`);
  if(action==='info' || action==='uploadReceipt' || action==='readReceipt') {
    const room=(await roomRef.get()).val();policy.member(room,user);
    if(action==='info')return policy.info(room,user);
    if(action==='uploadReceipt') {
      if(!['owner','admin','member'].includes(policy.member(room,user).role))throw new HttpsError('permission-denied','唯讀帳號不能上傳收據');
      if(typeof input.image!=='string' || input.image.length>7*1024*1024)throw new HttpsError('invalid-argument','收據照片上限 5 MB');
      const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
      if(!match)throw new HttpsError('invalid-argument','只支援 JPEG、PNG、WebP 圖片');
      const buffer=Buffer.from(match[2],'base64');
      const valid=match[1]==='jpeg'?buffer[0]===255&&buffer[1]===216:match[1]==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
      if(!valid || !buffer.length || buffer.length>5*1024*1024)throw new HttpsError('invalid-argument','圖片格式或大小不正確');
      const jobId=`job_${randomUUID()}`, imagePath=`receipts/${id}/${jobId}.${match[1]}`;
      await getStorage().bucket().file(imagePath).save(buffer,{resumable:false,metadata:{contentType:`image/${match[1]}`}});
      await db.ref(`ocrJobs/${jobId}`).set({roomId:id,imagePath,status:'pending',createdAt:Date.now(),createdBy:user.uid});
      return {jobId,imagePath};
    }
    const imagePath=String(input.imagePath || '');
    if(!imagePath.startsWith(`receipts/${id}/`) || imagePath.includes('..'))throw new HttpsError('permission-denied','不能讀取其他旅程的收據');
    const file=getStorage().bucket().file(imagePath), [metadata]=await file.getMetadata();
    if(Number(metadata.size)>5*1024*1024)throw new HttpsError('invalid-argument','圖片過大');
    const [buffer]=await file.download();return {image:`data:${metadata.contentType || 'image/jpeg'};base64,${buffer.toString('base64')}`};
  }
  let failure;
  const ledger=await ledgerPromise;
  // Keep a live snapshot until the transaction completes. A one-shot read can
  // release the SDK cache before the updater runs and incorrectly yield null.
  let warmListener;
  let result;
  try {
    await new Promise((resolve,reject)=>{warmListener=snapshot=>resolve(snapshot);roomRef.on('value',warmListener,reject);});
    result=await roomRef.transaction(current=>{
      try {failure=null;return policy.reduceRoom(current,input,user,ledger);}catch(error){failure=error;return undefined;}
    },undefined,false);
  } finally {if(warmListener)roomRef.off('value',warmListener);}
  if(!result.committed)throw new HttpsError(failure?.code || 'aborted',failure?.message || '資料已變動，請重試');
  const room=result.snapshot.val();
  if(['join','create'].includes(action))await db.ref(`accountRooms/${user.uid}/${id}`).set(true);
  return {access:policy.info(room,user),...(action==='operation'?{state:room.state}:{})};
}
exports.roomApi=onCall(options,async request=>{
  try{return await handler(request);}catch(error){
    if(error instanceof HttpsError)throw error;
    if(['unauthenticated','permission-denied','invalid-argument','not-found','already-exists','failed-precondition','resource-exhausted'].includes(error.code))throw new HttpsError(error.code,error.message);
    console.error('roomApi failed',{code:error.code || 'internal'});throw new HttpsError('internal','雲端操作失敗，請稍後重試');
  }
});
