import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,prepare,demoData,evaluate,signal,signalPriority,buyRisk,tick,account} from '../engine.mjs';
import {PROFILES} from '../profiles.mjs';
import {makeSession,sessionTotals} from '../session.mjs';
import {entryRisk,PaperService,paperInitial} from '../paper.mjs';

const now=Date.parse('2026-09-25T15:35:10Z');
function state(){
 const s=paperInitial();Object.assign(s,{connected:true,running:true,halted:false,day:'2026-09-25',dayStart:100000,lastSync:new Date(now).toISOString(),account:{status:'ACTIVE',equity:'100000',cash:'100000',buying_power:'100000'},clock:{is_open:true,timestamp:new Date(now).toISOString(),next_close:'2026-09-25T20:00:00Z'},assets:{AAPL:{class:'us_equity',status:'active',tradable:true}},quotes:{AAPL:{ap:100,bp:99.99,t:new Date(now).toISOString()}},history:{AAPL:[{timestamp:'2026-09-25T15:30:00Z',volume:100000}]}});
 s.session=makeSession({date:'2026-09-25',capital:2000,profile:'scalp'},s,now);
 Object.assign(s.session,{status:'running',openAt:'2026-09-25T13:30:00Z',closeAt:'2026-09-25T20:00:00Z'});return s;
}
const idea=qty=>({id:'scalp-entry',symbol:'AAPL',strategy:'scalp',qty,reference:100,expiresAt:now+90000});

test('larger scalp entries use allocated cash, retain risk caps and reserve a single position',()=>{
 const s=state(),c=s.session.settings;
 const checked=entryRisk(s,idea(14),c,now);
 assert.equal(checked.price,100.02);assert.equal(checked.qty,14);
 assert.ok(checked.qty*checked.price<=1500);assert.ok(checked.qty*checked.price*c.stopPct/100<=10);
 assert.throws(()=>entryRisk(s,idea(15),c,now),/exposure/);
 s.account.cash='1000';assert.throws(()=>entryRisk(s,idea(14),c,now),/cash/);s.account.cash='100000';
 s.positions=[{symbol:'MSFT',qty:'1',market_value:'100'}];assert.throws(()=>entryRisk(s,idea(14),c,now),/position count/);
});
test('scalp entry refuses wide spreads, missing liquidity and more than eight filled entries',()=>{
 const s=state(),c=s.session.settings;
 s.quotes.AAPL.bp=99.8;assert.throws(()=>entryRisk(s,idea(14),c,now),/Spread/);s.quotes.AAPL.bp=99.99;
 s.history.AAPL[0].volume=100;assert.throws(()=>entryRisk(s,idea(14),c,now),/volume/);s.history.AAPL[0].volume=100000;
 s.intents=Array.from({length:8},(_,i)=>[{symbol:'MSFT',side:'buy',filled_qty:'1',filled_avg_price:'100',status:'filled',createdAt:new Date(now-i*600000).toISOString()},{symbol:'MSFT',side:'sell',filled_qty:'1',filled_avg_price:'100',status:'filled'}]).flat();
 assert.equal(sessionTotals(s).equity,2000);assert.throws(()=>entryRisk(s,idea(14),c,now),/entry count/);
});
test('scalp cooldown lasts five minutes and session loss blocks larger entries',()=>{
 const s=state(),c=s.session.settings;
 s.intents=[{symbol:'MSFT',side:'buy',filled_qty:'1',filled_avg_price:'100',status:'filled'},{symbol:'AAPL',side:'sell',filled_qty:'1',filled_avg_price:'100',status:'filled',filled_at:new Date(now-299000).toISOString()}];
 // Test cooldown directly with a reconciled same-symbol round trip.
 s.intents[0].symbol='AAPL';s.intents[0].createdAt=new Date(now-600000).toISOString();
 assert.throws(()=>entryRisk(s,idea(14),c,now),/cooldown/);
 s.intents[1].filled_at=new Date(now-300000).toISOString();assert.equal(entryRisk(s,idea(14),c,now).qty,14);
 s.intents[1].filled_avg_price='60';assert.throws(()=>entryRisk(s,idea(14),c,now),/Daily loss/);
});
test('scalp protective exits react to stop, target and fifteen-minute holding limit',async()=>{
 for(const [bid,age,reason]of [[99.59,60000,'Stop threshold'],[100.81,60000,'Profit threshold'],[100,16*60000,'15-minute time exit']]){
  const s=state();s.quotes.AAPL.bp=bid;s.quotes.AAPL.ap=Math.max(100,bid+.01);
  s.positions=[{symbol:'AAPL',qty:'10',avg_entry_price:'100',market_value:String(bid*10)}];
  s.intents=[{symbol:'AAPL',side:'buy',qty:'10',filled_qty:'10',filled_avg_price:'100',status:'filled',strategy:'scalp',createdAt:new Date(now-age).toISOString(),filled_at:new Date(now-age).toISOString()}];
  const p=new PaperService({state:s,now:()=>now});p.s=s;let order;
  p.client={submit:async o=>{order=o;return {...o,id:'sell',status:'new',filled_qty:'0'};}};
  await p.exits();assert.equal(order.side,'sell');assert.equal(order.qty,'10');assert.equal(s.intents.at(-1).reason,reason);
 }
});
test('scalp signals need consecutive completed bars and volume-confirmed breakouts',()=>{
 const h=Array.from({length:8},(_,i)=>({timestamp:new Date(Date.parse('2026-09-25T13:30:00Z')+i*300000).toISOString(),minute:i*5,open:100,close:i===7?100.5:100+i*.02,high:i===7?100.6:100.2+i*.01,low:99.95,volume:i===7?1500:1000}));
 assert.match(signal(h,'scalp'),/Short-hold/);assert.equal(signalPriority(h,'scalp'),1.5);
 assert.equal(signal(h.slice(1),'scalp'),null);assert.equal(signal([...h.slice(0,7),{...h[7],volume:1000}],'scalp'),null);
 assert.equal(signal([...h.slice(0,7),{...h[7],timestamp:'2026-09-25T14:10:00Z'}],'scalp'),null);
});
test('research compares scalping with its actual larger-position and shorter-exit profile',()=>{
 const r=evaluate(prepare(demoData()),initial().settings),scalp=r.results.find(x=>x.strategy==='scalp');
 assert.equal(r.version,3);assert.equal(scalp.settings.positionPct,75);assert.equal(scalp.settings.maxHoldMinutes,15);
 assert.equal(scalp.settings.maxEntriesDay,8);assert.ok(scalp.test.entries<=r.testDays*8);
 assert.equal(r.results.find(x=>x.strategy==='baseline').settings.positionPct,25);
 assert.equal(r.evidence.status,'insufficient');
});
