import { state, setState, saveLocalState, mergeState } from '../state.js';
import { hashState, sanitizeRoomId, getShareUrl } from '../utils.js';
import { updateSyncUI, renderAll } from '../ui.js';
import { db, auth, signInAnonymously, ref, set, onValue, off, get } from '../firebase.js';
import { reportError, showToast } from './errorService.js';

let roomUnsubscribeRef = null;
let currentRoomId = null;
let currentUserUid = null;
let isApplyingRemote = false;
let lastSavedHash = '';
let saveTimer = null;

export function getSyncContext() {
  return {
    currentRoomId,
    currentUserUid,
    isApplyingRemote,
    lastSavedHash
  };
}

export async function initFirebaseAuth() {
  try {
    const cred = await signInAnonymously(auth);
    currentUserUid = cred.user.uid;
    
    // ⭐ 登入成功後，更新 UI 同步圖示 (若已有 currentRoomId 就帶入)
    updateSyncUI(Boolean(currentRoomId), currentRoomId || '');
    return currentUserUid;
  } catch (error) {
    reportError(error, {
      scope: 'syncService.initFirebaseAuth',
      level: 'error',
      userMessage: 'Firebase 匿名登入失敗'
    });
    updateSyncUI(false);
    return null;
  }
}

export async function handleRoomJoinPrompt() {
  try {
    if (!currentUserUid) {
      showToast('Firebase 尚未完成初始化，請稍後再試', 'warn');
      return;
    }

    const current = currentRoomId || '';
    const input = prompt('請輸入共享旅程代碼 room\n例如：tokyo-2026-abc123', current);
    if (input === null) return;

    const roomId = sanitizeRoomId(input);
    if (!roomId) {
      showToast('room 不能是空白', 'warn');
      return;
    }

    await joinRoom(roomId);

    const shareUrl = getShareUrl(roomId);
    const copyIt = confirm(`已加入房間：${roomId}\n\n按「確定」複製分享連結給其他人`);

    if (copyIt) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('分享連結已複製', 'success');
      } catch (error) {
        reportError(error, {
          scope: 'syncService.handleRoomJoinPrompt.copyLink',
          level: 'warn',
          userMessage: '複製失敗，請手動複製連結'
        });
      }
    }
  } catch (error) {
    reportError(error, {
      scope: 'syncService.handleRoomJoinPrompt',
      level: 'error',
      userMessage: '加入房間失敗'
    });
  }
}

export async function joinRoom(roomId) {
  // ⭐ 若 UID 未準備好，確保 UI 設定為未同步狀態後退出
  if (!currentUserUid) {
    updateSyncUI(false);
    return;
  }

  if (roomUnsubscribeRef) {
    off(roomUnsubscribeRef);
    roomUnsubscribeRef = null;
  }

  currentRoomId = roomId;

  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);

  const tripRef = ref(db, `trips/${roomId}`);
  roomUnsubscribeRef = tripRef;

  try {
    const snapshot = await get(tripRef);

    if (!snapshot.exists()) {
      await set(tripRef, {
        state: {
          poolBalances: state.poolBalances,
          members: state.members,
          expenses: state.expenses
        },
        meta: {
          roomId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          updatedBy: currentUserUid
        }
      });
    }
  } catch (error) {
    reportError(error, {
      scope: 'syncService.joinRoom.createRoom',
      level: 'error',
      userMessage: '建立房間失敗'
    });
  }

  onValue(
    tripRef,
    (snapshot) => {
      try {
        const data = snapshot.val();
        if (!data || !data.state) {
          // ⭐ 就算資料庫內該路徑為空，只要監聽已成功啟動，就應更新 UI 狀態為 synced
          updateSyncUI(true, roomId);
          return;
        }

        const incoming = mergeState(data.state);
        const incomingHash = hashState(incoming);
        const currentHash = hashState(state);

        if (incomingHash === currentHash) {
          updateSyncUI(true, roomId);
          return;
        }

        isApplyingRemote = true;

        const preservedUi = {
          currentCat: state.currentCat,
          currentSub: state.currentSub,
          editingId: state.editingId,
          selectedPayer: state.selectedPayer,
          selectedSplit: state.selectedSplit,
          filterMemberId: state.filterMemberId,
          filterDate: state.filterDate,
          tempReceipt: state.tempReceipt,
          tempEmoji: state.tempEmoji,
          editingMemberId: state.editingMemberId,
          ocr: state.ocr
        };

        setState({
          ...incoming,
          ...preservedUi
        });

        saveLocalState();
        renderAll();
        updateSyncUI(true, roomId);
        lastSavedHash = hashState(state);
        isApplyingRemote = false;
      } catch (error) {
        reportError(error, {
          scope: 'syncService.joinRoom.onValue',
          level: 'error',
          userMessage: '房間資料同步失敗'
        });
      }
    },
    (error) => {
      reportError(error, {
        scope: 'syncService.joinRoom.realtime',
        level: 'error',
        userMessage: 'Realtime 同步失敗'
      });
      updateSyncUI(false);
    }
  );
}

export async function syncToCloud() {
  if (!currentRoomId || !currentUserUid || isApplyingRemote) return;

  const nextHash = hashState(state);
  if (nextHash === lastSavedHash) return;

  try {
    const tripRef = ref(db, `trips/${currentRoomId}`);

    await set(tripRef, {
      state: {
        poolBalances: state.poolBalances,
        members: state.members,
        expenses: state.expenses
      },
      meta: {
        roomId: currentRoomId,
        updatedAt: Date.now(),
        updatedBy: currentUserUid
      }
    });

    lastSavedHash = nextHash;
    updateSyncUI(true, currentRoomId);
  } catch (error) {
    reportError(error, {
      scope: 'syncService.syncToCloud',
      level: 'error',
      userMessage: '雲端同步失敗'
    });
  }
}

export function scheduleSync() {
  saveLocalState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    syncToCloud();
  }, 250);
}
