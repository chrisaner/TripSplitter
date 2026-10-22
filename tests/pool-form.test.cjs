const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const update=source.slice(source.indexOf('export function updatePool'),source.indexOf('export function refreshPoolModalDisplay')).replace('export function','function');
function form(amount,note) {
  const calls=[];let focused=false;
  const elements={'pool-input':{value:amount,focus(){focused=true;},scrollIntoView(){}},'pool-input-error':{hidden:true,textContent:''},'pool-currency-select':{value:'JPY'},'pool-note':{value:note},'pool-member-select':{value:''}};
  const context=vm.createContext({document:{getElementById:id=>elements[id]},getPoolBalance:()=>5791,dispatchOperation:(...args)=>calls.push(args),refreshPoolModalDisplay(){},renderAll(){},showToast(){}});
  vm.runInContext(update+"\nupdatePool('add');",context);
  return {elements,calls,focused};
}
test('a number entered only in notes does not change the balance and points to the amount field',()=>{
  const result=form('','10000');
  assert.equal(result.calls.length,0);assert.equal(result.focused,true);
  assert.equal(result.elements['pool-input-error'].hidden,false);
  assert.match(result.elements['pool-input-error'].textContent,/金額（必填）/);
  assert.equal(result.elements['pool-note'].value,'10000');
});
test('10000 in the amount field submits 10000 JPY while preserving the note as a note',()=>{
  const result=form('10000','共同旅費');
  assert.equal(result.calls.length,1);assert.equal(result.calls[0][1].amount,'10000');
  assert.equal(result.calls[0][1].currency,'JPY');assert.equal(result.calls[0][1].note,'共同旅費');
  assert.equal(result.elements['pool-input'].value,'');
});
