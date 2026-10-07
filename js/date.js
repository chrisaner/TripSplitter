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
	
	export function buildExpenseSummaryByCurrency() {
      const totals = {};
      SUPPORTED_CURRENCIES.forEach(cur => totals[cur] = 0);

      state.expenses.forEach(e => {
        const cur = e.currency || 'TWD';
        if (!totals[cur]) totals[cur] = 0;
        totals[cur] += Number(e.amount || 0);
      });

      return SUPPORTED_CURRENCIES
        .filter(cur => totals[cur] > 0)
        .map(cur => ({ currency: cur, amount: totals[cur] }));
    }
