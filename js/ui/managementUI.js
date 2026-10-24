import { state } from '../state.js?v=20261024-trip1';
import { escapeHtml } from '../utils.js?v=20261024-trip1';
import { money } from '../core/ledger.js?v=20261024-trip1';
import { createBackup, parseBackup, exportCsv } from '../core/backup.js?v=20261024-trip1';
import { getSyncContext, pendingOperations, dispatchOperation, discardPending } from '../services/syncService.js?v=20261024-trip1';
import { showToast } from '../services/errorService.js?v=20261024-trip1';
import { switchTab } from '../app.js?v=20261024-trip1';
import { recordPage, HISTORY_PAGE_SIZE, TRASH_PAGE_SIZE } from '../core/recordPages.js?v=20261024-trip1';
import { renderAccount } from './accountUI.js?v=20261024-trip1';

let selectedBackup = null;
let historyPage = 0, trashPage = 0, pageRoom = null;
function pager(data, kind, size) {
  if (!data.total) return '';
  const name = kind === 'history' ? '異動紀錄' : '刪除復原';
  return `<div class="record-pager"><p class="empty-note">第 ${data.page+1} / ${data.pages} 頁 · 每頁最多 ${size} 項 · 共 ${data.total} 項</p><div class="flex gap-2"><button class="management-button" data-${kind}-page="-1" aria-label="${name}上一頁" ${data.page===0?'disabled':''}>上一頁</button><button class="management-button" data-${kind}-page="1" aria-label="${name}下一頁" ${data.page===data.pages-1?'disabled':''}>下一頁</button></div></div>`;
}
const label = type => ({ 'expense.save':'儲存支出', 'expense.delete':'刪除支出', 'expense.restore':'復原支出', 'member.save':'儲存成員', 'member.archive':'變更成員啟用狀態', 'pool.change':'公積金異動', 'backup.restore':'還原備份','settlement.settings':'結算匯率設定','repayment.save':'登記付款','repayment.confirm':'確認收款','repayment.cancel':'取消還款','room.delete':'刪除旅程','room.restore':'復原旅程' })[type] || type;
function describe(entry, currency) {
  if (!entry) return '無';
  const name = id => state.members.find(m=>m.id===id)?.name || (id==='pool'?'公積金':'未指定');
  if(entry.status==='active' || entry.status==='deleted')return entry.status==='active'?'旅程可使用':`旅程已刪除\n復原期限：${new Date(entry.purgeAfter).toLocaleString('zh-TW')}`;
  if (entry.from && entry.to) return `${name(entry.from)} → ${name(entry.to)}\n${money(entry.amount,entry.currency)} ${entry.currency}\n${({pending:'已付待確認',confirmed:'已確認收款',cancelled:'已取消'})[entry.status] || ''}\n${entry.note || ''}`;
  if (entry.rates) return `結算幣別：${entry.currency}\n${Object.entries(entry.rates).map(([c,r])=>'1 '+c+' = '+r+' '+entry.currency).join('\n')}\n${entry.note || ''}`;
  if (entry.payer) return `${entry.title}\n${money(entry.amount,entry.currency)} ${entry.currency}\n付款：${entry.payers?Object.entries(entry.payers).map(([id,n])=>name(id)+': '+n).join('、'):name(entry.payer)}\n分攤：${(entry.split || []).map(name).join('、')}\n日期：${entry.time}`;
  if (entry.name) return `${entry.name} ${entry.emoji || ''}\n${entry.archived?'已停用':'使用中'}`;
  if (entry.kind) return `${({deposit:'入金',refund:'退還餘額',adjustment:'餘額調整'})[entry.kind]}：${money(entry.amount,entry.currency)} ${entry.currency}\n成員：${name(entry.memberId)}\n${entry.note || ''}`;
  if (entry.balance !== undefined) return `餘額：${money(entry.balance,currency)} ${currency || ''}`;
  if (typeof entry.members==='number') return `${entry.members} 位成員、${entry.expenses} 筆支出\n${Object.entries(entry.poolBalances || {}).filter(([,amount])=>amount).map(([c,amount])=>`${c} 公積金：${money(amount,c)}`).join('\n')}`;
  return '已更新';
}
export function download(text, filename, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function filename(suffix) { return `TripSplitter-${getSyncContext().currentRoomId || 'local'}-${new Date().toISOString().replace(/[:.]/g,'-')}.${suffix}`; }
export function downloadBackup(prefix = '') {
  download(JSON.stringify(createBackup(state,getSyncContext().currentRoomId,pendingOperations()),null,2),prefix+filename('json'));
}
export function renderManagement() {
  const actor = document.getElementById('actor-select');
  const room = getSyncContext().currentRoomId || 'local';
  const pageKey=`${getSyncContext().currentUserUid || ''}:${room}`;
  if (pageKey !== pageRoom) { historyPage = 0; trashPage = 0; pageRoom = pageKey;selectedBackup=null;const restore=document.getElementById('restore-backup');if(restore)restore.disabled=true; }
  if (actor) {
    const selected = localStorage.getItem(`tripSplitterActor:${room}`) || '';
    actor.innerHTML = '<option value="">未指定（仍記錄裝置識別）</option>' + state.members.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.archived?'（已停用）':''}</option>`).join('');
    actor.value = selected;
  }
  const history = document.getElementById('audit-list');
  const historyData = recordPage(Object.entries(state.history || {}).map(([id,h])=>({...h,id})),historyPage,HISTORY_PAGE_SIZE,'at');
  historyPage = historyData.page;
  if (history) history.innerHTML = historyData.items.map(h=>`
    <div class="management-card"><details><summary><strong>${escapeHtml(label(h.type))} ${escapeHtml(h.after?.title || h.before?.title || h.after?.name || '')}</strong> · ${escapeHtml(h.actor?.name || '未指定操作者')}<small>${escapeHtml(h.at ? new Date(h.at).toLocaleString('zh-TW') : '')} · ${h.actor?.email?'帳號 '+escapeHtml(h.actor.email):'舊裝置 '+escapeHtml((h.actor?.uid || '').slice(-8))}</small></summary><div class="audit-detail"><strong>變更前</strong><p>${escapeHtml(describe(h.before,h.after?.currency))}</p><strong>變更後</strong><p>${escapeHtml(describe(h.after,h.after?.currency))}</p></div></details><button class="management-button danger mt-3" data-history-delete-id="${escapeHtml(h.id)}">刪除此異動紀錄</button></div>`).join('') || '<p class="empty-note">尚無異動紀錄；舊版未記錄的操作無法回溯。</p>';
  const historyPager = document.getElementById('audit-pagination');
  if (historyPager) historyPager.innerHTML = pager(historyData,'history',HISTORY_PAGE_SIZE);
  const trash = document.getElementById('trash-list');
  const trashData = recordPage(state.trash || [],trashPage,TRASH_PAGE_SIZE,'_deletedAt');
  trashPage = trashData.page;
  if (trash) trash.innerHTML = trashData.items.map(e=>`<div class="management-card"><strong>${escapeHtml(e.title)}</strong><p>${money(e.amount,e.currency)} ${escapeHtml(e.currency)}</p><small>${escapeHtml(e._deletedBy?.name || '')} · ${escapeHtml(e._deletedAt ? new Date(e._deletedAt).toLocaleString('zh-TW') : '')}</small><div class="flex flex-wrap gap-2 mt-3"><button class="management-button" data-restore-id="${escapeHtml(e.id)}">復原這筆支出</button><button class="management-button danger" data-trash-delete-id="${escapeHtml(e.id)}">移除復原紀錄</button></div></div>`).join('') || '<p class="empty-note">沒有可復原的支出。</p>';
  const trashPager = document.getElementById('trash-pagination');
  if (trashPager) trashPager.innerHTML = pager(trashData,'trash',TRASH_PAGE_SIZE);
  const context = getSyncContext();
  const sync = document.getElementById('management-sync');
  if (sync) sync.textContent = `待同步操作：${context.pendingCount} 筆。異動由登入帳號署名，雲端會驗證權限。`;
  renderPoolDetails();
  if(typeof renderAccount==='function')renderAccount();
}
export function renderPoolDetails() {
  const currency = document.getElementById('pool-currency-select')?.value || 'TWD';
  const select = document.getElementById('pool-member-select');
  if (select) { const current=select.value; select.innerHTML='<option value="">共同入金／未指定</option>'+state.members.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join(''); select.value=current; }
  const box = document.getElementById('pool-ledger');
  if (!box) return;
  const entries = (state.poolEntries || []).filter(e=>e.currency===currency);
  const spending = state.expenses.filter(e=>e.currency===currency && e.payer==='pool');
  const total = kind => entries.filter(e=>e.kind===kind).reduce((sum,e)=>sum+e.amount,0);
  const spent = spending.reduce((sum,e)=>sum+e.amount,0);
  box.innerHTML=`<div class="management-card"><h4>公積金明細 · ${currency}</h4><p>歷史期初：${money(state.poolOpening?.[currency] || 0,currency)}</p><small>依既有餘額與已記錄支出推算，來源與過往調整未記錄。</small><p>新入金：${money(total('deposit'),currency)}</p><p>支出：${money(spent,currency)}</p><p>已退款：${money(-total('refund'),currency)}</p><p>調整：${money(total('adjustment'),currency)}</p><strong>剩餘：${money(state.poolBalances[currency],currency)} ${currency}</strong></div>`;
  const records=[...entries.map(e=>({...e,title:({deposit:'入金',refund:'退還餘額',adjustment:'餘額調整'})[e.kind],person:state.members.find(m=>m.id===e.memberId)?.name || '共同／未指定'})), ...spending.map(e=>({id:e.id,at:e.time,title:e.title,amount:-e.amount,person:'公積金支付',note:''}))].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  box.innerHTML+=records.map(e=>`<div class="management-card"><strong>${escapeHtml(e.title)}</strong><p>${money(e.amount,currency)} ${currency} · ${escapeHtml(e.person)}</p><small>${escapeHtml(e.at ? new Date(e.at).toLocaleString('zh-TW') : '')}</small><p>${escapeHtml(e.note || '')}</p></div>`).join('') || '<p class="empty-note">尚無新明細。</p>';
}
export function bindManagement() {
  document.getElementById('audit-pagination').addEventListener('click',event=>{
    const button=event.target.closest('[data-history-page]');if(!button || button.disabled)return;
    historyPage+=Number(button.dataset.historyPage);renderManagement();
  });
  document.getElementById('trash-pagination').addEventListener('click',event=>{
    const button=event.target.closest('[data-trash-page]');if(!button || button.disabled)return;
    trashPage+=Number(button.dataset.trashPage);renderManagement();
  });
  document.getElementById('audit-list').addEventListener('click',event=>{
    const id=event.target.closest('[data-history-delete-id]')?.dataset.historyDeleteId;if(!id)return;
    if (!confirm('刪除此異動紀錄？原帳目與公積金不會變動，這筆異動紀錄將無法從此處找回。')) return;
    try { dispatchOperation('history.delete',{id}); } catch(error){showToast(error.message,'error');}
  });
  document.getElementById('nav-tools').addEventListener('click',()=>{switchTab('tools');renderManagement();});
  document.getElementById('actor-select').addEventListener('change',event=>localStorage.setItem(`tripSplitterActor:${getSyncContext().currentRoomId || 'local'}`,event.target.value));
  document.getElementById('export-json').addEventListener('click',()=>downloadBackup());
  document.getElementById('export-csv').addEventListener('click',()=>download(exportCsv(state),filename('csv'),'text/csv;charset=utf-8'));
  document.getElementById('import-json').addEventListener('change',async event=>{
    selectedBackup=null; const preview=document.getElementById('restore-preview'); const button=document.getElementById('restore-backup'); button.disabled=true;
    try {
      const file=event.target.files[0];if(!file)return;
      if(file.size>20*1024*1024)throw new Error('備份檔不可超過 20 MB');
      const backup=parseBackup(await file.text());
      selectedBackup={...backup,expectedRevision:state.revision || 0, targetRoom:getSyncContext().currentRoomId};
      preview.textContent=`來源：${backup.roomId}；${backup.data.members.length} 位成員、${backup.data.expenses.length} 筆支出、${backup.data.trash.length} 筆刪除紀錄。還原會取代目前房間帳目。${backup.pendingOperations?.length?'此備份包含匯出時尚未同步的變更。':''}`;
      button.disabled=false;
    } catch(error){preview.textContent=error.message;}
  });
  document.getElementById('restore-backup').addEventListener('click',()=>{
    try {
      if(!selectedBackup)return;
      const context=getSyncContext();
      if(context.pendingCount || (context.currentRoomId && context.status!=='synced'))throw new Error('請先完成同步再還原備份');
      if(selectedBackup.targetRoom!==context.currentRoomId)throw new Error('房間已切換，請重新選擇備份');
      if(!confirm(`確定以備份取代目前房間「${context.currentRoomId || '本地'}」的帳目？系統會先下載還原前備份。`))return;
      downloadBackup('還原前-');
      dispatchOperation('backup.restore',{snapshot:selectedBackup.data},selectedBackup.expectedRevision);
      selectedBackup=null;document.getElementById('restore-backup').disabled=true;document.getElementById('restore-preview').textContent='已套用備份，請確認上方同步狀態。';
      showToast('備份已套用，異動紀錄已保留','success');
    } catch(error){showToast(error.message,'error');}
  });
  document.getElementById('trash-list').addEventListener('click',event=>{
    const deleteId=event.target.closest('[data-trash-delete-id]')?.dataset.trashDeleteId;
    if (deleteId) {
      const entry=state.trash.find(e=>String(e.id)===deleteId);if(!entry)return;
      const revision=state.tombstones[deleteId];
      if (!confirm(`移除「${entry.title}」的復原紀錄？移除後無法在此處復原，現有帳目與公積金不會變動。`)) return;
      try { dispatchOperation('trash.delete',{id:entry.id},revision); } catch(error){showToast(error.message,'error');}
      return;
    }
    const id=event.target.closest('[data-restore-id]')?.dataset.restoreId;if(!id)return;
    try { const entry=state.trash.find(e=>String(e.id)===id);const revision=state.tombstones[id];if(entry && confirm('復原這筆支出並重新計入結算與公積金？'))dispatchOperation('expense.restore',{id:entry.id},revision); }
    catch(error){showToast(error.message,'error');}
  });
  document.getElementById('export-pending').addEventListener('click',()=>download(JSON.stringify({room:getSyncContext().currentRoomId,pending:pendingOperations()},null,2),'待同步變更.json'));
  document.getElementById('discard-pending').addEventListener('click',()=>{
    if(confirm('保留雲端版本並取消此裝置全部待同步變更？系統會先下載這些變更。')) {
      download(JSON.stringify(pendingOperations(),null,2),'取消前的待同步變更.json');
      try { discardPending(); } catch(error){showToast(error.message,'error');}
    }
  });
}
