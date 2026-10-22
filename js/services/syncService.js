import { state, setState, saveLocalState, mergeState, DEFAULT_STATE, setLocalRoom } from '../state.js?v=20261022-5';
import { sanitizeRoomId, getShareUrl } from '../utils.js?v=20261022-5';
import { db, auth, signInAnonymously, ref, runTransaction, onValue, off, get } from '../firebase.js?v=20261022-5';
import { reportError, showToast } from './errorService.js?v=20261022-5';
import { applyOperation, financialState } from '../core/ledger.js?v=20261022-5';
import { notify } from '../state/store.js?v=20261022-5';

let currentRoomId = sanitizeRoomId(new URL(location.href).searchParams.get('room') || '') || null, currentUserUid = null, roomRef = null;
let base = financialState(state), pending = [], busy = false, ready = false, online = false, saveTimer;
let status = 'local';
const queueKey = () => `tripSplitterOutbox:${currentRoomId || 'local'}`;
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
export function getSyncContext() { return { currentRoomId, currentUserUid, isApplyingRemote: false, pendingCount: pending.length, status, ready }; }
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
  if (status === 'conflict') throw new Error('請先處理待同步衝突');
  const op = { id: crypto.randomUUID(), epoch: state.epoch || 0, order: operationOrder = Math.max(Date.now(),operationOrder+1), type, data: JSON.parse(JSON.stringify(data)), expectedRevision, at: new Date().toISOString(), actor: { uid: currentUserUid || 'local', name: localStorage.getItem(`tripSplitterActor:${currentRoomId || 'local'}`) || '未指定操作者' } };
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
export async function initFirebaseAuth() {
  try {
    currentUserUid = (await signInAnonymously(auth)).user.uid;
    onValue(ref(db, '.info/connected'), snapshot => {
      online = snapshot.val() === true;
      if (currentRoomId && ready) {
        if (!online) setSyncStatus('offline');
        else if (pending.length) scheduleSync(); else setSyncStatus('synced');
      }
    });
    return currentUserUid;
  } catch (error) { reportError(error, { userMessage: '匿名登入失敗，請重新整理', scope: 'auth' }); setSyncStatus('error'); return null; }
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
  if (roomRef) off(roomRef);
  currentRoomId = roomId; ready = false; setSyncStatus('joining'); setLocalRoom(roomId);
  pending = loadQueue(); saveQueue(); localStorage.removeItem(queueKey());
  const url = new URL(location.href); url.searchParams.set('room', roomId); history.replaceState({}, '', url);
  roomRef = ref(db, `trips/${roomId}`);
  try {
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) {
      const initial = { state: financialState(DEFAULT_STATE), meta: { roomId, createdAt: Date.now(), updatedBy: currentUserUid } };
      await runTransaction(roomRef, current => current || initial, { applyLocally: false });
    }
    onValue(roomRef, snapshot => {
      if (!snapshot.val()?.state) return;
      base = financialState(snapshot.val().state); ready = true; project();
      if (pending.length) scheduleSync(); else setSyncStatus(online ? 'synced' : 'offline');
    }, error => { setSyncStatus('error'); reportError(error, { scope: 'sync.listen', userMessage: '房間讀取失敗' }); });
  } catch (error) { setSyncStatus('error'); throw error; }
}
export async function syncToCloud() {
  if (!ready || busy || !pending.length || !online || status === 'conflict') return;
  busy = true; setSyncStatus('pending');
  try {
    while (pending.length) {
      const op = pending[0]; let conflict = null;
      const result = await runTransaction(roomRef, current => {
        if (!current?.state) { conflict = new Error('房間資料不存在，已停止寫入'); return; }
        try { const next = applyOperation(current.state, op); conflict = null; return { ...current, state: next, meta: { ...current.meta, updatedAt: Date.now(), updatedBy: currentUserUid } }; }
        catch (error) { conflict = error; return; }
      }, { applyLocally: false });
      if (!result.committed) { setSyncStatus('conflict'); showToast(conflict?.message || '資料衝突，未覆蓋雲端帳目', 'error'); return; }
      base = financialState(result.snapshot.val().state);
      pending = pending.filter(entry => entry.id !== op.id); saveQueue(); project();
    }
    setSyncStatus('synced');
  } catch (error) { setSyncStatus('error'); reportError(error, { scope: 'sync.write', userMessage: '同步失敗，變更已保存在此裝置，可點同步文字重試' }); }
  finally { busy = false; }
}
export function scheduleSync() {
  clearTimeout(saveTimer);
  if (pending.length && status !== 'conflict') setSyncStatus(online ? 'pending' : 'offline');
  saveTimer = setTimeout(syncToCloud, 250);
}
export function pendingOperations() { return JSON.parse(JSON.stringify(pending)); }
export function discardPending() {
  if (busy) throw new Error('同步進行中，請稍候');
  localStorage.setItem(`tripSplitterRejected:${currentRoomId}`, JSON.stringify(pending));
  pending = []; saveQueue(); project(); setSyncStatus(online ? 'synced' : 'offline');
}
