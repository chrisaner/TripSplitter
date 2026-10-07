import { state, DEFAULT_STATE, SUPPORTED_CURRENCIES } from './state.js';

export function getPoolBalance(currency) {
  return Number(state.poolBalances?.[currency] || 0);
}

export function setPoolBalance(currency, amount) {
  if (!state.poolBalances) {
    state.poolBalances = { ...DEFAULT_STATE.poolBalances };
  }
  state.poolBalances[currency] = Number(amount || 0);
}

export function addPoolBalance(currency, amount) {
  const current = getPoolBalance(currency);
  setPoolBalance(currency, current + Number(amount || 0));
}

export function getNonZeroPoolCurrencies() {
  return SUPPORTED_CURRENCIES.filter((cur) => getPoolBalance(cur) !== 0);
}

export function getPoolHeaderText(poolDisplayIndex = 0) {
  const activeCurrencies = getNonZeroPoolCurrencies();
  if (activeCurrencies.length === 0) return '0 TWD';
  if (activeCurrencies.length === 1) {
    const cur = activeCurrencies[0];
    return `${getPoolBalance(cur).toLocaleString()} ${cur}`;
  }
  const cur = activeCurrencies[poolDisplayIndex % activeCurrencies.length];
  return `${getPoolBalance(cur).toLocaleString()} ${cur}`;
}

export function buildExpenseSummaryByCurrency() {
  const totals = {};
  SUPPORTED_CURRENCIES.forEach((cur) => { totals[cur] = 0; });

  state.expenses.forEach((e) => {
    const cur = e.currency || 'TWD';
    if (totals[cur] == null) totals[cur] = 0;
    totals[cur] += Number(e.amount || 0);
  });

  return SUPPORTED_CURRENCIES
    .filter((cur) => totals[cur] > 0)
    .map((cur) => ({ currency: cur, amount: totals[cur] }));
}
