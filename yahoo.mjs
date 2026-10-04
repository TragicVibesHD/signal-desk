import {createHash} from 'node:crypto';
import {UNIVERSE,symbols} from './alpaca.mjs';
import {prepare,stamp} from './engine.mjs';

const HOST='https://query1.finance.yahoo.com';
const roundTime=(seconds)=>new Date(seconds*1000).toISOString();
const localTime=seconds=>{
 const minute=stamp(roundTime(seconds)).minute+570;
 return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
};

// Public chart data is historical research input, never a current broker quote feed.
export function normalizeChart(payload,symbol,now=Date.now()){
 const result=payload?.chart?.result;
 if(payload?.chart?.error||!Array.isArray(result)||result.length!==1)throw Error(`Yahoo Finance returned no chart for ${symbol}.`);
 const chart=result[0],meta=chart.meta,quote=chart.indicators?.quote?.[0],times=chart.timestamp;
 if(meta?.symbol!==symbol||meta.currency!=='USD'||meta.instrumentType!=='EQUITY'||meta.exchangeTimezoneName!=='America/New_York'||meta.dataGranularity!=='5m')throw Error(`Unexpected Yahoo Finance instrument or interval for ${symbol}.`);
 if(!Array.isArray(times)||!times.length||!['open','high','low','close','volume'].every(k=>Array.isArray(quote?.[k])&&quote[k].length===times.length))throw Error(`Incomplete Yahoo Finance OHLCV arrays for ${symbol}.`);
 if(!Array.isArray(meta.tradingPeriods)||!meta.tradingPeriods.length)throw Error(`Yahoo Finance session calendar missing for ${symbol}.`);
 const sessions=new Map();
 for(const group of meta.tradingPeriods){
  if(!Array.isArray(group)||group.length!==1)throw Error(`Unexpected session calendar for ${symbol}.`);
  const p=group[0];
  if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.end<=p.start||p.end-p.start>23400||p.end-p.start<3600)throw Error(`Invalid session bounds for ${symbol}.`);
  const day=stamp(roundTime(p.start)).day,open=localTime(p.start),close=localTime(p.end);
  if(open!=='09:30'||stamp(roundTime(p.end)).day!==day||stamp(roundTime(p.end)).minute%5||[0,6].includes(new Date(day+'T12:00:00Z').getUTCDay())||sessions.has(day))throw Error(`Invalid regular session for ${symbol}.`);
  if(p.end*1000<=now)sessions.set(day,{date:day,open,close,start:p.start,end:p.end});
 }
 const bars=[],seen=new Set(),discarded={incompleteSessions:0,outsideSession:0,missingValues:0};
 for(let i=0;i<times.length;i++){
  const t=times[i];if(!Number.isInteger(t)||t<=0||seen.has(t))throw Error(`Invalid or duplicate Yahoo Finance timestamp for ${symbol}.`);seen.add(t);
  const timestamp=roundTime(t),s=stamp(timestamp),session=sessions.get(s.day);
  if(!session){discarded.incompleteSessions++;continue;}
  if(t<session.start||t+300>session.end){discarded.outsideSession++;continue;}
  if(t%300!==0)throw Error(`Yahoo Finance bar is not on the five-minute grid for ${symbol}.`);
  const values=Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,quote[k][i]]));
  if(Object.values(values).some(v=>v==null)){discarded.missingValues++;continue;}
  if(!Object.values(values).every(Number.isFinite)||Math.min(values.open,values.high,values.low,values.close)<=0||values.volume<0||values.high<Math.max(values.open,values.close)||values.low>Math.min(values.open,values.close)||values.low>values.high)throw Error(`Invalid Yahoo Finance OHLCV bar for ${symbol}.`);
  bars.push({symbol,timestamp,...values,...s,sessionCloseMinute:stamp(roundTime(session.end)).minute});
 }
 if(!bars.length)throw Error(`No complete regular-session Yahoo Finance bars for ${symbol}.`);
 const calendar=[...sessions.values()].map(({date,open,close})=>({date,open,close})).sort((a,b)=>a.date.localeCompare(b.date));
 return {bars,calendar,discarded,splits:chart.events?.splits||{}};
}

export async function downloadPublicHistory({stocks=UNIVERSE,now=Date.now(),fetchImpl=fetch}={}){
 const selected=symbols(stocks),bars=[],calendars=new Map(),discarded={},splits={};
 const deadline=AbortSignal.timeout(45000);
 // Six bounded, sequential requests. No credentials, retries or rate-limit bypass.
 for(const symbol of selected){
  const url=HOST+'/v8/finance/chart/'+symbol+'?'+new URLSearchParams({range:'60d',interval:'5m',includePrePost:'false',events:'splits'});
  let response;try{response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)]),headers:{Accept:'application/json'}});}catch{throw Error(`Public market-data connection failed for ${symbol}; no partial download was loaded.`);}
  if(!response.ok)throw Error(`Yahoo Finance returned HTTP ${response.status} for ${symbol}; no partial download was loaded.`);
  let payload;try{payload=await response.json();}catch{throw Error(`Invalid public market-data response for ${symbol}.`);}
  const data=normalizeChart(payload,symbol,now);bars.push(...data.bars);discarded[symbol]=data.discarded;splits[symbol]=data.splits;
  for(const day of data.calendar){const prior=calendars.get(day.date);if(prior&&JSON.stringify(prior)!==JSON.stringify(day))throw Error('Public stock session calendars disagree.');calendars.set(day.date,day);}
 }
 bars.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.symbol.localeCompare(b.symbol));
 const calendar=[...calendars.values()].sort((a,b)=>a.date.localeCompare(b.date)),start=calendar[0].date,end=calendar.at(-1).date;
 const dataset={label:`Yahoo Finance · 5-minute · ${start} to ${end}`,synthetic:false,source:{provider:'Yahoo Finance',feed:'public chart',interval:'5Min',currency:'USD',timezone:'America/New_York',adjustment:'Provider-reported OHLCV; adjustment policy not independently verified',downloadedAt:new Date(now).toISOString(),start,end,stocks:selected,calendar,calendarSource:'Yahoo Finance tradingPeriods',discarded,splits,
  url:'https://finance.yahoo.com/',notes:'Historical research only. Public chart endpoint is unofficial and availability may change. Exchange coverage, volume and adjustments differ from Alpaca IEX. Complete sessions only; missing bars remain missing. Fixed current-symbol universe has survivorship bias. Raw market data is stored locally and excluded from Git.'},bars};
 const checked=prepare(dataset);
 if(new Set(checked.frames.map(f=>f.day)).size<6)throw Error('Public history needs at least six complete exchange sessions.');
 dataset.source.fingerprint=createHash('sha256').update(JSON.stringify(bars)).digest('hex');
 return dataset;
}
