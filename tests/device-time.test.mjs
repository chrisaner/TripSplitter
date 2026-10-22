import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getLocalISOString } from '../js/utils.js';

const utilsUrl = new URL('../js/utils.js',import.meta.url).href;
const instant='2026-10-22T16:15:00.000Z';
for (const [zone,expected,offset] of [
  ['Asia/Taipei','2026-10-23T00:15','+08:00'],
  ['Asia/Tokyo','2026-10-23T01:15','+09:00'],
  ['America/New_York','2026-10-22T12:15','-04:00'],
  ['America/Los_Angeles','2026-10-22T09:15','-07:00'],
  ['Asia/Kathmandu','2026-10-22T22:00','+05:45'],
  ['UTC','2026-10-22T16:15','+00:00'],
]) {
  test(`device clock uses ${zone} including date rollover`,()=>{
    const script=`import {getLocalISOString,getDeviceTimeZoneLabel} from ${JSON.stringify(utilsUrl)}; console.log(JSON.stringify({time:getLocalISOString(${JSON.stringify(instant)}),zone:getDeviceTimeZoneLabel(${JSON.stringify(instant)})}));`;
    const actual=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ:zone}}));
    assert.equal(actual.time,expected);assert.ok(actual.zone.endsWith(`UTC${offset}`));
  });
}
test('the same device honors winter daylight-saving offset changes',()=>{
  const script=`import {getLocalISOString,getDeviceTimeZoneLabel} from ${JSON.stringify(utilsUrl)}; console.log(JSON.stringify({time:getLocalISOString('2026-01-22T16:15:00Z'),zone:getDeviceTimeZoneLabel('2026-01-22T16:15:00Z')}));`;
  const actual=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ:'America/New_York'}}));
  assert.equal(actual.time,'2026-01-22T11:15');assert.ok(actual.zone.endsWith('UTC-05:00'));
});
test('every new modal opening gets a fresh device-local time, while editing preserves stored time',()=>{
  const code=readFileSync(new URL('../js/modal.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  let draft, calls=0;
  const context=vm.createContext({
    state:{members:[{id:'a'}],categories:{food:{subs:['午餐']}},expenses:[{id:'old',time:'2020-01-01T09:30',split:['a']}]},
    getLocalISOString:()=>`2026-10-23T01:${String(15+calls++).padStart(2,'0')}`,
    resetExpenseDraft:value=>{draft=value;},renderExpenseModal(){},
    localStorage:{getItem:()=>null},document:{getElementById:()=>null},
  });
  vm.runInContext(code,context);
  context.openExpenseModal();assert.equal(draft.time,'2026-10-23T01:15');
  context.openExpenseModal();assert.equal(draft.time,'2026-10-23T01:16');
  context.openExpenseModal('old');assert.equal(draft.time,'2020-01-01T09:30');assert.equal(calls,2);
});
test('an explicit Unix epoch is not mistaken for the current clock',()=>{
  assert.equal(getLocalISOString(0),getLocalISOString(new Date(0)));
});
