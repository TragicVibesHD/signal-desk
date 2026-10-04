import test from 'node:test';
import assert from 'node:assert/strict';
import {completedTrades,tradeMetrics,dataQuality,basketBenchmark,paperExecution} from '../metrics.mjs';
import {initial,prepare,demoData,tick,evaluate,buyRisk} from '../engine.mjs';

test('partial exits count as one completed trade and include all entry and exit fees',()=>{
 const orders=[{symbol:'AAPL',side:'buy',qty:10,price:100,fee:1,time:'2026-09-25T14:00:00Z'},
 {symbol:'AAPL',side:'sell',qty:4,price:101,fee:.4,time:'2026-09-25T14:05:00Z'},
 {symbol:'AAPL',side:'sell',qty:6,price:102,fee:.6,time:'2026-09-25T14:10:00Z'}];
 assert.deepEqual(completedTrades(orders).map(t=>t.pnl),[14]);assert.equal(completedTrades(orders.slice(0,2)).length,0);
 const m=tradeMetrics([...completedTrades(orders),{pnl:-5}]);assert.equal(m.roundTrips,2);assert.equal(m.profitFactor,2.8);assert.equal(m.pnlWithoutBestTrade,-5);assert.equal(m.expectancy,4.5);
 assert.throws(()=>completedTrades([{...orders[0],qty:1},orders[1]]),/owned shares/);
});
test('data coverage finds missing, off-grid and fully absent calendar sessions',()=>{
 const raw=demoData(),full=prepare(raw);assert.equal(dataQuality(full).coveragePct,100);
 const missing=prepare({...raw,bars:raw.bars.slice(1)});assert.equal(dataQuality(missing).missingBars,1);
 const shifted=structuredClone(full);shifted.frames[0].bars[0].minute=1;assert.equal(dataQuality(shifted).offGrid,1);
 const calendar=[{date:'2025-09-01',open:'09:30',close:'13:00'}];
 const calendarMissing=dataQuality({...full,source:{stocks:['AAPL'],calendar}});assert.deepEqual(calendarMissing.missingSessions,['2025-09-01']);assert.equal(calendarMissing.expectedBars,42);
});
test('passive basket uses fixed initial whole-share budgets and costs, never an optimized selection',()=>{
 const data=prepare(demoData()),days=[...new Set(data.frames.map(f=>f.day))].slice(-8),costs=initial().settings;
 const a=basketBenchmark(data,days,2000,costs),b=basketBenchmark(data,days,2000,{...costs,commission:1});
 assert.ok(a.cash>=0);assert.ok(a.pnl>b.pnl);assert.ok(a.curve.length>0);assert.match(a.note,/overnight/);
 const report=evaluate(data);assert.equal(report.version,6);assert.equal(report.benchmarks.cash.pnl,0);assert.equal(report.results.length,6);assert.ok(report.results.every(r=>r.test.roundTrips<=r.test.trades));
 assert.equal(report.quality.coveragePct,100);assert.equal(report.evidence.status,'insufficient');
});
function positionState(){const s=initial();s.strategies=[];s.mode='auto';s.day='2026-09-25';s.settings={...s.settings,spreadBps:0,slippageBps:0,commission:0,priorBarLiquidity:true,intrabarProtection:true};s.positions.AAPL={qty:10,avg:100,entryFee:0,strategy:'momentum',time:'2026-09-25T14:00:00Z',day:s.day};s.history.AAPL=[{symbol:'AAPL',day:s.day,timestamp:'2026-09-25T14:00:00Z',minute:30,close:100,high:100,low:100,volume:1000}];return s;}
const bar=(changes={})=>({symbol:'AAPL',day:'2026-09-25',timestamp:'2026-09-25T14:05:00Z',minute:35,open:100,high:103,low:98,close:101,volume:1e8,...changes});
test('conservative OHLC brackets charge the stop when both thresholds touch and respect gap losses',()=>{
 const a=positionState();tick(a,{frames:[{timestamp:bar().timestamp,day:a.day,minute:35,bars:[bar()]}]},1000);assert.equal(a.orders[0].price,99);assert.equal(a.orders[0].reason,'Bracket stop');
 const b=positionState();tick(b,{frames:[{timestamp:bar().timestamp,day:b.day,minute:35,bars:[bar({open:97,low:96})]}]},1000);assert.equal(b.orders[0].price,97);assert.equal(b.orders[0].reason,'Bracket gap stop');
});
test('fill participation uses prior completed volume and never consumes the execution bar final volume',()=>{
 const outcomes=[0,1e8].map(volume=>{const s=positionState();s.history.AAPL[0].volume=200;const b=bar({volume});tick(s,{frames:[{timestamp:b.timestamp,day:s.day,minute:35,bars:[b]}]},1000);return {qty:s.orders[0].qty,left:s.positions.AAPL.qty};});
 assert.deepEqual(outcomes,[{qty:2,left:8},{qty:2,left:8}]);
});
test('entry execution measurements leave legacy missing observations unavailable',()=>{
 const a=paperExecution([{side:'buy',status:'filled',filled_qty:'2',filled_avg_price:'100.1',quoteAsk:100},{side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100'},{side:'buy',status:'rejected'}]);
 assert.equal(a.entryAttempts,3);assert.equal(a.filledEntries,2);assert.equal(a.measuredEntries,1);assert.equal(a.entrySlippageBps,10);assert.equal(paperExecution([]).entrySlippageBps,null);
});

test('research entry and daily loss caps stay tied to initial allocation after earlier profits',()=>{
 const s=initial(),b=bar({high:100,low:100,close:100,volume:100000});Object.assign(s,{cash:3000,startingCash:2000,allocationMode:true,dayStart:3000,marketTime:b.timestamp,lastDataAt:1000});Object.assign(s.settings,{positionPct:75,grossPct:75,stopPct:.4,spreadBps:0,slippageBps:0,commission:0});
 assert.equal(buyRisk(s,{symbol:'AAPL',qty:16},b,1000),'Position size limit');s.cash=2959;
 assert.equal(buyRisk(s,{symbol:'AAPL',qty:1},b,1000),'Daily loss limit reached');
});
