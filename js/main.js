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
  updateSyncUI(false);

  await initFirebaseAuth();

  const params = new URLSearchParams(window.location.search);
  const room = sanitizeRoomId(params.get('room') || '');
  if (room) {
    await joinRoom(room);
  }
});