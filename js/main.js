import { bindSettlement } from './ui/settlementUI.js?v=20261023-travel1';
import './firebase.js?v=20261023-travel1';
import './state.js?v=20261023-travel1';
import './data.js?v=20261023-travel1';

import { bindStaticEvents, bindDelegatedEvents } from './events.js?v=20261023-travel1';
import { syncToCloud } from './services/syncService.js?v=20261023-travel1';
import { bindAccount, renderAccount } from './ui/accountUI.js?v=20261023-travel1';
import { subscribe } from './state/store.js?v=20261023-travel1';
import { renderApp, renderAppBootstrap } from './ui/appRenderer.js?v=20261023-travel1';
import { bindManagement } from './ui/managementUI.js?v=20261023-travel1';
import { stopOCRWatch } from './services/ocrService.js?v=20261023-travel1';
import { getSyncContext } from './services/syncService.js?v=20261023-travel1';

window.addEventListener('DOMContentLoaded', async () => {
  bindStaticEvents();
  bindSettlement();
  bindDelegatedEvents();
  bindManagement();

  subscribe(() => {
    if(!getSyncContext().ready)stopOCRWatch();
    renderApp();
    renderAccount();
  });

  renderAppBootstrap();
  document.getElementById('sync-text')?.addEventListener('click', syncToCloud);

  bindAccount();
});
