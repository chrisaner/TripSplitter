import { auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, reload, signInWithPopup, GoogleAuthProvider } from '../firebase.js?v=20261023-travel2';
import { state } from '../state.js?v=20261023-travel2';
import { getSyncContext, initFirebaseAuth, joinRoom, stopAccountSession, setRoomAccess, isRoomAdmin } from '../services/syncService.js?v=20261023-travel2';
import { roomRequest } from '../services/accountApi.js?v=20261023-travel2';
import { escapeHtml, getShareUrl } from '../utils.js?v=20261023-travel2';
import { showToast } from '../services/errorService.js?v=20261023-travel2';

let user=null, initialized=false, picker=false, authTurn=0;
const el=id=>document.getElementById(id);
const roleName=role=>({owner:'旅程擁有者',admin:'管理員',member:'記帳成員',viewer:'唯讀成員'})[role] || '尚未加入旅程';
const message=text=>{el('auth-message').textContent=text;};
function safeError(error) {
  return ({'auth/invalid-credential':'Email 或密碼不正確','auth/user-not-found':'Email 或密碼不正確','auth/wrong-password':'Email 或密碼不正確','auth/too-many-requests':'嘗試次數過多，請稍後再試','auth/email-already-in-use':'此 Email 無法建立新帳號，請登入或使用忘記密碼','auth/weak-password':'請使用至少 8 字元且符合密碼政策的密碼','auth/popup-closed-by-user':'登入視窗已關閉','auth/popup-blocked':'請允許登入彈出視窗後再試','auth/operation-not-allowed':'此登入方式尚未啟用，請聯絡管理員'})[error.code] || error.message || '操作失敗，請稍後重試';
}
async function perform(button, fn) {
  if(button?.disabled)return; if(button)button.disabled=true;
  try {await fn();}catch(error){const text=safeError(error);message(text);showToast(text,'error');}
  finally {if(button)button.disabled=false;}
}
async function enterUser(next) {
  const turn=++authTurn;stopAccountSession();user=next;initialized=true;
  el('global-toast')?.classList.add('hidden');
  document.querySelectorAll('.modal-overlay').forEach(modal=>{modal.style.display='none';});
  ['receipt-image','full-receipt-display'].forEach(id=>el(id)?.removeAttribute('src'));
  if(next?.isAnonymous){await signOut(auth);return;}
  renderAccount();
  if(!next){message('請登入或建立帳號。');return;}
  if(!next.emailVerified){message('請先驗證 Email，再按「我已完成驗證」。');return;}
  message('已登入，正在確認旅程權限…');
  await initFirebaseAuth(next);
  if(turn!==authTurn)return;
  const room=new URL(location.href).searchParams.get('room');
  if(room){try {await joinRoom(room);}catch(error){message(safeError(error));}}
  else {picker=true;message('輸入旅程代碼加入，或建立新旅程。');}
  renderAccount();
}
export function renderAccount() {
  const context=getSyncContext(), verified=Boolean(user?.emailVerified && !user.isAnonymous), opened=verified && context.ready && !picker;
  el('auth-gate').hidden=opened;el('secured-app').hidden=!opened;
  el('login-form').hidden=!initialized || Boolean(user);el('signed-in-gate').hidden=!user;
  el('verify-actions').hidden=!user || verified;el('room-actions').hidden=!verified;
  el('gate-account').textContent=user?.email || '';
  if(!verified || !context.ready)return;
  el('account-profile').textContent=`${user.displayName || user.email} · ${user.email}`;
  el('account-role').textContent=`${context.currentRoomId} · ${roleName(context.role)}`;
  if(document.activeElement!==el('account-name'))el('account-name').value=user.displayName || '';
  const admin=isRoomAdmin(), owner=context.role==='owner';
  el('account-admin').hidden=!admin;
  el('invite-role').querySelector('option[value="admin"]').disabled=!owner;
  const memberOptions=(selected='')=>'<option value="">未綁定</option>'+state.members.map(m=>`<option value="${escapeHtml(m.id)}" ${m.id===selected?'selected':''}>${escapeHtml(m.name)}${m.archived?'（已停用）':''}</option>`).join('');
  const current=el('invite-member').value;el('invite-member').innerHTML=memberOptions(current);
  if(admin) {
    el('room-users').innerHTML=(context.access?.users || []).map(entry=>{
      const locked=entry.uid===user.uid || entry.role==='owner' || (!owner && entry.role==='admin');
      return `<div class="management-card" data-account-uid="${escapeHtml(entry.uid)}"><strong>${escapeHtml(entry.email)}</strong><p>${roleName(entry.role)}</p><select aria-label="帳號權限" class="management-input" data-user-role ${locked?'disabled':''}>${['owner','admin','member','viewer'].filter(r=>r!=='owner'||entry.role==='owner').map(r=>`<option value="${r}" ${r===entry.role?'selected':''} ${r==='admin'&&!owner?'disabled':''}>${roleName(r)}</option>`).join('')}</select><select aria-label="綁定記帳成員" class="management-input" data-user-member ${locked?'disabled':''}>${memberOptions(entry.memberId)}</select>${locked?'<p class="empty-note">擁有者與自己的權限不在此修改。</p>':'<button class="management-button" data-save-user>儲存權限</button><button class="management-button danger" data-remove-user>移除此旅程權限</button>'}</div>`;
    }).join('');
    el('room-invites').innerHTML=(context.access?.invites || []).map(invite=>`<div class="management-card"><strong>${escapeHtml(invite.email)}</strong><p>${roleName(invite.role)} · ${escapeHtml(state.members.find(m=>m.id===invite.memberId)?.name || '未綁定')}</p><button class="management-button" data-cancel-invite="${escapeHtml(invite.id)}" ${!owner&&invite.role==='admin'?'disabled':''}>取消邀請</button></div>`).join('') || '<p class="empty-note">沒有待加入邀請。</p>';
  }
  const viewer=context.role==='viewer';
  ['add-expense-btn','save-expense-btn','delete-exp-btn','pool-add-btn','trigger-receipt-upload-btn','remove-receipt-btn'].forEach(id=>{if(el(id))el(id).disabled=viewer;});
  ['add-member-btn','member-save-btn','import-json','pool-set-btn','pool-refund-btn'].forEach(id=>{if(el(id))el(id).disabled=!admin;});
  if(!admin)el('restore-backup').disabled=true;
  document.querySelectorAll('[data-history-delete-id],[data-trash-delete-id],[data-action="delete-member"]').forEach(button=>{button.hidden=!admin;});
  document.querySelectorAll('[data-restore-id]').forEach(button=>{button.disabled=viewer;});
  el('management-sync').textContent=`待同步操作：${context.pendingCount} 筆。異動由登入帳號署名，雲端會驗證權限。`;
  const prefix=`tripSplitterOutbox:${context.currentRoomId}:op:`;
  let legacy=0;for(let i=0;i<localStorage.length;i++)if(localStorage.key(i).startsWith(prefix))legacy++;
  el('legacy-pending-note').textContent=legacy&&user.email==='chrisaner@gmail.com'?`此裝置有 ${legacy} 筆舊版待同步操作，請下載後由管理員確認，系統不會自動歸屬給新帳號。`:'';
  el('export-legacy-pending').hidden=!legacy || user.email!=='chrisaner@gmail.com';
}
async function refreshAccess() {const context=getSyncContext();setRoomAccess(await roomRequest({action:'info',roomId:context.currentRoomId}));renderAccount();}
async function changeAccess(data) {await roomRequest({roomId:getSyncContext().currentRoomId,...data});await refreshAccess();}
async function logout() {
  if(getSyncContext().pendingCount)throw new Error('還有待同步變更，請先完成同步，或下載後採用雲端版本，再登出。');
  await signOut(auth);el('login-password').value='';picker=false;
}
export function bindAccount() {
  el('join-room-code').value=new URL(location.href).searchParams.get('room') || '';
  el('login-form').addEventListener('submit',event=>{event.preventDefault();perform(event.submitter,async()=>{
    await signInWithEmailAndPassword(auth,el('login-email').value.trim(),el('login-password').value);el('login-password').value='';
  });});
  el('signup-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{
    if(!el('login-form').reportValidity())return;
    if(!el('signup-name').value.trim())throw new Error('註冊時請填寫顯示名稱');
    const result=await createUserWithEmailAndPassword(auth,el('login-email').value.trim(),el('login-password').value);
    el('login-password').value='';await updateProfile(result.user,{displayName:el('signup-name').value.trim()});await sendEmailVerification(result.user);message('驗證信已寄出，請到信箱完成驗證。');
  }));
  el('google-login-btn').addEventListener('click',event=>perform(event.currentTarget,()=>signInWithPopup(auth,new GoogleAuthProvider())));
  el('forgot-password-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{
    if(!el('login-email').reportValidity())return;
    await sendPasswordResetEmail(auth,el('login-email').value.trim());message('如果這個 Email 可以重設密碼，信箱將收到重設連結，請一併檢查垃圾郵件。');
  }));
  el('verify-send-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{await sendEmailVerification(auth.currentUser);message('驗證信已寄出。');}));
  el('verify-reload-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{await reload(auth.currentUser);await auth.currentUser.getIdToken(true);await enterUser(auth.currentUser);}));
  ['gate-signout-btn','account-signout'].forEach(id=>el(id).addEventListener('click',event=>perform(event.currentTarget,logout)));
  for(const [id,create] of [['join-room-btn',false],['create-room-btn',true]])el(id).addEventListener('click',event=>perform(event.currentTarget,async()=>{
    const room=el('join-room-code').value.trim();if(create)await roomRequest({action:'create',roomId:room});await joinRoom(room);picker=false;renderAccount();
  }));
  el('list-rooms-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{
    const {rooms}=await roomRequest({action:'list'});el('account-rooms').innerHTML=rooms.map(r=>`<button class="management-button" data-join-room="${escapeHtml(r.roomId)}">${escapeHtml(r.roomId)} · ${roleName(r.role)}</button>`).join('') || '<p class="empty-note">尚未加入旅程。</p>';
  }));
  el('account-rooms').addEventListener('click',event=>{const button=event.target.closest('[data-join-room]');if(button)perform(button,async()=>{await joinRoom(button.dataset.joinRoom);picker=false;renderAccount();});});
  el('switch-room-btn').addEventListener('click',event=>perform(event.currentTarget,async()=>{if(getSyncContext().pendingCount)throw new Error('請先完成待同步變更再切換旅程');picker=true;message('輸入其他旅程代碼，或從已加入名單選擇。');renderAccount();}));
  el('save-account-name').addEventListener('click',event=>perform(event.currentTarget,async()=>{
    const name=el('account-name').value.trim();if(!name)throw new Error('請填寫顯示名稱');await updateProfile(auth.currentUser,{displayName:name});await auth.currentUser.getIdToken(true);user=auth.currentUser;renderAccount();showToast('名稱已更新','success');
  }));
  el('account-reset-password').addEventListener('click',event=>perform(event.currentTarget,async()=>{await sendPasswordResetEmail(auth,user.email);showToast('密碼重設信已寄出，請查看信箱','success');}));
  el('invite-form').addEventListener('submit',event=>{event.preventDefault();perform(event.submitter,async()=>{
    await changeAccess({action:'invite',email:el('invite-email').value,role:el('invite-role').value,memberId:el('invite-member').value});el('invite-email').value='';showToast('邀請已建立，請將旅程連結交給對方','success');
  });});
  el('refresh-account-users').addEventListener('click',event=>perform(event.currentTarget,refreshAccess));
  el('copy-room-link').addEventListener('click',event=>perform(event.currentTarget,async()=>{await navigator.clipboard.writeText(getShareUrl(getSyncContext().currentRoomId));showToast('旅程連結已複製','success');}));
  el('room-users').addEventListener('click',event=>{
    const button=event.target.closest('[data-save-user],[data-remove-user]');if(!button)return;
    const row=button.closest('[data-account-uid]'),remove=button.hasAttribute('data-remove-user');
    if(!confirm(remove?'移除此帳號的旅程存取權限？歷史帳目會保留。':'儲存此帳號的權限與成員綁定？'))return;
    perform(button,()=>changeAccess({action:remove?'removeUser':'setUser',uid:row.dataset.accountUid,role:row.querySelector('[data-user-role]').value,memberId:row.querySelector('[data-user-member]').value}));
  });
  el('room-invites').addEventListener('click',event=>{const button=event.target.closest('[data-cancel-invite]');if(button && confirm('取消此邀請？'))perform(button,()=>changeAccess({action:'cancelInvite',id:button.dataset.cancelInvite}));});
  el('export-legacy-pending').addEventListener('click',()=>{
    const prefix=`tripSplitterOutbox:${getSyncContext().currentRoomId}:op:`,entries=[];
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(prefix))entries.push(JSON.parse(localStorage.getItem(key)));}
    const url=URL.createObjectURL(new Blob([JSON.stringify(entries,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='舊版待同步變更.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  onAuthStateChanged(auth,next=>{enterUser(next).catch(error=>{message(safeError(error));renderAccount();});});
}
