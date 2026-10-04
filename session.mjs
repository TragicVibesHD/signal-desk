import {randomUUID} from 'node:crypto';
import {stamp} from './engine.mjs';
import {PROFILES} from './profiles.mjs';

export {sessionSettings} from './profiles.mjs';
const terminal=new Set(['filled','canceled','expired','rejected','replaced']);
export const unresolved=s=>s.intents.some(i=>!terminal.has(i.status));

export function makeSession({date,capital,profile='baseline'},s,now=Date.now()) {
  if(!Object.hasOwn(PROFILES,profile))throw Error('Choose a supported paper strategy profile.');
  capital=Number(capital);
  if(!Number.isFinite(capital)||capital<100||capital>1000000)throw Error('Choose simulated capital between $100 and $1,000,000.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Choose a valid session date.');
  if(date<stamp(new Date(now).toISOString()).day||Date.parse(date)>now+31*86400000)throw Error('Choose today or a date within the next 31 days.');
  if(s.positions.length||s.orders.some(o=>!terminal.has(o.status))||unresolved(s)||s.ownershipConflicts?.length)throw Error('Resolve all broker positions and open or uncertain orders before creating a session.');
  return {id:randomUUID(),date,capital,profile,engineVersion:5,status:'needs_connection',autoAfterConnect:true,intentStart:s.intents.length,createdAt:new Date(now).toISOString(),settings:{...PROFILES[profile].settings,brokerProtection:true},strategies:[...PROFILES[profile].strategies],curve:[],peak:capital,maxDrawdown:0};
}

// Calendar times are exchange-local; derive the offset for that date (including DST).
export function exchangeTime(date,time){
  if(!/^\d{2}:\d{2}$/.test(time)||Number(time.slice(0,2))>23||Number(time.slice(3))>59)throw Error('Invalid exchange calendar time.');
  const probe=new Date(date+'T12:00:00Z');
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(probe).find(p=>p.type==='timeZoneName').value;
  const match=/GMT([+-])(\d+)(?::(\d+))?/.exec(offset);if(!match)throw Error('Cannot resolve exchange timezone.');
  const minutes=(Number(match[2])*60+Number(match[3]||0))*(match[1]==='-'?-1:1);
  return new Date(Date.parse(date+'T'+time+':00Z')-minutes*60000).toISOString();
}

// Cash ledger of this session's cumulative broker fills; never use the broker's $100k as its budget.
export function sessionTotals(s){
  const plan=s.session;if(!plan)return null;
  let cash=plan.capital,realized=0,entries=0,exits=0,valid=true;
  const lots=new Map();
  for(const i of s.intents.slice(plan.intentStart)){
    const qty=Number(i.filled_qty||0);if(!Number.isFinite(qty)||qty<0){valid=false;continue;}if(!qty)continue;
    const price=Number(i.filled_avg_price);if(!Number.isFinite(price)||price<=0){valid=false;continue;}
    const lot=lots.get(i.symbol)||{qty:0,cost:0};
    if(i.side==='buy'){cash-=qty*price;lot.qty+=qty;lot.cost+=qty*price;entries++;}
    else {const basis=lot.qty>0?lot.cost/lot.qty:0;if(qty>lot.qty+.000001)valid=false;cash+=qty*price;realized+=qty*(price-basis);lot.qty-=qty;lot.cost-=qty*basis;exits++;}
    lots.set(i.symbol,lot);
  }
  let exposure=0,cost=0,openPositions=0;
  for(const [symbol,lot] of lots){if(lot.qty<=.000001)continue;openPositions++;cost+=lot.cost;
    const p=s.positions.find(p=>p.symbol===symbol),qty=Number(p?.qty),mark=Number(p?.market_value)/qty;
    if(!p||Math.abs(qty-lot.qty)>.000001||!Number.isFinite(mark)||mark<=0){valid=false;exposure+=lot.cost;}else exposure+=lot.qty*mark;
  }
  const reserved=s.orders.filter(o=>o.side==='buy'&&!terminal.has(o.status)&&s.intents.slice(plan.intentStart).some(i=>i.client_order_id===o.client_order_id)).reduce((sum,o)=>{
    const remaining=Number(o.qty)-Number(o.filled_qty||0),price=Number(o.limit_price);
    if(!Number.isFinite(remaining)||remaining<0||!Number.isFinite(price)||price<=0){valid=false;return sum;}return sum+remaining*price;
  },0);
  const equity=cash+exposure,pnl=equity-plan.capital;
  return {capital:plan.capital,cash,equity,exposure,reserved,available:Math.max(0,cash-reserved),pnl,returnPct:pnl/plan.capital*100,realized,unrealized:exposure-cost,entries,exits,openPositions,valid};
}

export function sessionEntryCheck(s,now){
  const p=s.session;if(!p)return;
  if(!['armed','running'].includes(p.status)||!p.openAt||now<Date.parse(p.openAt)||now>=Date.parse(p.closeAt)-30*60000||stamp(new Date(now).toISOString()).day!==p.date)throw Error('Outside the armed session entry window.');
}

export function riskCapital(s){
  const t=sessionTotals(s);
  if(t){if(!t.valid)throw Error('Session fill accounting is incomplete; reconcile before entries.');return {equity:Math.min(t.capital,t.equity),cash:Math.min(t.cash,Number(s.account.cash)),baseline:t.capital,pnl:t.pnl};}
  return {equity:Number(s.account.equity),cash:Number(s.account.cash),baseline:s.dayStart,pnl:Number(s.account.equity)-s.dayStart};
}
