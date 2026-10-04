import test from 'node:test';
import assert from 'node:assert/strict';
import {PaperService,paperInitial} from '../paper.mjs';
import {makeSession,sessionTotals} from '../session.mjs';
import {ProviderError} from '../alpaca.mjs';
import {adoptLegs,flattenOrders,bracketPrices} from '../protection.mjs';

const now=Date.parse('2026-09-25T15:35:10Z');
function fixture(){
 const s=paperInitial();Object.assign(s,{running:true,halted:false,connected:true,accountId:'fixture',lastSync:new Date(now).toISOString(),day:'2026-09-25',dayStart:100000,account:{id:'fixture',equity:'100000',cash:'100000',buying_power:'100000',last_equity:'100000',status:'ACTIVE'},clock:{is_open:true,timestamp:new Date(now).toISOString(),next_close:'2026-09-25T20:00:00Z'},assets:{AAPL:{class:'us_equity',tradable:true,status:'active'}},quotes:{AAPL:{ap:100,bp:99.99,t:new Date(now).toISOString()}},history:{AAPL:[{timestamp:'2026-09-25T15:30:00Z',volume:100000}]}});
 s.session=makeSession({date:'2026-09-25',capital:2000,profile:'scalp'},s,now);Object.assign(s.session,{status:'running',openAt:'2026-09-25T13:30:00Z',closeAt:'2026-09-25T20:00:00Z'});
 let roots=[],positions=[];const sent=[],cancelled=[],writes=[];let cancelMode='normal';
 const p=new PaperService({state:s,save:v=>writes.push(structuredClone(v)),now:()=>now});p.s=s;p.s.session.status='running';p.s.session.autoAfterConnect=false;
 const client={account:async()=>s.account,positions:async()=>structuredClone(positions),orders:async()=>structuredClone(roots),clock:async()=>s.clock,quotes:async()=>({quotes:s.quotes}),
  order:async id=>{const o=flattenOrders(roots).find(o=>o.client_order_id===id);if(!o)throw new ProviderError(404,'missing');return o;},orderById:async id=>structuredClone(roots.find(o=>o.id===id)),
  submit:async o=>{sent.push(o);const remote={...o,id:'order-'+sent.length,status:'new',filled_qty:'0'};if(o.order_class==='bracket')remote.legs=[{id:'target',client_order_id:'target-client',symbol:o.symbol,side:'sell',type:'limit',qty:o.qty,status:'held',filled_qty:'0',limit_price:o.take_profit.limit_price},{id:'stop',client_order_id:'stop-client',symbol:o.symbol,side:'sell',type:'stop',qty:o.qty,status:'held',filled_qty:'0',stop_price:o.stop_loss.stop_price}];roots.push(remote);return structuredClone(remote);},
  cancel:async id=>{cancelled.push(id);if(cancelMode==='race'){fillTarget();return;}for(const o of flattenOrders(roots).filter(o=>o.id===id)){const raw=roots.flatMap(r=>[r,...r.legs||[]]).find(r=>r.id===id);raw.status=cancelMode==='pending'?'pending_cancel':'canceled';}}
 };
 p.client=client;
 function fillEntry(qty=14){const r=roots[0];Object.assign(r,{status:qty===14?'filled':'partially_filled',filled_qty:String(qty),filled_avg_price:r.limit_price,filled_at:'2026-09-25T15:15:00Z'});for(const leg of r.legs)leg.status=qty===14?'new':'held';positions=[{symbol:'AAPL',qty:String(qty),avg_entry_price:r.limit_price,market_value:String(qty*100)}];}
 function fillTarget(){const r=roots[0];Object.assign(r.legs[0],{status:'filled',filled_qty:r.filled_qty,filled_avg_price:r.legs[0].limit_price,filled_at:new Date(now).toISOString()});r.legs[1].status='canceled';positions=[];}
 return {p,client,sent,cancelled,writes,roots:()=>roots,fillEntry,fillTarget,setMode:m=>cancelMode=m,setPositions:x=>positions=x};
}
const idea=()=>({id:'protected-entry',symbol:'AAPL',qty:14,reference:100,strategy:'scalp',barTime:'2026-09-25T15:30:00Z',expiresAt:now+90000,status:'pending'});
async function entered(){const f=fixture();await f.p.submit(idea(),'buy','test');f.fillEntry();await f.p.sync();return f;}

test('new protected session records intent before bracket submit and captures quote measurements',async()=>{
 const f=fixture();await f.p.submit(idea(),'buy','test');const o=f.sent[0];
 assert.equal(o.order_class,'bracket');assert.equal(o.time_in_force,'gtc');assert.equal(o.stop_loss.stop_price,'99.61');assert.equal(o.take_profit.limit_price,'100.83');assert.equal(o.stop_loss.limit_price,undefined);
 assert.equal(f.writes[0].intents[0].status,'submitting');assert.equal(f.writes[0].intents[0].quoteAsk,100);assert.equal(f.p.s.intents.length,3);
 assert.throws(()=>bracketPrices(NaN,f.p.settings()),/Invalid/);
});
test('broker target fills reconcile ownership, session profit and nested legs without double counting',async()=>{
 const f=await entered();assert.deepEqual(f.p.protection().unprotected,[]);assert.equal(f.p.owned('AAPL'),14);
 f.fillTarget();await f.p.sync();assert.equal(f.p.owned('AAPL'),0);assert.equal(sessionTotals(f.p.s).entries,1);assert.equal(sessionTotals(f.p.s).exits,1);assert.ok(Math.abs(sessionTotals(f.p.s).pnl-11.34)<1e-6);
 await f.p.sync();assert.equal(f.p.s.intents.length,3);assert.equal(f.sent.length,1);assert.equal(flattenOrders([f.roots()[0],f.roots()[0].legs[0]]).length,3);
});
test('time exit waits for terminal cancellation, survives restart and never churns a pending market exit',async()=>{
 const f=await entered();f.setMode('pending');await f.p.exits();assert.equal(f.sent.length,1);assert.ok(f.p.s.exitRequests.AAPL);
 const restarted=new PaperService({state:structuredClone(f.p.s),now:()=>now});restarted.client=f.client;f.setMode('normal');await restarted.sync();await restarted.exits();assert.equal(f.sent.length,2);assert.equal(f.sent[1].side,'sell');assert.equal(f.sent[1].qty,'14');
 const cancels=f.cancelled.length;await restarted.sync();await restarted.exits();assert.equal(f.sent.length,2);assert.equal(f.cancelled.length,cancels);
});
test('protective fill racing cancellation prevents an additional market sell',async()=>{
 const f=await entered();f.setMode('race');await f.p.exits();assert.equal(f.sent.length,1);assert.equal(f.p.owned('AAPL'),0);assert.equal(f.p.s.exitRequests.AAPL,undefined);
});
test('partial entry with inactive broker protection halts entries and closes only filled shares',async()=>{
 const f=fixture();await f.p.submit(idea(),'buy','test');f.fillEntry(2);await f.p.poll();
 assert.equal(f.p.s.running,false);assert.equal(f.sent.length,2);assert.equal(f.sent[1].qty,'2');assert.equal(f.sent[1].side,'sell');assert.ok(f.cancelled.includes('order-1'));
});
test('stopping entries retains active broker protective legs',async()=>{
 const f=await entered();await f.p.stop();assert.equal(f.p.s.running,false);assert.equal(f.cancelled.length,0);assert.deepEqual(f.p.protection().unprotected,[]);
});
test('lost bracket response recovers parent and child identities after restart without resubmitting',async()=>{
 const f=fixture(),submit=f.client.submit;f.client.submit=async o=>{await submit(o);throw new ProviderError(0,'timeout');};
 await assert.rejects(f.p.submit(idea(),'buy','test'),/timeout/);assert.equal(f.p.s.intents[0].status,'unknown');
 const p=new PaperService({state:structuredClone(f.p.s),now:()=>now});p.client=f.client;await p.sync();assert.equal(p.s.intents[0].status,'new');assert.equal(p.s.intents.length,3);assert.equal(f.sent.length,1);assert.equal(p.s.running,false);
});
test('external nested orders cannot be adopted as app protection',()=>{
 const intents=[{client_order_id:'mine',symbol:'AAPL',side:'buy',order_class:'bracket'}];
 adoptLegs(intents,[{client_order_id:'external',legs:[{id:'x',symbol:'AAPL',side:'sell'}]}]);assert.equal(intents.length,1);
 assert.throws(()=>adoptLegs(intents,[{client_order_id:'mine',legs:[{id:'x',client_order_id:'x',symbol:'MSFT',side:'sell'}]}]),/identity/);
});

test('partial target followed by resized stop reconciles a complete position cycle',async()=>{
 const f=await entered(),root=f.roots()[0];
 Object.assign(root.legs[0],{status:'partially_filled',filled_qty:'4',filled_avg_price:'100.83'});root.legs[1].qty='10';f.setPositions([{symbol:'AAPL',qty:'10',market_value:'1000',avg_entry_price:'100.02'}]);
 await f.p.sync();assert.equal(f.p.owned('AAPL'),10);assert.deepEqual(f.p.protection().unprotected,[]);assert.equal(f.p.s.intents.find(i=>i.brokerId==='stop').qty,'10');
 Object.assign(root.legs[1],{status:'filled',filled_qty:'10',filled_avg_price:'99.61'});root.legs[0].status='canceled';f.setPositions([]);await f.p.sync();
 assert.equal(f.p.owned('AAPL'),0);assert.equal(sessionTotals(f.p.s).valid,true);assert.ok(Math.abs(sessionTotals(f.p.s).pnl+.86)<1e-6);
});
test('a rare double protective fill reports ownership conflict and attention rather than a completed session',async()=>{
 const f=await entered(),root=f.roots()[0];f.fillTarget();Object.assign(root.legs[1],{status:'filled',filled_qty:'14',filled_avg_price:'99.61'});f.setPositions([{symbol:'AAPL',qty:'-14',market_value:'-1394.54',avg_entry_price:'99.61'}]);
 const closed=Date.parse('2026-09-25T20:05:00Z');f.p.now=()=>closed;f.client.clock=async()=>({is_open:false,timestamp:new Date(closed).toISOString(),next_close:'2026-09-28T20:00:00Z'});
 await f.p.poll();assert.equal(f.p.s.running,false);assert.deepEqual(f.p.s.ownershipConflicts,['AAPL']);assert.equal(sessionTotals(f.p.s).valid,false);assert.equal(f.p.s.session.status,'attention');assert.equal(f.sent.length,1);
});
test('protective parent lookup recovers legs when the recent order list contains only children',async()=>{
 const f=await entered();let reads=0;f.client.orders=async()=>structuredClone(f.roots()[0].legs);const lookup=f.client.orderById;f.client.orderById=async id=>{reads++;return lookup(id);};
 await f.p.sync();assert.equal(reads,1);assert.deepEqual(f.p.protection().unprotected,[]);assert.equal(f.p.s.intents.length,3);assert.equal(f.sent.length,1);
});

test('a pending exit blocks new buys until reconciled even when cash and position slots are available',async()=>{
 const f=fixture();f.p.s.exitRequests={MSFT:{reason:'Time exit'}};
 await assert.rejects(f.p.submit(idea(),'buy','test'),/exit is pending/);assert.equal(f.sent.length,0);
});
