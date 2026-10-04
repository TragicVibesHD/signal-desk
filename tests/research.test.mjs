import test from 'node:test';
import assert from 'node:assert/strict';
import {signal,prepare,demoData,initial,evaluate,tick} from '../engine.mjs';
import {downloadEvaluation} from '../research.mjs';

const opening=()=>Array.from({length:6},(_,i)=>({minute:i*5,open:100,close:100,high:100.2,low:99.8,volume:1000}));
test('30-minute breakout fires with seven complete bars rather than waiting for twelve',()=>{
 const h=[...opening(),{minute:30,open:100,close:100.4,high:100.5,low:100,volume:1000}];
 assert.match(signal(h,'breakout'),/opening range/);
 assert.equal(signal(h.filter(b=>b.minute!==10),'breakout'),null);
 // Very large earlier highs can lift VWAP above a range breakout; do not buy an immediate exit.
 h.push({minute:35,open:100,close:100.1,high:150,low:100,volume:1e8},{minute:40,open:100.1,close:100.5,high:100.6,low:100.1,volume:1000});
 assert.equal(signal(h,'breakout'),null);
});
test('experimental opening breakout requires 14 past volumes, rising opening range, volume and VWAP',()=>{
 const h=[{minute:0,open:100,close:100.1,high:100.2,low:99.9,volume:2000},
 {minute:5,open:100.1,close:100.3,high:100.4,low:100.1,volume:1500}];
 const volumes=Array(14).fill(1000);
 assert.match(signal(h,'activity',{openingVolumes:volumes}),/2.00×/);
 assert.equal(signal(h,'activity',{openingVolumes:volumes.slice(1)}),null);
 assert.equal(signal(h,'activity',{openingVolumes:Array(14).fill(2000)}),null);
 assert.equal(signal([{...h[0],close:99.95},h[1]],'activity',{openingVolumes:volumes}),null);
 assert.equal(signal([h[0],{...h[1],minute:90}],'activity',{openingVolumes:volumes}),null);
});
test('research matches a $2k session, reports stress and refuses synthetic promotion',()=>{
 const r=evaluate(prepare(demoData()),initial().settings);
 assert.equal(r.capital,2000);assert.equal(r.settings.positionPct,25);assert.equal(r.settings.dailyLossPct,2);
 assert.equal(r.results.length,6);assert.equal(r.folds.length,3);assert.equal(r.evidence.status,'insufficient');
 assert.equal(r.evidence.checks[0].pass,false);assert.ok(r.stressSettings.slippageBps>=10);
 assert.ok(r.results.every(x=>x.test.dailyReturns.length===r.testDays));
 for(const x of r.results)for(const stage of ['train','test','stress'])if(!x[stage].openPositions)assert.equal(x[stage].realized,x[stage].pnl);
 assert.throws(()=>evaluate(prepare(demoData()),initial().settings,{capital:0}),/capital/);
});
test('real-data research pipeline evaluates a provider download without placing orders',async()=>{
 const fixture=demoData(),calls=[];
 const client={historical:async options=>{calls.push(options);return fixture;},submit:()=>{throw Error('Research must never submit an order');}};
 const {dataset,report}=await downloadEvaluation(client,{start:'2025-09-02',end:'2025-10-03',costs:initial().settings,capital:2000});
 assert.equal(dataset,fixture);assert.equal(report.capital,2000);assert.equal(report.results.length,6);
 assert.equal(report.evidence.status,'insufficient');assert.match(report.datasetFingerprint,/^[a-f0-9]{64}$/);
 assert.deepEqual(calls,[{start:'2025-09-02',end:'2025-10-03',adjustment:'split'}]);
 await assert.rejects(downloadEvaluation({historical:async()=>{throw Error('Provider offline');}},{start:'2025-09-02',end:'2025-10-03'}),/Provider offline/);
});
test('final holdout cannot alter development selections or volume context',()=>{
 const d=prepare(demoData()),a=evaluate(d,initial().settings),changed=structuredClone(d);
 for(const f of changed.frames.filter(f=>f.day>=a.testStart))for(const b of f.bars){
  b.open*=2;b.high*=2;b.low*=2;b.close*=2;b.volume*=5;
 }
 const b=evaluate(changed,initial().settings);
 assert.deepEqual(a.results.map(x=>x.train),b.results.map(x=>x.train));
 assert.deepEqual(a.folds,b.folds);assert.equal(a.selected,b.selected);
});
test('exit cooldown blocks replacement entries on the next bar',()=>{
 const d=prepare(demoData()),s=initial();s.mode='auto';
 for(let i=0;i<20;i++)tick(s,d,i*1000);
 s.flatten=true;for(const o of s.queue)if(['pending','approved'].includes(o.status))o.status='cancelled';
 tick(s,d,20000);
 const sold=s.orders.find(o=>o.side==='sell'&&Date.parse(o.time)===Date.parse(s.marketTime));
 assert.ok(sold);assert.equal(s.cooldowns[sold.symbol],Date.parse(sold.time)+600000);
 tick(s,d,21000);assert.ok(!s.queue.some(o=>o.symbol===sold.symbol&&o.createdCursor===21));
});
test('activity priority allocates scarce replay slots before lower-volume suggestions',()=>{
 const s=initial();s.strategies=[];s.mode='auto';s.settings.maxPositions=1;
 const timestamp='2026-09-25T14:00:00Z',bars=['AAPL','AMZN'].map(symbol=>({symbol,timestamp,day:'2026-09-25',minute:30,open:100,close:100,high:101,low:99,volume:100000}));
 s.day='2026-09-25';s.marketTime=timestamp;s.lastDataAt=0;s.cursor=1;
 s.queue=bars.map((b,i)=>({id:b.symbol,symbol:b.symbol,qty:10,strategy:'activity',priority:i?3:2,reference:100,status:'approved',createdCursor:0,expiresCursor:3,expiresAt:90000}));
 tick(s,{frames:[{}, {timestamp,day:'2026-09-25',minute:30,bars}]},1000);
 assert.ok(s.positions.AMZN);assert.equal(s.positions.AAPL,undefined);
});
