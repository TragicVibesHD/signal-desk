import test from 'node:test';
import assert from 'node:assert/strict';
import {Alpaca,PAPER_URL,DATA_URL,regularBars,ProviderError,UNIVERSE} from '../alpaca.mjs';
import {PaperService,paperInitial,entryRisk,freshQuote} from '../paper.mjs';
import {initial} from '../engine.mjs';
import {makeSession,exchangeTime,sessionTotals,sessionEntryCheck} from '../session.mjs';

const now=Date.parse('2026-09-25T15:35:10Z');
const config=()=>initial().settings;
function fixture(){
 const s=paperInitial();Object.assign(s,{connected:true,running:true,halted:false,lastSync:new Date(now).toISOString(),day:'2026-09-25',dayStart:100000,accountId:'paper-test',account:{id:'paper-test',status:'ACTIVE',equity:'100000',cash:'100000',buying_power:'100000',last_equity:'100000'},clock:{is_open:true,timestamp:new Date(now).toISOString(),next_close:'2026-09-25T20:00:00Z'},assets:{AAPL:{class:'us_equity',status:'active',tradable:true}},quotes:{AAPL:{ap:100,bp:99.99,t:new Date(now).toISOString()}},history:{AAPL:[{timestamp:'2026-09-25T15:30:00Z',volume:100000}]}});
 return s;
}
const idea=()=>({id:'idea-one',symbol:'AAPL',qty:10,reference:100,strategy:'momentum',reason:'Test rule',expiresAt:now+90000,status:'pending'});
function fakeClient(s){let orders=structuredClone(s.orders),positions=structuredClone(s.positions),submissions=[];return {
 submissions,account:async()=>structuredClone(s.account),clock:async()=>structuredClone(s.clock),positions:async()=>structuredClone(positions),orders:async()=>structuredClone(orders),quotes:async()=>({quotes:structuredClone(s.quotes)}),asset:async()=>({class:'us_equity',status:'active',tradable:true}),
 order:async id=>{const found=orders.find(o=>o.client_order_id===id);if(!found)throw new ProviderError(404,'missing');return structuredClone(found);},
 submit:async o=>{submissions.push(o);const remote={...o,id:'broker-'+submissions.length,status:'new',filled_qty:'0',filled_avg_price:null};orders.push(remote);return structuredClone(remote);},
 cancel:async id=>{const found=orders.find(o=>o.id===id);if(found)found.status='canceled';},
 setOrders:o=>{orders=o;},setPositions:p=>{positions=p;}
 };}
function service(){const s=fixture(),writes=[];const p=new PaperService({state:s,save:v=>writes.push(structuredClone(v)),now:()=>now});p.s=structuredClone(s);p.client=fakeClient(s);return {p,writes};}

test('paper adapter hardcodes paper/data hosts, blocks redirects, and never echoes rejected secrets',async()=>{
 const calls=[];const client=new Alpaca({key:'paper-test-key',secret:'paper-test-secret',fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response('{"secret":"paper-test-secret"}',{status:403});}});
 await assert.rejects(client.account(),/not permitted/);assert.equal(calls[0].url,PAPER_URL+'/v2/account');assert.equal(calls[0].opts.redirect,'error');
 await assert.rejects(client.request('https://api.alpaca.markets','/v2/orders',{method:'POST'}),/allowlisted/);
 await assert.rejects(client.request(DATA_URL,'/v2/orders',{method:'POST'}),/read-only/);
 assert.equal(JSON.stringify(client),'{}');
});
test('historical adapter paginates symbols, keeps provenance and removes unfinished/after-hours bars',async()=>{
 const calls=[];const calendar=[{date:'2026-09-25',open:'09:30',close:'16:00'}];
 const bar=t=>({t,o:100,h:101,l:99,c:100,v:50000});
 const client=new Alpaca({key:'paper-key',secret:'paper-secret',fetchImpl:async(url)=>{
 calls.push(url);if(url.includes('/calendar'))return Response.json(calendar);
 return Response.json(url.includes('page_token=second')?{bars:{MSFT:[bar('2026-09-25T14:00:00Z')]}}:{bars:{AAPL:[bar('2026-09-25T14:00:00Z'),bar('2026-09-25T12:00:00Z'),bar('2026-09-25T15:35:00Z')]},next_page_token:'second'});
 }});
 const d=await client.historical({start:'2026-09-25',end:'2026-09-25',stocks:['AAPL','MSFT'],now});
 assert.equal(d.bars.length,2);assert.equal(d.source.feed,'iex');assert.equal(d.synthetic,false);assert.equal(calls.length,3);assert.ok(calls[2].includes('page_token=second'));
 await assert.rejects(client.historical({start:'2026-09-25',end:'2026-09-25',stocks:['AAPL','MSFT'],now,maxPages:1}),/pagination/);
});
test('exchange calendar handles early close and excludes holidays',()=>{
 const b=t=>({t,o:100,h:101,l:99,c:100,v:10000});
 const bars=regularBars({AAPL:[b('2026-11-27T17:50:00Z'),b('2026-11-27T18:00:00Z'),b('2026-11-26T16:00:00Z')]},[{date:'2026-11-27',open:'09:30',close:'13:00'}],Date.parse('2026-11-28'));
 assert.equal(bars.length,1);assert.equal(bars[0].sessionCloseMinute,210);
});
test('fresh quote rejects stale, future and crossed markets',()=>{
 const q=fixture().quotes.AAPL;assert.equal(freshQuote(q,now).ask,100);
 assert.throws(()=>freshQuote(q,now+31000),/stale/);assert.throws(()=>freshQuote(q,now-6000),/stale/);assert.throws(()=>freshQuote({...q,bp:101},now),/Invalid/);
});
test('entry risk checks account, current clock, limits, reservations and closed markets',()=>{
 const s=fixture(),i=idea(),c=config();assert.deepEqual(entryRisk(s,i,c,now),{qty:10,price:100.1});
 s.clock.is_open=false;assert.throws(()=>entryRisk(s,i,c,now),/closed/);s.clock.is_open=true;
 s.orders=[{client_order_id:'external',status:'new'}];assert.throws(()=>entryRisk(s,i,c,now),/External/);s.orders=[];
 s.intents=[{status:'unknown'}];assert.throws(()=>entryRisk(s,i,c,now),/uncertain/);s.intents=[];
 s.account.cash='500';assert.throws(()=>entryRisk(s,i,c,now),/cash/);s.account.cash='100000';
 s.account.equity='97000';assert.throws(()=>entryRisk(s,i,c,now),/Daily/);s.account.equity='100000';
 s.clock.next_close=new Date(now+20*60000).toISOString();assert.throws(()=>entryRisk(s,i,c,now),/30 minutes/);
});
test('open entry reservations count against gross exposure and cash',()=>{
 const s=fixture(),i=idea(),c=config();s.orders=[{symbol:'MSFT',side:'buy',status:'new',qty:'95',filled_qty:'0',limit_price:'100',client_order_id:'owned'}];s.intents=[{client_order_id:'owned',status:'new'}];c.grossPct=10;
 assert.throws(()=>entryRisk(s,i,c,now),/exposure/);c.grossPct=40;s.account.cash='10000';assert.throws(()=>entryRisk(s,i,c,now),/cash/);
});
test('approval durably records the intent before submit and cannot double-send',async()=>{
 const {p,writes}=service();p.s.suggestions=[idea()];const original=p.client.submit;
 p.client.submit=async o=>{assert.ok(writes.some(w=>w.intents.some(i=>i.status==='submitting'&&i.client_order_id===o.client_order_id)));return original(o);};
 await p.approve('idea-one');assert.equal(p.client.submissions.length,1);assert.equal(p.s.suggestions[0].status,'submitted');assert.equal(p.client.submissions[0].type,'limit');
 await assert.rejects(p.approve('idea-one'),/no longer/);assert.equal(p.client.submissions.length,1);
});
test('ambiguous timeout blocks further entries and restart never resubmits',async()=>{
 const {p}=service();p.s.suggestions=[idea()];let attempts=0;
 p.client.submit=async()=>{attempts++;throw new ProviderError(0,'timeout');};
 await assert.rejects(p.approve('idea-one'),/timeout/);assert.equal(p.s.intents[0].status,'unknown');
 const restarted=new PaperService({state:structuredClone(p.s)});assert.equal(restarted.s.running,false);assert.equal(restarted.s.halted,true);assert.equal(restarted.s.intents[0].status,'unknown');assert.equal(attempts,1);
 await assert.rejects(p.start('auto'),/uncertain/);
});
test('reconciliation recovers an accepted order after response loss without resubmitting',async()=>{
 const {p}=service();p.s.intents=[{client_order_id:'sd-old',symbol:'AAPL',side:'buy',qty:'10',status:'unknown'}];
 p.client.setOrders([{id:'found',client_order_id:'sd-old',symbol:'AAPL',side:'buy',qty:'10',filled_qty:'4',status:'partially_filled',filled_avg_price:'100'}]);p.client.setPositions([{symbol:'AAPL',qty:'4',avg_entry_price:'100',market_value:'400'}]);
 await p.sync();assert.equal(p.s.intents[0].status,'partially_filled');assert.equal(p.owned('AAPL'),4);assert.equal(p.client.submissions.length,0);
});
test('stop cancels only app-owned buy orders; preserves external orders',async()=>{
 const {p}=service();p.s.intents=[{client_order_id:'sd-own',symbol:'AAPL',side:'buy',status:'new'}];p.client.setOrders([{id:'own',client_order_id:'sd-own',symbol:'AAPL',side:'buy',status:'new',filled_qty:'0'},{id:'other',client_order_id:'other',symbol:'MSFT',side:'buy',status:'new',filled_qty:'0'}]);
 await p.stop();assert.equal(p.s.halted,true);assert.equal(p.s.orders.find(o=>o.id==='own').status,'canceled');assert.equal(p.s.orders.find(o=>o.id==='other').status,'new');
});
test('stop during asynchronous start wins over enabling entries',async()=>{
 const {p}=service();let release;const old=p.client.account;p.client.account=async()=>{await new Promise(r=>release=r);return old();};
 const starting=p.start('auto');p.halt();release();await assert.rejects(starting,/interrupted/);assert.equal(p.s.running,false);
});
test('flatten uses app-owned shares, never closes external-only holdings, and defers closed sessions',async()=>{
 const {p}=service();p.s.intents=[{client_order_id:'bought',symbol:'AAPL',side:'buy',qty:'10',filled_qty:'10',status:'filled',createdAt:'2026-09-25T15:30:00Z',strategy:'momentum'}];
 p.client.setPositions([{symbol:'AAPL',qty:'10',avg_entry_price:'100',market_value:'1000'},{symbol:'MSFT',qty:'20',avg_entry_price:'200',market_value:'4000'}]);
 await p.flatten();assert.equal(p.client.submissions.length,1);assert.equal(p.client.submissions[0].symbol,'AAPL');assert.equal(p.client.submissions[0].qty,'10');assert.equal(p.client.submissions[0].side,'sell');assert.equal(p.s.flatten,true);
 const {p:q}=service();q.s.clock.is_open=false;q.s.flatten=true;q.s.positions=[{symbol:'AAPL',qty:'10'}];await q.exits();assert.equal(q.client.submissions.length,0);
});
test('mixed or externally changed holdings block automatic ownership assumptions',async()=>{
 const {p}=service();p.s.intents=[{client_order_id:'bought',symbol:'AAPL',side:'buy',qty:'10',filled_qty:'10',status:'filled'}];p.client.setPositions([{symbol:'AAPL',qty:'15',avg_entry_price:'100',market_value:'1500'}]);await p.sync();assert.deepEqual(p.s.ownershipConflicts,['AAPL']);p.s.flatten=true;await p.exits();assert.equal(p.client.submissions.length,0);assert.throws(()=>entryRisk(p.s,{...idea(),symbol:'MSFT'},config(),now));
});
test('current-market polling generates one approval per completed bar and automatic mode submits once',async()=>{
 for(const mode of ['approval','auto']){
  const {p}=service();p.s.mode=mode;
  p.client.historical=async()=>({bars:Array.from({length:12},(_,i)=>({symbol:'AAPL',timestamp:new Date(now-310000-(11-i)*300000).toISOString(),minute:65+i*5,day:'2026-09-25',open:94+i*.5,high:94.2+i*.5,low:93.8+i*.5,close:94+i*.5,volume:100000}))});
  await p.poll();assert.equal(p.s.suggestions.length,1);assert.equal(p.client.submissions.length,mode==='auto'?1:0);
  await p.poll();assert.equal(p.s.suggestions.length,1);assert.equal(p.client.submissions.length,mode==='auto'?1:0);
 }
});
test('daily loss guard runs even when no new signals exist',async()=>{
 const {p}=service();p.client.account=async()=>({...fixture().account,equity:'97000'});await p.poll();assert.equal(p.s.halted,true);assert.equal(p.s.running,false);assert.ok(p.s.logs.some(l=>l.message.includes('Daily loss')));
});
test('provider authentication failures do not expose secret values',async()=>{
 const secret='super-private-test-secret';const c=new Alpaca({key:'test-api-key',secret,fetchImpl:async()=>new Response(JSON.stringify({message:secret}),{status:401})});
 try{await c.account();assert.fail('Expected rejection');}catch(e){assert.equal(e.status,401);assert.ok(!e.message.includes(secret));}
});

function allocated(s=fixture()){
 s.session=makeSession({date:'2026-09-25',capital:2000},s,now);
 Object.assign(s.session,{status:'running',openAt:'2026-09-25T13:30:00Z',closeAt:'2026-09-25T20:00:00Z'});return s;
}
test('$2k allocation caps entries independently of the $100k broker balance',()=>{
 const s=allocated(),c=s.session.settings;
 assert.throws(()=>entryRisk(s,idea(),c,now),/exposure/);
 assert.equal(entryRisk(s,{...idea(),qty:4},c,now).qty,4);
 s.account.cash='200';assert.throws(()=>entryRisk(s,{...idea(),qty:4},c,now),/cash/);
});
test('session ledger reconciles partial fills, cash reservations and realized/unrealized P&L',()=>{
 const s=allocated();s.intents=[
 {client_order_id:'b1',symbol:'AAPL',side:'buy',qty:'5',filled_qty:'4',filled_avg_price:'100',status:'partially_filled'},
 {client_order_id:'b2',symbol:'MSFT',side:'buy',qty:'2',filled_qty:'2',filled_avg_price:'200',status:'filled'},
 {client_order_id:'s1',symbol:'MSFT',side:'sell',qty:'1',filled_qty:'1',filled_avg_price:'210',status:'filled'}];
 s.orders=[{...s.intents[0],limit_price:'100.1'}];s.positions=[{symbol:'AAPL',qty:'4',market_value:'408'},{symbol:'MSFT',qty:'1',market_value:'205'}];
 const t=sessionTotals(s);assert.equal(t.cash,1410);assert.equal(t.exposure,613);assert.equal(t.reserved,100.1);assert.equal(t.pnl,23);assert.equal(t.realized,10);assert.equal(t.unrealized,13);assert.equal(t.equity,2023);assert.equal(t.valid,true);
 s.intents[0].filled_avg_price=null;assert.equal(sessionTotals(s).valid,false);assert.throws(()=>entryRisk(s,idea(),s.session.settings,now),/accounting/);
});
test('session stops on a $40 loss despite a $100k broker account',async()=>{
 const {p}=service();allocated(p.s);p.s.intents=[{client_order_id:'buy',symbol:'AAPL',side:'buy',qty:'4',filled_qty:'4',filled_avg_price:'100',status:'filled',createdAt:new Date(now).toISOString()}];
 p.client.setPositions([{symbol:'AAPL',qty:'4',market_value:'350',avg_entry_price:'100'}]);
 await p.poll();assert.equal(p.s.halted,true);assert.equal(p.s.session.status,'stopped');assert.equal(p.client.submissions.length,1);assert.equal(p.client.submissions[0].side,'sell');assert.equal(sessionTotals(p.s).pnl,-50);
});
test('dated entries cannot run before their session or on following days',()=>{
 const s=allocated();assert.doesNotThrow(()=>sessionEntryCheck(s,now));
 for(const t of ['2026-09-25T13:29:59Z','2026-09-25T19:30:00Z','2026-09-28T15:35:10Z'])assert.throws(()=>sessionEntryCheck(s,Date.parse(t)),/window/);
 s.session.status='stopped';assert.throws(()=>sessionEntryCheck(s,now),/window/);
});
test('calendar conversion respects summer/winter offsets and early closes',()=>{
 assert.equal(exchangeTime('2026-09-30','09:30'),'2026-09-30T13:30:00.000Z');
 assert.equal(exchangeTime('2026-11-27','13:00'),'2026-11-27T18:00:00.000Z');
 assert.throws(()=>exchangeTime('2026-09-30','25:99'),/Invalid/);
});
test('prepare offline then connect validates calendar and automatically arms',async()=>{
 const p=new PaperService({now:()=>now});await p.configureSession({date:'2026-09-28',capital:2000});assert.equal(p.s.session.status,'needs_connection');assert.equal(p.s.running,false);
 const client=fakeClient(fixture());client.calendar=async()=>[{date:'2026-09-28',open:'09:30',close:'16:00'}];await p.connect(client);
 assert.equal(p.s.session.status,'armed');assert.equal(p.s.running,true);assert.equal(p.s.mode,'auto');assert.equal(p.s.session.capital,2000);
 const restarted=new PaperService({state:structuredClone(p.s),now:()=>now});assert.equal(restarted.s.running,false);assert.equal(restarted.s.session.status,'needs_connection');assert.equal(restarted.s.session.autoAfterConnect,true);
 await p.stop();assert.equal(p.s.session.autoAfterConnect,false);assert.equal(p.s.session.status,'stopped');await p.connect(client);assert.equal(p.s.running,false);
});
test('holiday, expired date and insufficient broker cash cannot arm',async()=>{
 for(const condition of ['holiday','expired','cash']){
  const p=new PaperService({now:()=>now});await p.configureSession({date:'2026-09-25',capital:2000});const s=fixture();if(condition==='cash')s.account.cash='1500';
  const client=fakeClient(s);client.calendar=async()=>condition==='holiday'?[]:[{date:'2026-09-25',open:'09:30',close:condition==='expired'?'11:00':'16:00'}];
  await assert.rejects(p.connect(client));assert.equal(p.s.running,false);
 }
});
test('session replacement is blocked with live holdings or unresolved orders',()=>{
 const s=fixture();s.positions=[{symbol:'AAPL',qty:'1'}];assert.throws(()=>makeSession({date:'2026-09-25',capital:2000},s,now),/Resolve/);
 s.positions=[];s.intents=[{status:'unknown'}];assert.throws(()=>makeSession({date:'2026-09-25',capital:2000},s,now),/Resolve/);
});
test('stop wins a race against asynchronous session arming',async()=>{
 const p=new PaperService({now:()=>now});await p.configureSession({date:'2026-09-28',capital:2000});p.s=Object.assign(fixture(),{session:p.s.session,running:false,halted:true});p.client=fakeClient(fixture());
 let release;p.client.calendar=()=>new Promise(r=>release=r);const arm=p.start('auto');
 await new Promise(r=>setImmediate(r));p.halt();release([{date:'2026-09-28',open:'09:30',close:'16:00'}]);await assert.rejects(arm,/interrupted/);assert.equal(p.s.running,false);
});
test('automatic session lifecycle buys, reconciles fills, liquidates, records P&L and does not restart next day',async()=>{
 const {p}=service();allocated(p.s);p.s.mode='auto';let tick=now;
 p.now=()=>tick;p.client.clock=async()=>({is_open:tick<Date.parse('2026-09-25T20:00:00Z'),timestamp:new Date(tick).toISOString(),next_close:'2026-09-25T20:00:00Z'});
 p.client.quotes=async()=>({quotes:{AAPL:{ap:100,bp:99.99,t:new Date(tick).toISOString()}}});
 p.client.historical=async()=>({bars:Array.from({length:12},(_,i)=>({symbol:'AAPL',timestamp:new Date(now-310000-(11-i)*300000).toISOString(),minute:65+i*5,day:'2026-09-25',open:94+i*.5,high:94.2+i*.5,low:93.8+i*.5,close:94+i*.5,volume:100000}))});
 await p.poll();assert.equal(p.client.submissions.length,1);const buy={...p.client.submissions[0],id:'b',status:'filled',filled_qty:'4',filled_avg_price:'100',filled_at:new Date(tick).toISOString()};assert.equal(buy.qty,'4');
 p.client.setOrders([buy]);p.client.setPositions([{symbol:'AAPL',qty:'4',market_value:'404',avg_entry_price:'100'}]);
 tick=Date.parse('2026-09-25T19:50:00Z');await p.poll();assert.equal(p.s.running,false);assert.equal(p.s.session.status,'closing');assert.equal(p.client.submissions.length,2);
 const sell={...p.client.submissions[1],id:'s',status:'filled',filled_qty:'4',filled_avg_price:'101',filled_at:new Date(tick).toISOString()};assert.equal(sell.side,'sell');
 p.client.setOrders([buy,sell]);p.client.setPositions([]);tick=Date.parse('2026-09-25T20:00:01Z');await p.poll();
 assert.equal(p.s.session.status,'complete');assert.equal(sessionTotals(p.s).pnl,4);assert.equal(sessionTotals(p.s).cash,2004);assert.equal(p.s.flatten,false);
 tick=Date.parse('2026-09-28T15:35:10Z');await p.poll();assert.equal(p.client.submissions.length,2);assert.equal(p.s.running,false);
});
test('missed close preserves liquidation request and marks unresolved holdings for attention',async()=>{
 const {p}=service();allocated(p.s);p.s.intents=[{client_order_id:'b',symbol:'AAPL',side:'buy',qty:'4',filled_qty:'4',filled_avg_price:'100',status:'filled'}];
 p.client.setPositions([{symbol:'AAPL',qty:'4',market_value:'400',avg_entry_price:'100'}]);p.now=()=>Date.parse('2026-09-25T20:10:00Z');
 p.client.clock=async()=>({is_open:false,timestamp:new Date(p.now()).toISOString(),next_close:'2026-09-28T20:00:00Z'});
 await p.poll();assert.equal(p.s.session.status,'attention');assert.equal(p.s.flatten,true);assert.equal(p.s.running,false);assert.equal(p.client.submissions.length,0);
});
test('temporary provider errors defer entries and recover, while uncertain submits never auto-resume',async()=>{
 const {p}=service();allocated(p.s);p.s.session.date='2026-09-28';p.s.session.openAt='2026-09-28T13:30:00Z';p.s.session.closeAt='2026-09-28T20:00:00Z';p.s.session.status='armed';
 const account=p.client.account;p.client.account=async()=>{throw new ProviderError(503,'temporary outage');};await p.poll();assert.equal(p.s.running,true);assert.match(p.s.lastError,/temporary/);
 p.client.account=account;await p.poll();assert.equal(p.s.running,true);assert.equal(p.s.lastError,null);assert.equal(p.client.submissions.length,0);
 p.s.intents.push({client_order_id:'lost',status:'unknown'});p.client.account=async()=>{throw new ProviderError(0,'timeout');};await p.poll();assert.equal(p.s.running,false);
});
