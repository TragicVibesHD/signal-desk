import test from 'node:test';
import assert from 'node:assert/strict';
import {PaperService,paperInitial,entryCapacity,entryRisk} from '../paper.mjs';
import {makeSession} from '../session.mjs';
import {initial,tick,account} from '../engine.mjs';
import {completedTrades,tradeMetrics} from '../metrics.mjs';

const start=Date.parse('2026-09-25T15:35:10Z');
function fixture(profile='scalp'){
 const s=paperInitial();Object.assign(s,{connected:true,running:true,halted:false,mode:'approval',accountId:'audit-paper',day:'2026-09-25',lastSync:new Date(start).toISOString(),dayStart:100000,
  account:{id:'audit-paper',status:'ACTIVE',equity:'100000',cash:'100000',buying_power:'100000',last_equity:'100000'},
  clock:{is_open:true,timestamp:new Date(start).toISOString(),next_close:'2026-09-25T20:00:00Z'},
  assets:{AAPL:{class:'us_equity',status:'active',tradable:true}},quotes:{AAPL:{ap:99.9,bp:99.89,t:new Date(start).toISOString()}},
  history:{AAPL:[{symbol:'AAPL',timestamp:'2026-09-25T15:30:00Z',minute:120,open:99.9,high:99.9,low:99.9,close:99.9,volume:100000}]}});
 s.session=makeSession({date:s.day,capital:2000,profile},s,start);
 Object.assign(s.session,{status:'running',openAt:'2026-09-25T13:30:00Z',closeAt:'2026-09-25T20:00:00Z'});return s;
}
const idea=(s,qty)=>({id:'test-entry',symbol:'AAPL',strategy:'momentum',qty,reference:99.9,barTime:s.history.AAPL.at(-1).timestamp,expiresAt:start+80000});

test('exact limit sizing uses a spare whole share without increasing allocation or risk',()=>{
 const s=fixture(),c=s.session.settings;
 // Flat history does not represent a momentum signal; use the legacy manual risk fixture.
 const i={...idea(s,15),strategy:'manual'},size=entryCapacity(s,'AAPL',c,start);
 assert.equal(size.price,99.92);assert.equal(size.qty,15);assert.equal(size.notional,1498.8);
 assert.equal(Math.floor(1500/(99.9*1.003)),14);
 assert.deepEqual(entryRisk(s,i,c,start),{qty:15,price:99.92});
 assert.throws(()=>entryRisk(s,{...i,qty:16},c,start),/exposure/);
});
test('capacity accounts for cent-rounded stop risk instead of proposing a rejected quantity',()=>{
 const s=fixture(),c={...s.session.settings,riskPct:.305};s.quotes.AAPL.ap=100;s.quotes.AAPL.bp=99.99;c.positionPct=100;c.grossPct=100;
 const size=entryCapacity(s,'AAPL',c,start);assert.equal(size.qty,14);
 assert.deepEqual(entryRisk(s,{...idea(s,14),strategy:'manual',reference:100},c,start),{qty:14,price:100.02});
 assert.throws(()=>entryRisk(s,{...idea(s,15),strategy:'manual',reference:100},c,start),/Rounded broker stop/);
});
test('capacity subtracts active entry reservations and counts remaining gross exposure',()=>{
 const s=fixture(),c={...s.session.settings,maxPositions:4};
 s.intents=[{client_order_id:'reserved',side:'buy',symbol:'MSFT',status:'new',filled_qty:'0',createdAt:new Date(start).toISOString()}];
 s.orders=[{...s.intents[0],qty:'4',limit_price:'100'}];
 const size=entryCapacity(s,'AAPL',c,start);assert.equal(size.budget,1100);assert.equal(size.qty,11);
 assert.doesNotThrow(()=>entryRisk(s,{...idea(s,11),strategy:'manual'},c,start));
 assert.throws(()=>entryRisk(s,{...idea(s,12),strategy:'manual'},c,start),/exposure/);
 s.account.cash='450';assert.equal(entryCapacity(s,'AAPL',c,start).qty,0);
 s.account.cash='100000';s.history.AAPL[0].volume=100;assert.equal(entryCapacity(s,'AAPL',c,start).qty,1);
});

function polling(profile='baseline'){
 const s=fixture(profile);s.session.settings.brokerProtection=false;let now=start,quotes={};const sent=[],orders=[];
 let bars=Array.from({length:12},(_,i)=>({symbol:'AAPL',timestamp:new Date(start-310000-(11-i)*300000).toISOString(),minute:65+i*5,day:s.day,open:94.4+i*.5,high:94.6+i*.5,low:94.2+i*.5,close:94.4+i*.5,volume:100000}));
 if(profile==='scalp')bars=Array.from({length:8},(_,i)=>({symbol:'AAPL',timestamp:new Date(start-310000-(7-i)*300000).toISOString(),minute:85+i*5,day:s.day,open:100,high:i===7?100.6:100.2+i*.01,low:99.95,close:i===7?100.5:100+i*.02,volume:i===7?1500:1000}));
 const p=new PaperService({state:structuredClone(s),now:()=>now});p.s=s;
 p.client={account:async()=>s.account,positions:async()=>[],orders:async()=>orders,clock:async()=>({...s.clock,timestamp:new Date(now).toISOString()}),quotes:async()=>({quotes}),historical:async()=>({bars}),
  order:async()=>{throw Object.assign(Error('missing'),{status:404});},submit:async o=>{sent.push(o);const remote={...o,id:'broker-entry',status:'new',filled_qty:'0'};orders.push(remote);return remote;}};
 return {p,s,sent,quote:(ask=99.9,bid=99.89)=>{quotes={AAPL:{ap:ask,bp:bid,t:new Date(now).toISOString()}};},advance:ms=>{now+=ms;}};
}
test('a missing quote can recover on the same signal bar, but a recorded decline cannot retry',async()=>{
 const f=polling();await f.p.poll();assert.equal(f.s.suggestions.length,0);assert.equal(f.s.seen.AAPL,undefined);
 f.quote();await f.p.poll();assert.equal(f.s.suggestions.length,1);
 const i=f.s.suggestions[0];assert.equal(i.reference,f.s.history.AAPL.at(-1).close);
 assert.equal(i.expiresAt,Date.parse(i.barTime)+390000);
 f.p.decline(i.id);f.s.seen={};await f.p.poll();assert.equal(f.s.suggestions.length,1);assert.equal(f.sent.length,0);
});
test('wide spread deferrals recover within the original completed-bar window',async()=>{
 const f=polling('scalp');f.quote(100.5,100.3);await f.p.poll();assert.equal(f.s.suggestions.length,0);assert.match(f.s.session.scan.results[0].message,/Spread/);
 f.advance(10000);f.quote(100.5,100.49);await f.p.poll();assert.equal(f.s.suggestions.length,1);assert.equal(f.s.suggestions[0].expiresAt,start+80000);
});
test('a deferred signal never receives an extended freshness deadline',async()=>{
 const f=polling();await f.p.poll();f.advance(81000);f.quote();await f.p.poll();assert.equal(f.s.suggestions.length,0);assert.equal(f.sent.length,0);
 assert.match(f.s.session.scan.results[0].message,/expired|stale/);
});
test('an uncertain submission is consumed durably and cannot send again after restart',async()=>{
 const f=polling();f.s.mode='auto';f.quote();let attempts=0;
 f.p.client.submit=async()=>{attempts++;throw Object.assign(Error('response lost'),{status:0});};
 await f.p.poll();assert.equal(attempts,1);assert.equal(f.s.intents[0].status,'unknown');assert.equal(f.s.running,false);
 const p=new PaperService({state:structuredClone(f.s),now:()=>start});p.client=f.p.client;await p.poll();assert.equal(attempts,1);assert.equal(p.s.running,false);
});
test('live quote drift is measured from the signal close rather than its own fresh quote',async()=>{
 const f=polling();f.quote(100.45,100.44);await f.p.poll();assert.equal(f.s.suggestions.length,0);assert.match(f.s.session.scan.results[0].message,/Price moved/);
});
test('submission rejects lost breakout levels, recovered reversion and changed signal bars',()=>{
 const s=fixture('baseline'),c=s.session.settings;
 s.history.AAPL=[{...s.history.AAPL[0],minute:0,high:100.2,low:99.8,close:100},{...s.history.AAPL[0],high:100.3,low:100,close:100.3}];
 s.quotes.AAPL.ap=100.15;s.quotes.AAPL.bp=100.14;
 const i={...idea(s,4),reference:100.3,strategy:'activity'};
 assert.throws(()=>entryRisk(s,i,c,start),/breakout trigger/);
 s.history.AAPL=[{...s.history.AAPL[1],high:100,low:99.8,close:99.6}];s.quotes.AAPL.ap=99.9;s.quotes.AAPL.bp=99.89;
 assert.throws(()=>entryRisk(s,{...i,reference:99.6,strategy:'reversion'},c,start),/VWAP exit/);
 assert.throws(()=>entryRisk(s,{...i,strategy:'manual',reference:99.9,barTime:'2026-09-25T15:25:00Z'},c,start),/signal bar has changed/);
});
test('subcent fills and partial-exit fees reconcile completed-trade profits with actual replay cash',()=>{
 const s=initial();s.mode='auto';s.strategies=[];s.settings.spreadBps=1;s.settings.slippageBps=1;
 const bars=[100,100,101,101].map((price,i)=>({symbol:'AAPL',timestamp:new Date(Date.parse('2026-09-25T14:00:00Z')+i*300000).toISOString(),day:'2026-09-25',minute:30+i*5,open:price,high:price,low:price,close:price,volume:i===2?500:100000}));
 const data={frames:bars.map(b=>({timestamp:b.timestamp,day:b.day,minute:b.minute,bars:[b]}))};
 tick(s,data,0);s.queue.push({id:'precision',symbol:'AAPL',qty:90,strategy:'momentum',reference:100,status:'approved',createdCursor:0,expiresCursor:3,expiresAt:90000});
 tick(s,data,1000);s.flatten=true;tick(s,data,2000);tick(s,data,3000);
 const orders=[...s.orders].reverse(),trades=completedTrades(orders);assert.equal(trades.length,1);assert.equal(s.orders.find(o=>o.qty===5).fee,.025);
 assert.ok(Math.abs(trades[0].pnl-(s.cash-s.startingCash))<1e-8);
 assert.equal(tradeMetrics(trades).realized,account(s).pnl);
 const rounded=completedTrades(orders.map(o=>({...o,price:Math.round(o.price*100)/100,fee:Math.round(o.fee*100)/100})));
 assert.ok(Math.abs(rounded[0].pnl-trades[0].pnl)>.8);
});
