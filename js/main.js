import './firebase.js?v=20261022-2';
import './state.js?v=20261022-2';
import './data.js?v=20261022-2';

import { sanitizeRoomId } from './utils.js?v=20261022-2';
import { bindStaticEvents, bindDelegatedEvents } from './events.js?v=20261022-2';
import { initFirebaseAuth, joinRoom, syncToCloud, setSyncStatus } from './services/syncService.js?v=20261022-2';
import { showToast } from './services/errorService.js?v=20261022-2';
import { subscribe } from './state/store.js?v=20261022-2';
import { renderApp, renderAppBootstrap } from './ui/appRenderer.js?v=20261022-2';
import { bindManagement } from './ui/managementUI.js?v=20261022-2';

window.addEventListener('DOMContentLoaded', async () => {
  bindStaticEvents();
  bindDelegatedEvents();
  bindManagement();

  subscribe(() => {
    renderApp();
  });

  renderAppBootstrap();
  if (new URLSearchParams(location.search).get('room')) setSyncStatus('joining');
  document.getElementById('sync-text')?.addEventListener('click', syncToCloud);

  // 1. 初始化 Firebase 身份驗證
  const uid = await initFirebaseAuth();

  // 2. 檢查 URL 是否帶有 room 參數
  const params = new URLSearchParams(window.location.search);
  const room = sanitizeRoomId(params.get('room') || '');

  if (room && uid) {
    // 成功加入房間並啟動監聽
    try { await joinRoom(room); } catch (error) { showToast(error.message, 'error'); }
  }
});
