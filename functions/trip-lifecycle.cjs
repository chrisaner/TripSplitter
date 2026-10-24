'use strict';
const RETENTION_MS=30*24*60*60*1000;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function owner(room,user){if(room?.access?.ownerUid!==user.uid || room.access.users?.[user.uid]?.role!=='owner')fail('permission-denied','只有旅程擁有者能刪除或復原整個旅程');}
function active(room){if(room?.meta?.deletion)fail('failed-precondition','旅程已刪除，擁有者可在 30 天內至旅程回收桶復原');}
function due(room,now){const d=room?.meta?.deletion;return Boolean(room?.state && d && ['deleted','purging'].includes(d.status) && Number.isSafeInteger(d.deletedAt) && d.deletedAt>0 && Number.isSafeInteger(d.purgeAfter) && d.purgeAfter>=d.deletedAt+RETENTION_MS && now>=d.purgeAfter);}
function lifecycle(raw,input,user,now) {
  const room=structuredClone(raw);if(!room?.state)fail('not-found','旅程不存在或已永久清除');owner(room,user);
  const at=Date.parse(now);if(!Number.isFinite(at))fail('internal','伺服器時間不正確');
  const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  let type,before,after,id;
  if(input.action==='deleteRoom') {
    if(input.confirmation!==input.roomId || !validId(input.requestId))fail('invalid-argument','請輸入完整旅程代碼確認刪除');
    if(room.meta?.deletion) {
      if(room.meta.deletion.id===input.requestId)return room;
      fail('failed-precondition','旅程已刪除，請到旅程回收桶查看');
    }
    if(!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision!==Number(room.state.revision || 0) || !Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch!==Number(room.state.epoch || 0))fail('failed-precondition','帳目已更新，請重新開啟刪除確認畫面');
    id=input.requestId;type='room.delete';before={status:'active'};
    after={id,status:'deleted',deletedAt:at,purgeAfter:at+RETENTION_MS,by:user.uid};
    room.meta={...room.meta,deletion:after};
  } else if(input.action==='restoreRoom') {
    const d=room.meta?.deletion;
    if(!validId(input.deletionId))fail('invalid-argument','旅程刪除版本不正確');
    if(!d && room.meta?.lastRestoredDeletionId===input.deletionId)return room;
    if(!d || d.id!==input.deletionId)fail('failed-precondition','旅程刪除版本已變更，請重新整理回收桶');
    if(d.status!=='deleted' || at>=d.purgeAfter)fail('failed-precondition','已超過 30 天復原期限，或正在永久清除');
    id=input.deletionId;type='room.restore';before=d;after={status:'active'};
    delete room.meta.deletion;room.meta.lastRestoredDeletionId=id;
  } else fail('invalid-argument','不支援的旅程操作');
  room.state.epoch=Number(room.state.epoch || 0)+1;
  room.state.revision=Number(room.state.revision || 0)+1;
  room.state.history ||= {};
  const entryId=`${type.replace('.','_')}_${id}`;
  room.state.history[entryId]={id:entryId,type,targetId:input.roomId,at:now,actor:{uid:user.uid,email:user.email,name:user.name},before,after};
  room.meta.updatedAt=now;room.meta.updatedBy=user.uid;
  return room;
}
module.exports={RETENTION_MS,active,due,lifecycle};
