'use strict';
const {due}=require('./trip-lifecycle.cjs');
const {transact}=require('./room-transaction.cjs');
async function purgeRoom(db,bucket,roomId,now=Date.now()) {
  if(typeof roomId!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(roomId))throw new Error('Invalid purge room');
  const ref=db.ref(`trips/${roomId}`);
  const claimed=await transact(ref,room=>{
    if(!due(room,now))return;
    return {...room,meta:{...room.meta,deletion:{...room.meta.deletion,status:'purging',purgeStartedAt:room.meta.deletion.purgeStartedAt || now}}};
  });
  if(!claimed.committed)return false;
  const room=claimed.snapshot.val();
  // Include the trailing slash: room abc must never match abc-other.
  await bucket.deleteFiles({prefix:`receipts/${roomId}/`,force:true});
  while(true) {
    const jobs=await db.ref('ocrJobs').orderByChild('roomId').equalTo(roomId).limitToFirst(200).get();
    if(!jobs.exists())break;
    const patch={};jobs.forEach(child=>{patch[`ocrJobs/${child.key}`]=null;});await db.ref().update(patch);
  }
  const patch={};
  for(const uid of Object.keys(room.access?.users || {}))patch[`accountRooms/${uid}/${roomId}`]=null;
  // A non-personal reservation prevents stale links and queued writes from ever
  // referring to a different journey under the same code. No owner/state remains.
  patch[`trips/${roomId}`]={meta:{retiredAt:now}};
  await db.ref().update(patch);
  return true;
}
async function purgeExpiredRooms(db,bucket,now=Date.now()) {
  const expired=await db.ref('trips').orderByChild('meta/deletion/purgeAfter').startAt(1).endAt(now).limitToFirst(10).get();
  const ids=[];expired.forEach(child=>{ids.push(child.key);});
  let purged=0,failed=0;
  for(const id of ids){try {if(await purgeRoom(db,bucket,id,now))purged++;}catch{failed++;}}
  if(failed)throw new Error(`Trip cleanup incomplete: ${failed} failed; ${purged} purged`);
  return {examined:ids.length,purged};
}
module.exports={purgeRoom,purgeExpiredRooms};
