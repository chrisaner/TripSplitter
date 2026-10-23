import { state, setState, saveLocalState, DEFAULT_STATE, setLocalRoom, setLocalUser, clearAccountCache } from '../state.js?v=20261023-travel1';
import { sanitizeRoomId, getShareUrl } from '../utils.js?v=20261023-travel1';
import { db, ref, onValue, off } from '../firebase.js?v=20261023-travel1';
import { roomRequest } from './accountApi.js?v=20261023-travel1';
import { reportError, showToast } from './errorService.js?v=20261023-travel1';
import { applyOperation, financialState } from '../core/ledger.js?v=20261023-travel1';
import { notify } from '../state/store.js?v=20261023-travel1';

let currentRoomId = sanitizeRoomId(new URL(location.href).searchParams.get('room') || '') || null, currentUserUid = null, roomRef = null;
let base = financialState(state), pending = [], busy = false, ready = false, online = false, saveTimer;
let status = 'local';
let account = null, access = null, session = 0, unsubscribeConnection = null, membershipRef = null;
const queueKey = () => `tripSplitterOutbox:${currentUserUid}:${currentRoomId || 'local'}`;
const queuePrefix = () => `${queueKey()}:op:`;
let persistedIds = new Set(), operationOrder = Date.now();
function saveQueue() {
  const nextIds = new Set(pending.map(op=>op.id));
  for (const op of pending) if (!persistedIds.has(op.id)) localStorage.setItem(queuePrefix()+op.id, JSON.stringify(op));
  for (const id of persistedIds) if (!nextIds.has(id)) localStorage.removeItem(queuePrefix()+id);
  persistedIds = nextIds;
}
function loadQueue() {
  const entries = JSON.parse(localStorage.getItem(queueKey()) || '[]');
  persistedIds = new Set();
  for (let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);
    if (key.startsWith(queuePrefix())) {
      const op=JSON.parse(localStorage.getItem(key)); entries.push(op); persistedIds.add(op.id);
    }
  }
  const result=[...new Map(entries.map(op=>[op.id,op])).values()].sort((a,b)=>(a.order || Date.parse(a.at))-(b.order || Date.parse(b.at)));
  operationOrder=Math.max(operationOrder,...result.map(op=>op.order || 0));
  return result;
}
export function getSyncContext() { return { currentRoomId, currentUserUid, isApplyingRemote: false, pendingCount: pending.length, status, ready, role:access?.role, access }; }
export function isRoomAdmin() { return ['owner','admin'].includes(access?.role); }
export function canOperate(type,data={}) {
  if(!currentUserUid || !ready)return false;
  if(isRoomAdmin())return true;
  if(access?.role==='member' && type.startsWith('repayment.')) {
    const r=(state.repayments || []).find(r=>r.id===data.id);
    return type==='repayment.save' ? access.memberId===data.from : type==='repayment.confirm' ? r?.to===access.memberId : type==='repayment.cancel' && r?.from===access.memberId && r?.status==='pending';
  }
  return access?.role==='member' && (['expense.save','expense.delete','expense.restore'].includes(type) || (type==='pool.change' && data.mode==='add'));
}
export function setRoomAccess(value) { access=value;notify(); }
function clearView() { document.getElementById('trip-report-preview')?.remove?.(); setState({...structuredClone(DEFAULT_STATE),...financialState({members:[],expenses:[],poolBalances:{}})}); }
export function stopAccountSession() {
  session++;clearTimeout(saveTimer);if(roomRef)off(roomRef);if(membershipRef)off(membershipRef);unsubscribeConnection?.();unsubscribeConnection=null;
  if(currentUserUid)clearAccountCache(currentUserUid);
  currentUserUid=null;account=null;access=null;roomRef=null;membershipRef=null;pending=[];persistedIds=new Set();busy=false;ready=false;online=false;
  setLocalUser(null);clearView();base=financialState(state);notify();
}
function accessRevoked() {
  session++;clearTimeout(saveTimer);if(roomRef)off(roomRef);if(membershipRef)off(membershipRef);
  access=null;ready=false;busy=false;pending=[];persistedIds=new Set();clearAccountCache(currentUserUid);clearView();base=financialState(state);
  setSyncStatus('error','沒有此旅程的存取權限');notify();
}
export function setSyncStatus(next, detail = '') {
  status = next;
  const text = document.getElementById('sync-text');
  if (text) text.textContent = ({ local: '本地模式', joining: '讀取房間中', synced: `已同步：${currentRoomId}`, pending: '同步中…', offline: '離線，變更已保存在此裝置', error: '同步失敗，點此重試', conflict: '資料衝突，請處理待同步變更' })[next] + (detail ? `：${detail}` : '');
  const dot = document.getElementById('sync-dot');
  if (dot) dot.className = `w-2 h-2 rounded-full mr-1.5 ${next === 'synced' ? 'bg-green-500' : next === 'error' || next === 'conflict' ? 'bg-red-500' : 'bg-gray-300'}`;
  const banner = document.getElementById('sync-conflict');
  if (banner) banner.hidden = next !== 'conflict';
}
function project() {
  let view = base;
  for (const op of pending) { try { view = applyOperation(view, op); } catch { /* Keep conflicts for explicit resolution. */ } }
  setState({ ...state, ...financialState(view) });
  try { saveLocalState(); } catch { showToast('此裝置儲存空間不足，請匯出備份並釋放空間', 'error'); }
  notify();
}
export function dispatchOperation(type, data, expectedRevision = 0) {
  if (currentRoomId && !ready) throw new Error('房間尚未讀取完成，請稍候');
  if(!canOperate(type,data))throw new Error('請登入具備此操作權限的旅程帳號');
  if (status === 'conflict') throw new Error('請先處理待同步衝突');
  const linked=state.members.find(m=>m.id===access.memberId);
  const op = { id: crypto.randomUUID(), epoch: state.epoch || 0, order: operationOrder = Math.max(Date.now(),operationOrder+1), type, data: JSON.parse(JSON.stringify(data)), expectedRevision, at: new Date().toISOString(), actor: { uid: currentUserUid, email:account.email, name:linked?.name || account.displayName || account.email } };
  const next = applyOperation(financialState(state), op);
  if (!currentRoomId) {
    const previous = state; setState({ ...state, ...next });
    try { saveLocalState(); } catch (error) { setState(previous); throw error; }
    base = next; notify(); return true;
  }
  pending.push(op);
  try { saveQueue(); } catch (error) { pending.pop(); throw error; }
  setState({ ...state, ...next });
  try { saveLocalState(); } catch { showToast('本機快取空間不足，操作仍已排入同步佇列', 'warn'); }
  notify(); scheduleSync(); return true;
}
export async function initFirebaseAuth(user) {
  try {
    if(!user?.uid || !user.emailVerified || user.isAnonymous)throw new Error('請先登入並驗證 Email');
    account=user;currentUserUid=user.uid;setLocalUser(user.uid);clearAccountCache(user.uid);
    unsubscribeConnection=onValue(ref(db, '.info/connected'), snapshot => {
      online = snapshot.val() === true;
      if (currentRoomId && ready) {
        if (!online) setSyncStatus('offline');
        else if (pending.length) scheduleSync(); else setSyncStatus('synced');
      }
    });
    return currentUserUid;
  } catch (error) { reportError(error, { userMessage: error.message, scope: 'auth' }); setSyncStatus('error'); return null; }
}
export async function handleRoomJoinPrompt() {
  const input = prompt('輸入共享旅程代碼 room', currentRoomId || '');
  if (input === null) return;
  const room = sanitizeRoomId(input);
  if (!room) return showToast('房間代碼不能為空', 'warn');
  try { await joinRoom(room); if (confirm('已加入房間，是否複製分享連結？')) await navigator.clipboard.writeText(getShareUrl(room)); }
  catch (error) { showToast(error.message, 'error'); }
}
export async function joinRoom(roomId) {
  if (!currentUserUid) throw new Error('登入尚未完成');
  if (busy || pending.length) throw new Error('尚有待同步資料，請先完成同步或處理衝突再切換房間');
  const before=session;
  const response=await roomRequest({action:'join',roomId});
  if(before!==session)return;
  const token=++session;
  if (roomRef) off(roomRef);if(membershipRef)off(membershipRef);
  access=response.access;
  currentRoomId = roomId; ready = false; setSyncStatus('joining'); setLocalRoom(roomId);
  pending = loadQueue(); saveQueue(); localStorage.removeItem(queueKey());
  const url = new URL(location.href); url.searchParams.set('room', roomId); history.replaceState({}, '', url);
  roomRef = ref(db, `trips/${roomId}/state`);
  try {
    membershipRef=ref(db,`trips/${roomId}/access/users/${currentUserUid}`);
    onValue(membershipRef,snapshot=>{
      if(token!==session)return;
      const own=snapshot.val();if(!own){accessRevoked();return;}
      access={...access,role:own.role,memberId:own.memberId || ''};notify();
    },()=>{if(token===session)accessRevoked();});
    onValue(roomRef, snapshot => {
      if(token!==session || !snapshot.val()) return;
      base = financialState(snapshot.val()); ready = true; project();
      if (pending.length) scheduleSync(); else setSyncStatus(online ? 'synced' : 'offline');
    }, error => { if(token===session) {accessRevoked();reportError(error,{scope:'sync.listen',userMessage:'旅程權限已失效，請重新加入'});} });
  } catch (error) { setSyncStatus('error'); throw error; }
}
export async function syncToCloud() {
  if (!ready || busy || !pending.length || !online || status === 'conflict') return;
  const token=session, roomId=currentRoomId;
  busy = true; setSyncStatus('pending');
  try {
    while (pending.length) {
      const op = pending[0];
      const result = await roomRequest({action:'operation',roomId,operation:op});
      if(token!==session)return;
      base = financialState(result.state);
      pending = pending.filter(entry => entry.id !== op.id); saveQueue(); project();
    }
    setSyncStatus('synced');
  } catch (error) {
    if(token!==session)return;
    if(error.code==='functions/failed-precondition') {setSyncStatus('conflict');showToast(error.message,'error');}
    else {setSyncStatus('error');reportError(error,{scope:'sync.write',userMessage:'同步失敗，變更已保存在此帳號的待同步佇列，請確認權限後重試'});}
  }
  finally { if(token===session)busy = false; }
}
export function scheduleSync() {
  clearTimeout(saveTimer);
  if (pending.length && status !== 'conflict') setSyncStatus(online ? 'pending' : 'offline');
  saveTimer = setTimeout(syncToCloud, 250);
}
export function pendingOperations() { return JSON.parse(JSON.stringify(pending)); }
export function discardPending() {
  if (busy) throw new Error('同步進行中，請稍候');
  localStorage.setItem(`tripSplitterRejected:${currentUserUid}:${currentRoomId}`, JSON.stringify(pending));
  pending = []; saveQueue(); project(); setSyncStatus(online ? 'synced' : 'offline');
}
