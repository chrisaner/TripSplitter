import { renderAll, renderMainCats } from '../ui.js';
import { renderExpenseModal } from './expenseModalUI.js';
import { refreshPoolModalDisplay } from '../app.js';

export function renderApp() {
  renderAll();

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