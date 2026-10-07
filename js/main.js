import './firebase.js';
import './state.js';
import './data.js';

import { sanitizeRoomId } from './utils.js';
import { updateSyncUI } from './ui.js';
import { bindStaticEvents, bindDelegatedEvents } from './events.js';
import { initFirebaseAuth, joinRoom } from './services/syncService.js';
import { subscribe } from './state/store.js';
import { renderApp, renderAppBootstrap } from './ui/appRenderer.js';

window.addEventListener('DOMContentLoaded', async () => {
  bindStaticEvents();
  bindDelegatedEvents();

  subscribe(() => {
    renderApp();
  });

  renderAppBootstrap();

  // 1. 初始化 Firebase 身份驗證
  const uid = await initFirebaseAuth();

  // 2. 檢查 URL 是否帶有 room 參數
  const params = new URLSearchParams(window.location.search);
  const room = sanitizeRoomId(params.get('room') || '');

  if (room && uid) {
    // 成功加入房間並啟動監聽
    await joinRoom(room);
    updateSyncUI(true, room);
  } else {
    // 未加入房間，維持本地模式
    updateSyncUI(false);
  }
});
