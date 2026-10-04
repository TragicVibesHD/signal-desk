import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChart,downloadPublicHistory} from '../yahoo.mjs';
import {prepare,evaluate} from '../engine.mjs';
import {UNIVERSE} from '../alpaca.mjs';
import {dataQuality} from '../metrics.mjs';

const now=Date.parse('2026-09-25T15:35:10Z');
const days=['2026-09-17','2026-09-18','2026-09-21','2026-09-22','2026-09-23','2026-09-24'];
function payload(symbol='AAPL'){
 const periods=days.map(day=>[{start:Date.parse(day+'T13:30:00Z')/1000,end:Date.parse(day+'T20:00:00Z')/1000}]);
 const timestamp=periods.flatMap(([p])=>Array.from({length:78},(_,i)=>p.start+i*300));
 const quote={open:timestamp.map(()=>100),high:timestamp.map(()=>101),low:timestamp.map(()=>99),close:timestamp.map(()=>100),volume:timestamp.map(()=>10000)};
 return {chart:{error:null,result:[{meta:{symbol,currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',dataGranularity:'5m',tradingPeriods:periods},timestamp,indicators:{quote:[quote]}}]}};
}
test('public history downloads only fixed stocks and validates all six before returning provenance',async()=>{
 const calls=[];
 const d=await downloadPublicHistory({now,fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json(payload(new URL(url).pathname.split('/').at(-1)));}});
 assert.equal(calls.length,6);assert.deepEqual(d.source.stocks,UNIVERSE);assert.equal(d.bars.length,6*6*78);
 assert.equal(d.synthetic,false);assert.equal(d.source.provider,'Yahoo Finance');assert.equal(d.source.start,days[0]);assert.equal(d.source.end,days.at(-1));
 assert.match(d.source.fingerprint,/^[a-f0-9]{64}$/);assert.equal(dataQuality(prepare(d)).coveragePct,100);
 for(const {url,opts}of calls){assert.equal(new URL(url).origin,'https://query1.finance.yahoo.com');assert.equal(new URL(url).searchParams.get('interval'),'5m');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,undefined);assert.equal(new URL(url).searchParams.has('apikey'),false);}
 const r=evaluate(prepare(d));assert.equal(r.version,6);assert.equal(r.evidence.checks[0].pass,true);assert.equal(r.evidence.checks[1].pass,false);assert.equal(r.evidence.status,'insufficient');
 await assert.rejects(downloadPublicHistory({stocks:['IBM'],now}),/Choose stocks/);
});
test('early close calendars remove closing snapshots and after-hours records without inventing bars',()=>{
 const p=payload(),x=p.chart.result[0];x.meta.tradingPeriods=x.meta.tradingPeriods.slice(0,1);x.meta.tradingPeriods[0][0].end-=3*3600;
 const d=normalizeChart(p,'AAPL',now);assert.equal(d.bars.length,42);assert.equal(d.calendar[0].close,'13:00');assert.ok(d.bars.every(b=>b.sessionCloseMinute===210));assert.equal(d.discarded.outsideSession,36);
});
test('only completed sessions enter research; current-session bars cannot enter a final holdout',()=>{
 const p=payload();const d=normalizeChart(p,'AAPL',Date.parse('2026-09-24T16:00:00Z'));
 assert.equal(d.calendar.length,5);assert.equal(d.bars.length,5*78);assert.equal(d.discarded.incompleteSessions,78);
});
test('missing values remain absent and are reported as gaps rather than forward-filled candles',()=>{
 const p=payload();p.chart.result[0].indicators.quote[0].close[10]=null;
 const d=normalizeChart(p,'AAPL',now);assert.equal(d.bars.length,6*78-1);assert.equal(d.discarded.missingValues,1);assert.ok(!d.bars.some(b=>b.timestamp===new Date(p.chart.result[0].timestamp[10]*1000).toISOString()));
 const quality=dataQuality(prepare({synthetic:false,bars:d.bars,source:{stocks:['AAPL'],calendar:d.calendar}}));assert.equal(quality.missingBars,1);
});
test('malformed OHLCV, unexpected instruments, off-grid bars and missing calendars fail closed',()=>{
 for(const change of [x=>{x.meta.symbol='MSFT';},x=>{x.meta.dataGranularity='1d';},x=>{x.meta.currency='EUR';},x=>{x.meta.tradingPeriods=[];},x=>{x.timestamp[0]++;},x=>{x.indicators.quote[0].high[0]=98;},x=>{x.indicators.quote[0].volume.pop();},x=>{x.timestamp[1]=x.timestamp[0];}]){
  const p=payload();change(p.chart.result[0]);assert.throws(()=>normalizeChart(p,'AAPL',now));
 }
 assert.throws(()=>normalizeChart({chart:{error:{description:'not available'}}},'AAPL',now),/no chart/);
});
test('a failed stock or rate limit never produces a partial dataset or automated retry',async()=>{
 let calls=0;
 await assert.rejects(downloadPublicHistory({now,fetchImpl:async url=>{calls++;return calls===1?Response.json(payload('AAPL')):new Response('',{status:429});}}),/HTTP 429.*no partial/);
 assert.equal(calls,2);
 await assert.rejects(downloadPublicHistory({now,fetchImpl:async()=>{throw Error('network unavailable');}}),/connection failed/);
});
test('conflicting per-stock session calendars are rejected before any dataset is loaded',async()=>{
 await assert.rejects(downloadPublicHistory({stocks:['AAPL','MSFT'],now,fetchImpl:async url=>{const symbol=new URL(url).pathname.split('/').at(-1),p=payload(symbol);if(symbol==='MSFT')p.chart.result[0].meta.tradingPeriods[0][0].end-=3600;return Response.json(p);}}),/calendars disagree/);
});
