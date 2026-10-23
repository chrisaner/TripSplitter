import { financialState, settlementReport, expenseAllocation, CURRENCIES, decimals, money } from '../core/ledger.js?v=20261023-travel2';
import { escapeHtml as esc } from '../utils.js?v=20261023-travel2';
export function tripReportHtml(raw,room,at=new Date().toISOString()) {
  const state=financialState(raw), name=id=>id==='pool'?'公積金':state.members.find(m=>m.id===id)?.name || id;
  const fmt=(value,c)=>`${money(value,c)} ${c}`;
  const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">無紀錄</td></tr>`}</tbody></table>`;
  const groups=settlementReport(state);
  let body=`<h1>TripSplitter 旅程結算報告</h1><p>旅程：${esc(room || 'local')} · 帳目版本：${state.revision}</p><p>產生時間：${esc(at)}（UTC）</p><p>此報告為匯出時快照。公積金支付不重複列入個人代墊；待確認還款不抵扣欠款。</p>`;
  body+=`<h2>結算方式</h2>${state.settlementSettings?`<p>統一結算為 ${esc(state.settlementSettings.currency)}；固定匯率儲存於 ${esc(state.settlementSettings.at)}。${esc(state.settlementSettings.note)}</p>${table(['原幣','1 單位原幣換結算幣'],Object.entries(state.settlementSettings.rates).map(([c,r])=>[c,r]))}`:'<p>各幣別分開結算。</p>'}`;
  for(const g of groups)body+=`<h2>${g.currency} 待付款</h2>${table(['付款人','收款人','待付金額'],g.transactions.map(t=>[name(t.from),name(t.to),fmt(t.amount,g.currency)]))}${table(['成員','剩餘淨額（正為待收、負為待付）'],state.members.map(m=>[m.name,fmt(g.balances[m.id]/10**decimals(g.currency),g.currency)]))}`;
  body+=`<h2>還款追蹤</h2>${table(['付款人','收款人','金額','狀態','登記時間／備註'],state.repayments.map(r=>[name(r.from),name(r.to),fmt(r.amount,r.currency),({pending:'已付待確認',confirmed:'已確認收款',cancelled:'已取消'})[r.status],`${r.at} ${r.note || ''}`]))}`;
  for(const m of state.members) {
    const rows=[];
    for(const e of state.expenses) {
      const {paid,owed}=expenseAllocation(e,state);
      if((owed[m.id] || 0) || (paid[m.id] || 0))rows.push([e.time,e.title,e.currency,fmt((paid[m.id] || 0)/10**decimals(e.currency),e.currency),fmt((owed[m.id] || 0)/10**decimals(e.currency),e.currency),e.payer==='pool'?'公積金支付，排除代墊結算':({equal:'均分',amount:'指定金額',percent:'百分比',shares:'份數'})[e.splitMode || 'equal']]);
    }
    body+=`<section><h2>${esc(m.name)} 個人明細</h2>${table(['時間','項目','原幣','個人代付','分攤額','說明'],rows)}</section>`;
  }
  body+=`<h2>公積金收支與退款</h2>${table(['幣別','歷史期初','入金','調整','支出','已退款','剩餘'],CURRENCIES.filter(c=>state.poolOpening[c] || state.poolBalances[c] || state.poolEntries.some(e=>e.currency===c) || state.expenses.some(e=>e.currency===c && e.payer==='pool')).map(c=>{
    const sum=kind=>state.poolEntries.filter(e=>e.currency===c && e.kind===kind).reduce((n,e)=>n+Number(e.amount),0);
    return [c,fmt(state.poolOpening[c],c),fmt(sum('deposit'),c),fmt(sum('adjustment'),c),fmt(state.expenses.filter(e=>e.currency===c && e.payer==='pool').reduce((n,e)=>n+Number(e.amount),0),c),fmt(-sum('refund'),c),fmt(state.poolBalances[c],c)];
  }))}<p>歷史期初可能未記錄個別出資人；尚未退款的餘額需另行記錄退還對象。</p>${table(['時間','類型','成員','金額','備註'],state.poolEntries.map(e=>[e.at,({deposit:'入金',refund:'退款',adjustment:'調整'})[e.kind],name(e.memberId || '未指定'),fmt(e.amount,e.currency),e.note || '']))}${table(['時間','公積金支出','原幣金額'],state.expenses.filter(e=>e.payer==='pool').map(e=>[e.time,e.title,fmt(e.amount,e.currency)]))}`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>TripSplitter 結算報告 - ${esc(room)}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;color:#26314a;font-size:10pt;line-height:1.5;margin:0;padding:24px;max-width:1100px}h1{font-size:23pt;color:#3b3f8c;border-bottom:3px solid #6366f1;padding-bottom:12px}h2{font-size:14pt;color:#3b3f8c;margin:24px 0 10px;break-after:avoid}p{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:10px 0 18px;table-layout:fixed}th,td{border:1px solid #d7deeb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2ff;font-weight:700}tr{break-inside:avoid}thead{display:table-header-group}.toolbar{padding:16px;background:#eef2ff;position:sticky;top:0}button{padding:10px;border:0;border-radius:8px;background:#4f46e5;color:white;cursor:pointer}@media print{body{padding:0;max-width:none}.toolbar{display:none}a{color:inherit}}</style></head><body><div class="toolbar"><button id="print-report">列印／儲存為 PDF</button> 請在列印目的地選擇「另存為 PDF」。</div>${body}<script>document.getElementById('print-report').addEventListener('click',()=>window.print());</script></body></html>`;
}
export function printTripReport(state,room) {
  const html=tripReportHtml(state,room);
  document.getElementById('trip-report-preview')?.remove();
  const overlay=document.createElement('div');overlay.id='trip-report-preview';overlay.className='trip-report-preview';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','旅程結算報告預覽');
  const toolbar=document.createElement('div');toolbar.className='report-toolbar';
  const print=document.createElement('button');print.className='management-button';print.textContent='列印／另存 PDF';
  const close=document.createElement('button');close.className='management-button';close.textContent='關閉報告';
  const frame=document.createElement('iframe');frame.title='旅程結算報告內容';frame.srcdoc=html;
  print.addEventListener('click',()=>{frame.contentWindow.focus();frame.contentWindow.print();});close.addEventListener('click',()=>{overlay.remove();document.getElementById('print-trip-report')?.focus();});
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape')close.click();});
  toolbar.append(print,close);overlay.append(toolbar,frame);document.getElementById('secured-app').append(overlay);close.focus();
}
