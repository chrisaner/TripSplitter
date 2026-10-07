import { getState, commit } from '../state/store.js';

export function saveCurrentMember(name, emoji) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  const current = getState();

  commit((draft) => {
    if (current.editingMemberId) {
      const idx = draft.members.findIndex((m) => m.id === current.editingMemberId);
      if (idx !== -1) {
        draft.members[idx] = {
          ...draft.members[idx],
          name: trimmed,
          emoji
        };
      }
    } else {
      draft.members.push({
        id: `m${Date.now()}`,
        name: trimmed,
        emoji
      });
    }

    draft.editingMemberId = null;
  });

  return true;
}

export function deleteMemberById(id) {
  commit((draft) => {
    draft.members = draft.members.filter((m) => m.id !== id);

    draft.expenses = draft.expenses
      .map((e) => ({
        ...e,
        split: e.split.filter((mid) => mid !== id),
        payer: e.payer === id ? 'pool' : e.payer
      }))
      .filter((e) => e.split.length > 0);
  });

  return true;
}