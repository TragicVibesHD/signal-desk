import { randomUUID } from 'node:crypto';
export const STRATEGIES = {
  breakout: {name:'Opening range', description:'Buy a close above the first 30-minute high; exit below VWAP or after 60 minutes.'},
  reversion: {name:'VWAP reversion', description:'Buy a 0.35% discount to session VWAP after a rising close; exit at VWAP or after 60 minutes.'},
  momentum: {name:'Trend momentum', description:'Buy when the 5-bar mean exceeds the 12-bar mean by 0.10% and price is above VWAP; exit on a reversal.'},
  activity: {name:'Active opening breakout', description:'Experimental: break the first five-minute high above VWAP, with opening volume at least 1.5× the previous 14 sessions. Long only; entries in the first 90 minutes.'},
  scalp: {name:'Aggressive scalp', description:'Experimental five-minute trend breakout above VWAP, confirmed by volume. Its dated paper profile allows one larger cash position, a 0.4% stop, 0.8% target and 15-minute holding limit. This is not subsecond trading.'}
};
const round = n => Math.round(n*100)/100;
export function demoData() {
 let seed=47129; const rng=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const symbols={AAPL:225,MSFT:420,NVDA:135,AMZN:195,META:575,GOOGL:170}; const bars=[];
 for(let d=0,day=0;day<24;d++){const date=new Date(Date.UTC(2025,8,2+d,13,30));if([0,6].includes(date.getUTCDay()))continue; day++;
 for(let i=0;i<78;i++) for(const [symbol,base] of Object.entries(symbols)){
 const open=symbols[symbol];const move=(rng()-.49)*.006+Math.sin(i/9+day)*.00045;
 const close=open*(1+move);const high=Math.max(open,close)*(1+rng()*.0015),low=Math.min(open,close)*(1-rng()*.0015);
 bars.push({symbol,timestamp:new Date(+date+i*300000).toISOString(),open,high,low,close,volume:Math.floor(10000+rng()*140000)});symbols[symbol]=close;
 }}return {label:'Deterministic synthetic • seed 47129',synthetic:true,bars};
}
const ny = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function stamp(timestamp){const parts=Object.fromEntries(ny.formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:+parts.hour*60 + +parts.minute-570};}
export function prepare(dataset){
 if(!dataset || !Array.isArray(dataset.bars)||dataset.bars.length<100||dataset.bars.length>250000)throw Error('Provide 100–250,000 OHLCV bars.');
 const seen=new Set();const bars=dataset.bars.map(b=>{
 if(!/^[A-Z][A-Z.\-]{0,9}$/.test(b.symbol)||!Number.isFinite(Date.parse(b.timestamp))||!/(Z|[+-]\d\d:\d\d)$/.test(b.timestamp))throw Error('Invalid symbol or timestamp; timestamps need an explicit timezone.');
 if(!['open','high','low','close','volume'].every(k=>Number.isFinite(b[k]))||Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.low>b.high)throw Error('Invalid OHLCV values.');
 const timestamp=new Date(b.timestamp).toISOString(),key=b.symbol+timestamp;if(seen.has(key))throw Error('Duplicate symbol/timestamp.');seen.add(key);
 const s=stamp(timestamp);if(s.minute<0||s.minute>=390)throw Error('Only regular-session bars (09:30–16:00 New York) are supported.');
 if(b.sessionCloseMinute!==undefined&&(!Number.isInteger(b.sessionCloseMinute)||b.sessionCloseMinute<60||b.sessionCloseMinute>390))throw Error('Invalid session close minute');
 return {...b,timestamp,...s};
 }).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.symbol.localeCompare(b.symbol));
 const frames=[];for(const b of bars){if(frames.at(-1)?.timestamp!==b.timestamp)frames.push({timestamp:b.timestamp,day:b.day,minute:b.minute,bars:[]});frames.at(-1).bars.push(b);}
 return {label:String(dataset.label||'User-imported data; provenance unverified').slice(0,100),synthetic:dataset.synthetic===true,source:dataset.source,frames};
}
export function initial(){return {cash:100000,startingCash:100000,positions:{},orders:[],trades:[],queue:[],logs:[],equity:[],cursor:0,mode:'approval',running:false,halted:false,strategies:['breakout','reversion','momentum'],settings:{positionPct:10,grossPct:40,riskPct:.5,dailyLossPct:2,maxPositions:4,stopPct:1,takePct:2,spreadBps:2,slippageBps:3,commission:.005,participationPct:1},day:null,dayStart:100000,history:{},quotes:{},lastDataAt:0};}
export function account(s){let exposure=0;for(const [sym,p]of Object.entries(s.positions))exposure+=p.qty*(s.quotes[sym]?.close||p.avg);return {cash:round(s.cash),exposure:round(exposure),equity:round(s.cash+exposure),pnl:round(s.cash+exposure-s.startingCash),dailyPnl:round(s.cash+exposure-s.dayStart)};}
export function log(s,message){s.logs.unshift({time:new Date().toISOString(),market:s.marketTime,message});s.logs=s.logs.slice(0,150);}
export function indicators(h){let vol=0,pv=0;for(const b of h){vol+=b.volume;pv+=(b.high+b.low+b.close)/3*b.volume;}return {vwap:vol?pv/vol:h.at(-1)?.close,fast:h.slice(-5).reduce((a,b)=>a+b.close,0)/Math.min(5,h.length),slow:h.slice(-12).reduce((a,b)=>a+b.close,0)/Math.min(12,h.length)};}
export function openingVolume(h){return h.find(b=>b.minute===0)?.volume;}
export function signalPriority(h,strategy,context={}){
 if(strategy==='activity'){const volumes=context.openingVolumes||[],avg=volumes.length===14?volumes.reduce((n,v)=>n+v,0)/14:0;return avg>0?(openingVolume(h)||0)/avg:0;}
 if(strategy==='scalp'){const volumes=h.slice(-7,-1).map(b=>b.volume).sort((a,b)=>a-b),median=volumes.length===6?(volumes[2]+volumes[3])/2:0;return median>0?(h.at(-1)?.volume||0)/median:0;}
 return 0;
}
export function signal(h,strategy,context={}){if(h.length<2)return null;const b=h.at(-1),prev=h.at(-2),v=indicators(h);if(b.minute>=360)return null;
 if(b.minute>=(b.sessionCloseMinute??390)-30)return null;
 if(strategy==='activity'){
  const first=h.find(x=>x.minute===0),volumes=context.openingVolumes||[];
  if(!first||b.minute<5||b.minute>=90||volumes.length<14||first.close<=first.open)return null;
  const average=volumes.slice(-14).reduce((a,n)=>a+n,0)/14,relative=average>0?first.volume/average:0;
  const range=(first.high-first.low)/first.open;
  if(relative>=1.5&&range>=.001&&range<=.02&&b.close>first.high&&prev.close<=first.high&&b.close>v.vwap&&b.close<=v.vwap*1.01)
   return `First five-minute high $${first.high.toFixed(2)} broken above VWAP; opening IEX volume ${relative.toFixed(2)}× its prior 14-session average.`;
  return null;
 }
 if(b.minute<30)return null;
 if(strategy==='scalp'){
  if(h.length<8||!h.slice(-8).every((x,i,a)=>!i||Date.parse(x.timestamp)-Date.parse(a[i-1].timestamp)===300000))return null;
  const recent=h.slice(-4,-1),high=Math.max(...recent.map(x=>x.high));
  const mean=a=>a.reduce((n,x)=>n+x.close,0)/a.length,volumes=h.slice(-7,-1).map(x=>x.volume).sort((a,b)=>a-b),median=(volumes[2]+volumes[3])/2;
  if(median>0&&b.volume>=median*1.2&&b.close>high&&prev.close<=high&&b.close>v.vwap&&b.close<=v.vwap*1.005&&mean(h.slice(-3))>mean(h.slice(-8))*1.0005)
   return `Short-hold breakout above $${high.toFixed(2)} and VWAP; completed-bar volume ${(b.volume/median).toFixed(2)}× recent median.`;
  return null;
 }
 if(strategy==='breakout'){const opening=h.filter(x=>x.minute<30);if(![0,5,10,15,20,25].every(m=>opening.some(x=>x.minute===m)))return null;const high=Math.max(...opening.map(x=>x.high));if(b.close>high&&prev.close<=high&&b.close>v.vwap)return `Closed above the opening range high of $${high.toFixed(2)} and session VWAP.`;}
 if(h.length<12)return null;
 if(strategy==='reversion'&&b.close<v.vwap*.9965&&b.close>prev.close)return `Price is ${((1-b.close/v.vwap)*100).toFixed(2)}% below VWAP with an improving close.`;
 if(strategy==='momentum'&&v.fast>v.slow*1.001&&b.close>v.vwap&&prev.close<=b.close)return '5-bar mean is above the 12-bar mean; price confirms above session VWAP.';
 return null;
}
export function buyRisk(s,o,b,now=Date.now()){
 const a=account(s),c=s.settings;
 if(s.halted)return 'Emergency stop is active';if(now-s.lastDataAt>30000)return 'Market data is stale';
 if(!b||b.timestamp!==s.marketTime)return 'No current bar for this symbol';if(b.minute>=(b.sessionCloseMinute??390)-30)return 'New entries close 30 minutes before the session ends';
 if(a.dailyPnl<=-s.dayStart*c.dailyLossPct/100)return 'Daily loss limit reached';if(s.positions[o.symbol])return 'Position already exists';
 if(Object.keys(s.positions).length>=c.maxPositions)return 'Maximum positions reached';
 if(c.maxSpreadBps&&c.spreadBps>c.maxSpreadBps)return 'Modeled spread is too wide for scalping';
 if(Date.parse(b.timestamp)<(s.cooldowns?.[o.symbol]||0))return 'Exit cooldown is active';
 if(c.maxEntriesDay&&s.orders.filter(o=>o.side==='buy'&&(o.day||stamp(o.time).day)===b.day).length>=c.maxEntriesDay)return 'Daily entry count limit';
 const price=b.open*(1+(c.spreadBps/2+c.slippageBps)/10000);const cost=o.qty*(price+c.commission);
 if(!Number.isInteger(o.qty)||o.qty<1)return 'No whole shares fit risk limits';if(cost>s.cash)return 'Insufficient cash';
 if(o.qty*price>a.equity*c.positionPct/100+0.01)return 'Position size limit';if(a.exposure+o.qty*price>a.equity*c.grossPct/100)return 'Gross exposure limit';
 if(o.qty*price*c.stopPct/100>a.equity*c.riskPct/100)return 'Per-trade risk budget';if(o.qty>Math.floor(b.volume*c.participationPct/100))return 'Order exceeds bar participation limit';return null;
}
export function approve(s,id,now=Date.now()) {const o=s.queue.find(o=>o.id===id);if(!o||o.status!=='pending')throw Error('Suggestion is no longer pending');if(now>o.expiresAt||s.cursor>o.expiresCursor){o.status='expired';throw Error('Suggestion expired');}if(s.halted)throw Error('Emergency stop is active');o.status='approved';log(s,`Approved ${o.symbol}; revalidation and next-bar execution pending.`);}
export function stop(s){s.halted=true;s.running=false;for(const o of s.queue)if(['pending','approved'].includes(o.status))o.status='cancelled';log(s,'Emergency stop: new entries blocked, suggestions cancelled. Positions remain open; use Flatten & advance for exit attempts.');}
function sell(s,symbol,b,reason){const p=s.positions[symbol],c=s.settings;const qty=Math.min(p.qty,Math.floor(b.volume*c.participationPct/100));if(qty<1){log(s,`${symbol}: exit deferred; no simulated liquidity.`);return;}
 const price=b.open*(1-(c.spreadBps/2+c.slippageBps)/10000),fee=qty*c.commission,pnl=(price-p.avg)*qty-fee-p.entryFee*qty/p.qty;
 s.cash+=qty*price-fee;const order={id:randomUUID(),symbol,side:'sell',qty,price:round(price),fee:round(fee),time:b.timestamp,status:'filled',reason,strategy:p.strategy};s.orders.unshift(order);s.trades.unshift({...order,pnl:round(pnl),entry:p.avg});p.entryFee*=1-qty/p.qty;p.qty-=qty;if(!p.qty){delete s.positions[symbol];(s.cooldowns??={})[symbol]=Date.parse(b.timestamp)+(c.cooldownMinutes??10)*60000;}log(s,`${symbol}: sold ${qty} shares · ${reason}`);
}
export function tick(s,data,now=Date.now()){
 const f=data.frames[s.cursor];if(!f){s.running=false;log(s,'Dataset ended. Any remaining positions require more data to exit.');return;}
 const flattenRequested=s.flatten;const prevHistory=s.history;s.marketTime=f.timestamp;s.lastDataAt=now;
 if(s.day!==f.day){for(const [symbol,h]of Object.entries(s.history)){const volume=openingVolume(h);if(Number.isFinite(volume)){const values=(s.openingHistory??={})[symbol]??=[];values.push(volume);s.openingHistory[symbol]=values.slice(-14);}}s.day=f.day;s.dayStart=account(s).equity;s.history={};for(const o of s.queue)if(['pending','approved'].includes(o.status))o.status='expired';}
 for(const b of f.bars)s.quotes[b.symbol]={...b,close:b.open};
 for(const [symbol,p]of Object.entries(s.positions)){const b=f.bars.find(b=>b.symbol===symbol);if(!b)continue;const h=prevHistory[symbol]||[],last=h.at(-1),v=indicators(h);const held=(Date.parse(b.timestamp)-Date.parse(p.time))/60000;
 const reason=s.flatten?'Manual flatten':b.day!==p.day||b.minute>=(b.sessionCloseMinute??390)-10?'Session close attempt':last?.close<=p.avg*(1-s.settings.stopPct/100)?'Stop threshold':last?.close>=p.avg*(1+s.settings.takePct/100)?'Profit threshold':held>=(s.settings.maxHoldMinutes??60)?'Time exit':p.strategy==='reversion'&&last?.close>=v.vwap?'VWAP recovery':p.strategy==='momentum'&&v.fast<v.slow?'Trend reversal':['breakout','activity','scalp'].includes(p.strategy)&&last?.close<v.vwap?'Below VWAP':null;
 if(reason)sell(s,symbol,b,reason);
 }
 if(!Object.keys(s.positions).length)s.flatten=false;
 for(const o of [...s.queue].sort((a,b)=>(b.priority||0)-(a.priority||0))){if(!['pending','approved'].includes(o.status))continue;if(now>o.expiresAt||s.cursor>o.expiresCursor){o.status='expired';continue;}if(o.status!=='approved'||o.createdCursor>=s.cursor)continue;
 const b=f.bars.find(b=>b.symbol===o.symbol);let error=buyRisk(s,o,b,now);if(!error&&Math.abs(b.open/o.reference-1)>.005)error='Price moved more than 0.5% from suggestion';
 if(error){o.status='rejected';o.reason=error;log(s,`${o.symbol}: ${error}`);continue;}
 const c=s.settings,price=b.open*(1+(c.spreadBps/2+c.slippageBps)/10000),fee=o.qty*c.commission;s.cash-=o.qty*price+fee;s.positions[o.symbol]={qty:o.qty,avg:price,entryFee:fee,strategy:o.strategy,time:b.timestamp,day:b.day};o.status='filled';s.orders.unshift({...o,side:'buy',price:round(price),fee:round(fee),time:b.timestamp,day:b.day});log(s,`${o.symbol}: bought ${o.qty} shares · ${STRATEGIES[o.strategy].name}`);
 }
 for(const b of f.bars){s.quotes[b.symbol]=b;(s.history[b.symbol]??=[]).push(b);}
 const a=account(s);if(a.dailyPnl<=-s.dayStart*s.settings.dailyLossPct/100&&!s.halted){stop(s);s.flatten=true;log(s,'Daily loss guard triggered; liquidation will be attempted on subsequent bars.');}
 if(!s.halted&&!s.flatten&&!flattenRequested)for(const b of f.bars){if(s.positions[b.symbol]||Date.parse(b.timestamp)<(s.cooldowns?.[b.symbol]||0)||s.queue.some(o=>o.symbol===b.symbol&&['pending','approved'].includes(o.status)))continue;
 for(const strategy of s.strategies){const reason=signal(s.history[b.symbol],strategy,{openingVolumes:s.openingHistory?.[b.symbol]});if(!reason)continue;const c=s.settings,eq=s.allocationMode?Math.min(s.startingCash,a.equity):a.equity,qty=Math.floor(Math.min(eq*c.positionPct/100/(b.close*1.006),eq*c.riskPct/100/(b.close*c.stopPct/100),s.cash/(b.close*1.006+c.commission)));
 const priority=signalPriority(s.history[b.symbol],strategy,{openingVolumes:s.openingHistory?.[b.symbol]});
 if(qty>0)s.queue.unshift({id:randomUUID(),symbol:b.symbol,qty,strategy,reason,priority,reference:b.close,status:s.mode==='auto'?'approved':'pending',createdCursor:s.cursor,expiresCursor:s.cursor+3,expiresAt:now+90000,time:b.timestamp});break;
 }}
 s.cursor++;s.equity.push({time:f.timestamp,value:account(s).equity});s.queue=s.queue.slice(0,300);if(!s.researchMode){s.orders=s.orders.slice(0,2000);s.equity=s.equity.slice(-2500);}
}
export function updateSettings(s,input){const bounds={positionPct:[1,25],grossPct:[1,100],riskPct:[.1,2],dailyLossPct:[.1,10],maxPositions:[1,10],stopPct:[.1,10],takePct:[.1,20],spreadBps:[0,100],slippageBps:[0,100],commission:[0,1],participationPct:[.01,5]};for(const [k,v]of Object.entries(input)){if(!bounds[k]||!Number.isFinite(v)||v<bounds[k][0]||v>bounds[k][1]||(k==='maxPositions'&&!Number.isInteger(v)))throw Error(`Invalid risk setting: ${k}`);}Object.assign(s.settings,input);log(s,'Risk settings updated. Queued orders will be revalidated.');}
export {evaluate} from './research.mjs';
