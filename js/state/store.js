import { state, setState, saveLocalState } from '../state.js';

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function commit(updater, options = { persist: true }) {
  const draft = structuredClone(state);
  updater(draft);
  setState(draft);

  if (options.persist) {
    saveLocalState();
  }

  listeners.forEach((listener) => listener(state));
}