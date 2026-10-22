import { financialState, validateSnapshot, CURRENCIES } from './ledger.js?v=20261022-3';

export function createBackup(state, roomId, pendingOperations = []) {
  return { format: 'TripSplitterBackup', version: 1, roomId: roomId || 'local', exportedAt: new Date().toISOString(),
    receiptNotice: '收據保留連結；不包含雲端照片原始檔。', data: financialState(state), pendingOperations };
}
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) throw new Error('備份檔不可超過 20 MB');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('無法解析 JSON 備份檔'); }
  if (parsed?.format !== 'TripSplitterBackup' || parsed.version !== 1) throw new Error('請選擇 TripSplitter 匯出的 JSON 備份檔');
  return { ...parsed, data: validateSnapshot(parsed.data) };
}
export function csvCell(value) {
  let text = String(value ?? '');
  // Do not let names or notes become formulas when opened in Excel/Sheets.
  if (typeof value !== 'number' && /^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function exportCsv(raw) {
  const state = financialState(raw);
  const name = id => id === 'pool' ? '公積金' : state.members.find(m=>m.id===id)?.name || id || '';
  const rows = [['類型','ID','日期','名稱／備註','幣別','金額','付款人／入金或退款成員','分攤成員','狀態','紀錄署名']];
  for (const [entries,status] of [[state.expenses,'有效'],[state.trash,'已刪除']]) {
    for (const e of entries) rows.push(['支出',e.id,e.time,e.title,e.currency,e.amount,name(e.payer),e.split.map(name).join('、'),status,'']);
  }
  for (const c of CURRENCIES) if (state.poolOpening[c]) rows.push(['公積金歷史期初','', '', '歷史入金合計，個別來源未記錄',c,state.poolOpening[c],'','','期初','']);
  for (const e of state.poolEntries) rows.push([({deposit:'入金',refund:'退款',adjustment:'餘額調整'})[e.kind],e.id,e.at,e.note,e.currency,e.amount,name(e.memberId),'','有效',e.actor?.name || '']);
  return '\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
