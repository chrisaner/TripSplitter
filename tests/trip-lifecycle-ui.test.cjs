const fs=require('fs'),vm=require('vm'),{test}=require('node:test'),assert=require('node:assert/strict');
const {escapeHtml}=require('../js/utils.js');
test('trip recycle bin shows only restoreable buttons and escapes supplied journey codes',()=>{
  const source=fs.readFileSync('js/ui/accountUI.js','utf8'),start=source.indexOf('export function roomListHtml'),end=source.indexOf('async function loadRoomList',start);
  const context=vm.createContext({escapeHtml,roleName:r=>r});vm.runInContext(source.slice(start,end).replace('export ',''),context);
  const html=context.roomListHtml([{roomId:'active',role:'owner'},{roomId:'deleted',role:'owner',deletion:{purgeAfter:1800000000000,canRestore:true}},{roomId:'<img src=x>',role:'owner',deletion:{purgeAfter:1800000000000,canRestore:false}}]);
  assert.match(html,/data-join-room="active"/);assert.match(html,/data-restore-room="deleted"/);assert.match(html,/已到期，待永久清除/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
