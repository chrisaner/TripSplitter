import { getState } from '../state/store.js?v=20261022-5';
import { dispatchOperation } from './syncService.js?v=20261022-5';
import { showToast } from './errorService.js?v=20261022-5';

export function saveCurrentMember(name, emoji) {
  try {
    const state = getState();
    const id = state.editingMemberId || `m_${crypto.randomUUID()}`;
    const result = dispatchOperation('member.save', { id, name, emoji }, state.editingMemberId ? state.editingMemberRevision || 0 : 0);
    state.editingMemberId = null;
    return result;
  } catch (error) { showToast(error.message, 'error'); return false; }
}
export function deleteMemberById(id) {
  try {
    const member = getState().members.find(m => m.id === id);
    if (!member) return false;
    return dispatchOperation('member.archive', { id, archived: !member.archived }, member._rev || 0);
  } catch (error) { showToast(error.message, 'error'); return false; }
}
