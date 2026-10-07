import { getState, commit } from './store.js';
import { getLocalISOString } from '../utils.js';

function buildDefaultExpenseDraft() {
  const state = getState();
  return {
    id: null,
    cat: 'food',
    sub: '午餐',
    title: '午餐',
    amount: '',
    currency: 'TWD',
    time: getLocalISOString(),
    payer: 'pool',
    split: state.members.map((m) => m.id),
    receipt: null,
    ocr: {
      status: 'idle',
      jobId: null,
      draftId: null,
      result: null,
      error: null
    }
  };
}

export function getExpenseDraft() {
  return getState().expenseDraft || buildDefaultExpenseDraft();
}

export function resetExpenseDraft(overrides = {}) {
  const base = buildDefaultExpenseDraft();

  commit((root) => {
    root.expenseDraft = {
      ...base,
      ...overrides,
      ocr: {
        ...base.ocr,
        ...(overrides.ocr || {})
      }
    };
  }, { persist: false });
}

export function updateExpenseDraft(patch) {
  commit((root) => {
    const current = root.expenseDraft || buildDefaultExpenseDraft();

    root.expenseDraft = {
      ...current,
      ...patch,
      ocr: patch.ocr
        ? {
            ...current.ocr,
            ...patch.ocr
          }
        : current.ocr
    };
  }, { persist: false });
}

export function updateExpenseDraftSplit(split) {
  commit((root) => {
    const current = root.expenseDraft || buildDefaultExpenseDraft();
    root.expenseDraft = {
      ...current,
      split: [...split]
    };
  }, { persist: false });
}

export function clearExpenseDraft() {
  commit((root) => {
    root.expenseDraft = buildDefaultExpenseDraft();
  }, { persist: false });
}