import { state } from '../state.js?v=20261023-travel2';
import { settlementReport, CURRENCIES, money, units, decimals } from '../core/ledger.js?v=20261023-travel2';
import { escapeHtml as esc } from '../utils.js?v=20261023-travel2';
import { dispatchOperation, getSyncContext, canOperate, isRoomAdmin } from '../services/syncService.js?v=20261023-travel2';
import { showToast } from '../services/errorService.js?v=20261023-travel2';
import { printTripReport } from './tripReport.js?v=20261023-travel2';
const name=id=>state.members.find(m=>m.id===id)?.name || id;
const button=(text,attr,disabled=false)=>`<button type="button" class="management-button" ${attr} ${disabled?'disabled':''}>${text}</button>`;
function available(g,t) {
  const pending=(state.repayments || []).filter(r=>r.status==='pending' && r.currency===g.currency);
  return Math.max(0,Math.min(units(t.amount,g.currency),-g.balances[t.from]-pending.filter(r=>r.from===t.from).reduce((n,r)=>n+units(r.amount,g.currency),0),g.balances[t.to]-pending.filter(r=>r.to===t.to).reduce((n,r)=>n+units(r.amount,g.currency),0)))/10**decimals(g.currency);
}
export function renderSettlement() {
  const host=document.getElementById('settlement-workspace');if(!host)return;
  const ctx=getSyncContext(), settings=state.settlementSettings;
  const key=`${ctx.currentUserUid}:${ctx.currentRoomId}:${settings?._rev || 0}:${Boolean(settings)}:${ctx.role}:${ctx.access?.memberId}`;
  const locked=(state.repayments || []).some(r=>r.status!=='cancelled');
  if(host.dataset.key!==key) {
    host.dataset.key=key;
    const currency=settings?.currency || 'TWD';
    const options=CURRENCIES.map(c=>`<option ${c===currency?'selected':''}>${c}</option>`).join('');
    host.innerHTML=`<div class="management-card space-y-3"><h3>結算方式與匯率</h3><p class="empty-note">目前：${settings?'跨幣結算為 '+esc(currency):'各幣別分別結算'}。原始帳目金額保留。儲存後全旅程共用固定匯率；有有效還款時鎖定現有匯率。</p><label for="settlement-currency">結算幣別</label><select id="settlement-currency" class="management-input">${options}</select><div id="settlement-rates" class="space-y-2"></div><label for="settlement-rate-note">匯率來源／備註</label><input id="settlement-rate-note" class="management-input" maxlength="200" value="${esc(settings?.note || '')}" placeholder="例如：信用卡實際換匯匯率"><div class="flex gap-2 flex-wrap">${button('儲存跨幣匯率','id="save-settlement-settings"',!isRoomAdmin())}${button('改回各幣結算','id="clear-settlement-settings"',!isRoomAdmin())}</div><p id="settlement-lock-note" class="empty-note"></p></div>
      <div class="management-card space-y-3"><h3>登記已付款／部分還款</h3><p class="empty-note">尚未付款請依下方待付款建議轉帳；登記後為「已付款，待收款方確認」，確認後才抵扣。一般成員只能登記自己的付款。</p><label for="repayment-from">付款人</label><select id="repayment-from" class="management-input"></select><label for="repayment-to">收款人</label><select id="repayment-to" class="management-input"></select><label for="repayment-currency">還款幣別</label><select id="repayment-currency" class="management-input"></select><label for="repayment-amount">已付金額</label><input id="repayment-amount" class="management-input" type="number" min="0" step="any" placeholder="可輸入部分還款金額"><label for="repayment-note">備註</label><input id="repayment-note" class="management-input" maxlength="200" placeholder="例如：轉帳末五碼"><button id="save-repayment" type="button" class="management-button">登記已付款</button></div>
      <div class="management-card space-y-3"><h3>旅程結算報告</h3><p class="empty-note">包含個人明細、待付款、還款紀錄、公積金入金／支出／退款。列印視窗選擇「另存為 PDF」。</p>${button('列印／儲存 PDF','id="print-trip-report"')}</div>`;
    renderRateInputs();
  }
  document.getElementById('settlement-lock-note').textContent=locked?'已有還款：結算幣別與現有匯率已鎖定，仍可新增其他幣別匯率。':'請填入 1 單位原幣可換多少結算幣別；未輸入的幣別不可用於跨幣結算。';
  for(const id of ['clear-settlement-settings','settlement-currency'])document.getElementById(id).disabled=!isRoomAdmin() || locked;
  document.querySelectorAll('[data-rate]').forEach(el=>el.disabled=!isRoomAdmin() || (locked && Boolean(settings?.rates[el.dataset.rate])) || el.dataset.rate===document.getElementById('settlement-currency').value);
  const memberOptions=state.members.map(m=>`<option value="${m.id}">${esc(m.name)}${m.archived?'（已停用）':''}</option>`).join('');
  for(const id of ['repayment-from','repayment-to']) {
    const el=document.getElementById(id),previous=el.value;el.innerHTML=memberOptions;el.value=state.members.some(m=>m.id===previous)?previous:state.members[0]?.id || '';
  }
  if(!isRoomAdmin()){document.getElementById('repayment-from').value=ctx.access?.memberId || '';document.getElementById('repayment-from').disabled=true;}
  const curr=document.getElementById('repayment-currency'), previous=curr.value;
  curr.innerHTML=(settings?[settings.currency]:CURRENCIES).map(c=>`<option>${c}</option>`).join('');if([...curr.options].some(o=>o.value===previous))curr.value=previous;
  document.getElementById('save-repayment').disabled=!isRoomAdmin() && (ctx.role!=='member' || !ctx.access?.memberId);
  const filter=document.getElementById('settle-member-filter')?.value || 'all';
  const container=document.getElementById('settle-currency-groups');
  try {
    const groups=settlementReport(state);
    container.innerHTML=groups.map(g=>`<div class="space-y-3"><h3 class="font-black text-lg text-[#3b3f8c]">${esc(g.currency)} 結算區 · 待付款</h3>${g.transactions.filter(t=>filter==='all' || t.from===filter).map(t=>`<div class="management-card"><p>${esc(name(t.from))} ➜ ${esc(name(t.to))}</p><strong>${money(t.amount,g.currency)} ${g.currency}</strong><p class="empty-note">扣除待確認登記後，可再登記：${money(available(g,t),g.currency)} ${g.currency}</p><div>${button('登記此筆付款',`data-pay-from="${t.from}" data-pay-to="${t.to}" data-pay-currency="${g.currency}" data-pay-amount="${available(g,t)}"`,!canOperate('repayment.save',{from:t.from}) || available(g,t)<=0)}</div></div>`).join('') || `<p class="empty-note">${filter!=='all'?'該成員在此幣別無須支付款項':state.expenses.filter(e=>e.currency===g.currency).every(e=>e.payer==='pool')&&!settings?'此幣別皆由公積金支付，無須個人轉帳':'此幣別無須個人轉帳'}</p>`}</div>`).join('') || '<p class="empty-note">暫無結算資料。</p>';
  } catch(error) {container.textContent=error.message;}
  container.innerHTML+=`<div class="space-y-3"><h3 class="font-black">還款紀錄</h3>${[...(state.repayments || [])].reverse().map(r=>`<div class="management-card"><p>${esc(name(r.from))} → ${esc(name(r.to))} · ${money(r.amount,r.currency)} ${r.currency}</p><p>${({pending:'已付款，待確認',confirmed:'已收款確認',cancelled:'已取消'})[r.status]}</p><p class="empty-note">${esc(r.note || '')} · ${esc(r.at || '')}</p><div class="flex gap-2">${r.status==='pending'?button('確認收款',`data-repayment-confirm="${r.id}"`,!canOperate('repayment.confirm',{id:r.id})):''}${r.status!=='cancelled'?button('取消紀錄',`data-repayment-cancel="${r.id}"`,!canOperate('repayment.cancel',{id:r.id})):''}</div></div>`).join('') || '<p class="empty-note">尚無還款紀錄。</p>'}</div>`;
}
function renderRateInputs() {
  const c=document.getElementById('settlement-currency').value, settings=state.settlementSettings;
  document.getElementById('settlement-rates').innerHTML=CURRENCIES.map(src=>`<label class="rate-row"><span>1 ${src} =</span><input class="management-input"  aria-label="${src} 匯率" type="number" step="any" min="0.00000001" data-rate="${src}" value="${src===c?1:settings?.currency===c?settings.rates[src] || '':''}" ${src===c?'disabled':''}><span>${c}</span></label>`).join('');
}
export function bindSettlement() {
  document.getElementById('page-settle').addEventListener('change',event=>{if(event.target.id==='settlement-currency')renderRateInputs();});
  document.getElementById('page-settle').addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target || target.disabled)return;
    try {
      if(target.id==='save-settlement-settings') {
        const rates={};document.querySelectorAll('[data-rate]').forEach(el=>{if(el.value.trim())rates[el.dataset.rate]=Number(el.value);});
        dispatchOperation('settlement.settings',{currency:document.getElementById('settlement-currency').value,rates,note:document.getElementById('settlement-rate-note').value},state.revision || 0);
      } else if(target.id==='clear-settlement-settings') {
        if(confirm('改回各幣別分開結算？原始帳目不會變動。'))dispatchOperation('settlement.settings',{},state.revision || 0);
      } else if(target.id==='save-repayment') {
        dispatchOperation('repayment.save',{id:crypto.randomUUID(),from:document.getElementById('repayment-from').value,to:document.getElementById('repayment-to').value,currency:document.getElementById('repayment-currency').value,amount:document.getElementById('repayment-amount').value,note:document.getElementById('repayment-note').value});
        document.getElementById('repayment-amount').value='';document.getElementById('repayment-note').value='';showToast('付款已登記，待收款方確認','success');
      } else if(target.dataset.payFrom) {
        document.getElementById('repayment-from').value=target.dataset.payFrom;document.getElementById('repayment-to').value=target.dataset.payTo;document.getElementById('repayment-currency').value=target.dataset.payCurrency;document.getElementById('repayment-amount').value=target.dataset.payAmount;document.getElementById('repayment-amount').focus();document.getElementById('repayment-amount').scrollIntoView({block:'center',behavior:'smooth'});
      } else if(target.dataset.repaymentConfirm || target.dataset.repaymentCancel) {
        const action=target.dataset.repaymentConfirm?'confirm':'cancel', id=target.dataset.repaymentConfirm || target.dataset.repaymentCancel,r=state.repayments.find(r=>r.id===id);
        if(r && confirm(action==='confirm'?'確認已收到此款項，並抵扣待付款？':'取消此筆還款紀錄？已確認款項將回復為待付款。'))dispatchOperation(`repayment.${action}`,{id},r._rev);
      } else if(target.id==='print-trip-report') {
        if(getSyncContext().pendingCount || getSyncContext().status!=='synced')throw new Error('請先完成同步，再匯出正式結算報告');
        printTripReport(state,getSyncContext().currentRoomId);
      }
    } catch(error){showToast(error.message,'error');}
  });
}
