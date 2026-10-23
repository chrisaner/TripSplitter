import { state, setState, saveLocalState } from '../state.js?v=20261023-auth2';

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() { listeners.forEach(listener => listener(state)); }

export function commit(updater, options = { persist: true }) {
  const draft = structuredClone(state);
  updater(draft);
  setState(draft);

  if (options.persist) {
    saveLocalState();
  }

  notify();
}
