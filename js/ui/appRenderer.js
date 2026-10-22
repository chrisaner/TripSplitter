import { renderAll, renderMainCats } from '../ui.js?v=20261022-4';
import { renderExpenseModal } from './expenseModalUI.js?v=20261022-4';
import { refreshPoolModalDisplay } from '../app.js?v=20261022-4';
import { renderManagement } from './managementUI.js?v=20261022-4';

export function renderApp() {
  renderAll();
  renderManagement();

  const expenseModal = document.getElementById('expenseModal');
  const isExpenseModalOpen = expenseModal && expenseModal.style.display === 'flex';
  if (isExpenseModalOpen) {
    renderExpenseModal();
  }

  const poolModal = document.getElementById('poolModal');
  const isPoolModalOpen = poolModal && poolModal.style.display === 'flex';
  if (isPoolModalOpen) {
    refreshPoolModalDisplay();
  }
}

export function renderAppBootstrap() {
  renderMainCats();
  renderApp();
}
