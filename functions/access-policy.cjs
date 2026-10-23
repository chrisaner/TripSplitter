const { createHash } = require('node:crypto');
const OWNER_EMAIL = 'chrisaner@gmail.com';
const ADMIN_OPS = new Set(['member.save','member.archive','backup.restore','history.delete','trash.delete']);
const MEMBER_OPS = new Set(['expense.save','expense.delete','expense.restore','pool.change']);
function fail(code, message) { const error = new Error(message); error.code=code; throw error; }
function emailKey(email) { return createHash('sha256').update(email.toLowerCase()).digest('hex'); }
function identity(auth) {
  if (!auth?.uid || !auth.token?.email || auth.token.email_verified !== true || auth.token.firebase?.sign_in_provider === 'anonymous') fail('unauthenticated','請先登入並完成 Email 驗證');
  return {uid:auth.uid,email:auth.token.email.toLowerCase(),name:String(auth.token.name || auth.token.email).slice(0,100)};
}
function roomId(value) { if(typeof value!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))fail('invalid-argument','旅程代碼限 1–80 個英文字母、數字、底線及連字號');return value; }
function member(room, user) { const found=room?.access?.users?.[user.uid];if(!found)fail('permission-denied','你尚未獲邀，或已被移除此旅程');return found; }
const isAdmin = role => ['owner','admin'].includes(role);
function info(room,user) {
  const own=member(room,user);
  return {role:own.role,memberId:own.memberId || '',ownerUid:room.access.ownerUid,
    users:isAdmin(own.role)?Object.entries(room.access.users).map(([uid,data])=>({uid,...data})):[{uid:user.uid,...own}],
    invites:isAdmin(own.role)?Object.entries(room.access.invites || {}).map(([id,data])=>({id,...data})):[]};
}
function binding(room, id) { if(id && !(room.state.members || []).some(m=>m.id===id))fail('invalid-argument','綁定的記帳成員不存在');return id || ''; }
function role(value) { if(!['admin','member','viewer'].includes(value))fail('invalid-argument','權限不正確');return value; }
function reduceRoom(raw, input, user, ledger, now=new Date().toISOString()) {
  const room=raw?structuredClone(raw):null, action=input.action;
  if(action==='create') {
    if(room)fail('already-exists','旅程代碼已存在');
    const name=user.name.split('@')[0];
    return {state:ledger.financialState({members:[{id:'m1',name,emoji:'👤'}],expenses:[],poolBalances:{}}),meta:{createdAt:now,createdBy:user.uid},
      access:{ownerUid:user.uid,users:{[user.uid]:{email:user.email,role:'owner',memberId:'m1',joinedAt:now}},invites:{}}};
  }
  if(!room?.state)fail('not-found','找不到此旅程，請確認代碼或建立新旅程');
  if(action==='join') {
    if(!room.access) {
      if(user.email!==OWNER_EMAIL)fail('permission-denied','此舊旅程需要由原管理員先啟用帳號權限');
      const kris=(room.state.members || []).find(m=>String(m.name).toLowerCase()==='kris');
      room.access={ownerUid:user.uid,users:{[user.uid]:{email:user.email,role:'owner',memberId:kris?.id || '',joinedAt:now}},invites:{}};
    } else if(!room.access.users?.[user.uid]) {
      const key=emailKey(user.email), invitation=room.access.invites?.[key];
      if(!invitation || invitation.email!==user.email)fail('permission-denied','此帳號尚未受邀，請聯絡旅程管理員');
      room.access.users[user.uid]={email:user.email,role:role(invitation.role),memberId:binding(room,invitation.memberId),joinedAt:now};
      delete room.access.invites[key];
    }
    return room;
  }
  const own=member(room,user), admin=isAdmin(own.role);
  if(action==='operation') {
    const incoming=input.operation;
    if(!incoming || !/^[a-zA-Z0-9_-]{1,100}$/.test(incoming.id || '') || !Number.isSafeInteger(incoming.epoch) || !Number.isSafeInteger(incoming.expectedRevision) || incoming.expectedRevision<0)fail('invalid-argument','操作格式不正確');
    if(!admin && (!MEMBER_OPS.has(incoming.type) || own.role!=='member' || (incoming.type==='pool.change' && incoming.data?.mode!=='add')))fail('permission-denied','這項操作需要管理員權限');
    if(!ADMIN_OPS.has(incoming.type) && !MEMBER_OPS.has(incoming.type))fail('invalid-argument','不支援的操作');
    const linked=(room.state.members || []).find(m=>m.id===own.memberId);
    const operation={...incoming,at:now,actor:{uid:user.uid,email:user.email,name:linked?.name || user.name}};
    try {room.state=ledger.applyOperation(room.state,operation);}catch(error){fail('failed-precondition',error.message);}
    room.meta={...room.meta,updatedAt:now,updatedBy:user.uid};return room;
  }
  if(!admin)fail('permission-denied','只有管理員可以管理旅程帳號');
  room.access.invites ||= {};
  if(action==='invite') {
    const email=String(input.email || '').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)fail('invalid-argument','請輸入有效的 Email');
    const desired=role(input.role);
    if(desired==='admin' && own.role!=='owner')fail('permission-denied','只有擁有者能指定管理員');
    if(Object.values(room.access.users).some(u=>u.email===email))fail('already-exists','此帳號已加入旅程，請直接修改成員權限');
    if(Object.keys(room.access.invites).length>=100)fail('resource-exhausted','邀請數量已達上限，請先取消不需要的邀請');
    room.access.invites[emailKey(email)]={email,role:desired,memberId:binding(room,input.memberId),at:now,by:user.uid};
  } else if(action==='cancelInvite') {
    const invite=room.access.invites[input.id];
    if(invite?.role==='admin' && own.role!=='owner')fail('permission-denied','只有擁有者能管理管理員邀請');
    delete room.access.invites[input.id];
  } else if(action==='setUser' || action==='removeUser') {
    const target=room.access.users[input.uid];
    if(!target)fail('not-found','帳號已不在旅程中');
    if(input.uid===room.access.ownerUid || input.uid===user.uid)fail('failed-precondition','不能移除自己或變更擁有者權限');
    if(own.role!=='owner' && (target.role==='admin' || input.role==='admin'))fail('permission-denied','只有擁有者能管理其他管理員');
    if(action==='removeUser')delete room.access.users[input.uid];
    else room.access.users[input.uid]={...target,role:role(input.role),memberId:binding(room,input.memberId)};
  } else fail('invalid-argument','不支援的管理操作');
  room.access.updatedAt=now;room.access.updatedBy=user.uid;
  return room;
}
module.exports={identity,roomId,member,info,isAdmin,reduceRoom,emailKey};
