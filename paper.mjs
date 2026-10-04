import {randomUUID, createHash} from 'node:crypto';
import {initial, signal, signalPriority, indicators, stamp} from './engine.mjs';
import {UNIVERSE} from './alpaca.mjs';
import {makeSession,exchangeTime,sessionTotals,sessionEntryCheck,riskCapital,unresolved} from './session.mjs';
import {bracketPrices,flattenOrders,adoptLegs} from './protection.mjs';
import {paperExecution} from './metrics.mjs';

const terminal = new Set(['filled','canceled','expired','rejected','replaced']);
const finite = (value, name) => { const n = Number(value); if (!Number.isFinite(n)) throw Error(`Invalid provider ${name}`); return n; };
const active = o => !terminal.has(o.status);
const pending = o => ['pending','approved'].includes(o.status);
export function paperInitial() { return {version:1, connected:false, running:false, halted:true, mode:'approval', account:null, accountId:null, positions:[], orders:[], intents:[], suggestions:[], quotes:{}, history:{}, assets:{}, logs:[], equity:[], lastSync:null, lastError:null, seen:{}, day:null, dayStart:null, flatten:false}; }
export function freshQuote(q, now) {
  if (!q || !Number.isFinite(Date.parse(q.t)) || now-Date.parse(q.t)>30000 || Date.parse(q.t)-now>5000) throw Error('Quote is stale or missing (maximum age: 30 seconds).');
  const ask=finite(q.ap,'ask'), bid=finite(q.bp,'bid');
  if (bid<=0 || ask<bid || (ask-bid)/ask>.005) throw Error('Invalid quote or spread exceeds 0.5%.');
  return {ask,bid};
}
export function entryRisk(s, idea, settings, now=Date.now()) {
  if (!s.connected || s.halted || !s.running) throw Error('Paper entries are stopped.');
  if(Object.keys(s.exitRequests||{}).length)throw Error('A position exit is pending; new entries wait for reconciliation.');
  sessionEntryCheck(s,now);
  if (!s.lastSync || now-Date.parse(s.lastSync)>30000) throw Error('Account reconciliation is stale.');
  if (!s.clock?.is_open || now-Date.parse(s.clock.timestamp)>30000 || Date.parse(s.clock.timestamp)-now>5000) throw Error('Market is closed or clock is stale.');
  if (Date.parse(s.clock.next_close)-now<=30*60000) throw Error('New entries stop 30 minutes before the exchange close.');
  if (idea.expiresAt<now) throw Error('Suggestion expired.');
  if (!UNIVERSE.includes(idea.symbol)) throw Error('Unsupported stock');
  const asset=s.assets[idea.symbol];
  if (!asset || asset.class!=='us_equity' || !asset.tradable || asset.status!=='active') throw Error('Stock is not active and tradable.');
  const a=s.account;
  if (!a || a.status!=='ACTIVE' || a.trading_blocked || a.account_blocked || a.trade_suspended_by_user) throw Error('Paper account is blocked or inactive.');
  const capital=riskCapital(s),equity=finite(capital.equity,'equity'),cash=finite(capital.cash,'cash'),buyingPower=finite(a.buying_power,'buying power');
  if (equity<=0 || !Number.isFinite(capital.baseline) || capital.baseline<=0) throw Error('Invalid account equity baseline');
  if (capital.pnl<=-capital.baseline*settings.dailyLossPct/100) throw Error('Daily loss limit reached.');
  if (s.positions.some(p=>finite(p.qty,'position quantity')<0)) throw Error('Account contains short positions; use a dedicated long-only paper account.');
  if (s.intents.some(o=>['submitting','unknown'].includes(o.status))) throw Error('An earlier submission is uncertain. Reconcile before new entries.');
  if (s.ownershipConflicts?.length) throw Error('Broker holdings differ from app-attributed shares. Reconcile external activity before new entries.');
  const open=s.orders.filter(active);
  if (open.some(o=>!s.intents.some(i=>i.client_order_id===o.client_order_id))) throw Error('External open orders detected; entries paused until they finish or are cancelled outside this app.');
  if (s.positions.some(p=>p.symbol===idea.symbol) || open.some(o=>o.symbol===idea.symbol)) throw Error('This stock already has a position or open order.');
  const buys=open.filter(o=>o.side==='buy');
  if (s.positions.length+buys.length>=settings.maxPositions) throw Error('Maximum position count reached.');
  const {ask,bid}=freshQuote(s.quotes[idea.symbol],now);
  if(settings.maxSpreadBps&&(ask-bid)/ask*10000>settings.maxSpreadBps)throw Error('Spread is too wide for the scalping profile.');
  if(settings.maxEntriesDay){const entries=s.intents.slice(s.session?.intentStart??0).filter(i=>i.side==='buy'&&stamp(i.createdAt).day===s.day&&(Number(i.filled_qty)>0||active(i)));if(entries.length>=settings.maxEntriesDay)throw Error('Daily entry count limit reached.');}
  const recentExit=[...s.intents].reverse().find(i=>i.symbol===idea.symbol&&i.side==='sell'&&Number(i.filled_qty)>0);
  if(recentExit&&now-Date.parse(recentExit.filled_at||recentExit.createdAt)<(settings.cooldownMinutes??10)*60000)throw Error(`${settings.cooldownMinutes??10}-minute cooldown after the last exit.`);
  const vwap=indicators(s.history[idea.symbol]||[]).vwap;
  if(['breakout','activity','scalp'].includes(idea.strategy)&&Number.isFinite(vwap)&&ask<=vwap)throw Error('Breakout entry is already below its VWAP exit threshold.');
  if(idea.strategy==='scalp'&&Number.isFinite(vwap)&&ask>vwap*1.005)throw Error('Scalp quote is more than 0.5% above VWAP; do not chase the move.');
  if (Math.abs(ask/idea.reference-1)>.005) throw Error('Price moved more than 0.5% from the suggestion.');
  const price=Math.ceil(ask*(1+(settings.entryBufferBps??10)/10000)*100)/100;
  const reserved=buys.reduce((n,o)=>n+Math.max(0,finite(o.qty,'order quantity')-finite(o.filled_qty,'filled quantity'))*finite(o.limit_price,'limit price'),0);
  const exposure=s.positions.reduce((n,p)=>n+Math.abs(finite(p.market_value,'position value')),0);
  const qty=idea.qty,notional=qty*price;
  if (!Number.isInteger(qty)||qty<1) throw Error('Whole-share quantity required.');
  if (notional>Math.min(cash,buyingPower)-reserved) throw Error('Insufficient unreserved cash or buying power.');
  if (notional>equity*settings.positionPct/100 || exposure+reserved+notional>equity*settings.grossPct/100) throw Error('Position or gross exposure limit reached.');
  if (notional*settings.stopPct/100>equity*settings.riskPct/100) throw Error('Per-entry risk budget exceeded.');
  if(settings.brokerProtection&&qty*(price-bracketPrices(price,settings).stop)>equity*settings.riskPct/100)throw Error('Rounded broker stop exceeds the per-entry risk budget.');
  const last=s.history[idea.symbol]?.at(-1);
  if (!last || now-Date.parse(last.timestamp)-300000>90000 || Date.parse(last.timestamp)+300000>now) throw Error('Completed five-minute bar is stale or missing.');
  if (qty>Math.floor(last.volume*settings.participationPct/100)) throw Error('Order exceeds the last completed IEX bar volume limit.');
  return {qty,price};
}

export class PaperService {
  constructor({state=paperInitial(),save=()=>{},settings=()=>initial().settings,strategies=()=>['breakout','reversion','momentum'],now=()=>Date.now()}={}) {
    this.s={...paperInitial(),...state,connected:false,running:false,halted:true}; this.save=save; this.settings=()=>this.s.session?.settings||settings(); this.strategies=()=>this.s.session?.strategies||strategies(); this.now=now; this.client=null; this.busy=false; this.generation=0;
    if(this.s.session&&['armed','running'].includes(this.s.session.status)){this.s.session.status='needs_connection';this.s.session.autoAfterConnect=true;}
    for(const idea of this.s.suggestions)if(pending(idea))idea.status='expired';
    for(const intent of this.s.intents)if(intent.status==='submitting')intent.status='unknown';
  }
  persist(){this.save(this.s);}
  log(message){this.s.logs.unshift({time:new Date(this.now()).toISOString(),message});this.s.logs=this.s.logs.slice(0,150);}
  public(){const s=this.s;return {...s,protection:this.protection(),execution:paperExecution(s.intents.slice(s.session?.intentStart??0)),performance:sessionTotals(s),assets:undefined,history:undefined,seen:undefined,accountId:undefined,account:s.account?{equity:s.account.equity,cash:s.account.cash,buying_power:s.account.buying_power,last_equity:s.account.last_equity,status:s.account.status}:null,configured:!!this.client,feed:'iex',endpoint:'Alpaca paper only',monitoring:!!this.client,uncertain:s.intents.filter(i=>['submitting','unknown'].includes(i.status)).length};}
  async exclusive(fn){if(this.busy)throw Error('Paper connection is busy; try again shortly.');this.busy=true;try{return await fn();}finally{this.busy=false;this.persist();}}
  async connect(client){return this.exclusive(async()=>{
    const account=await client.account();
    if(account.status!=='ACTIVE')throw Error('Paper account must be active.');
    if(this.s.accountId && this.s.accountId!==account.id)throw Error('This workspace is bound to a different paper account. Use a separate DATA_DIR to keep account histories separate.');
    if(this.s.session&&['armed','running'].includes(this.s.session.status)){this.s.session.status='needs_connection';this.s.session.autoAfterConnect=true;}
    this.client=client;this.s.accountId=account.id;this.s.connected=true;this.s.running=false;this.s.halted=true;this.s.lastError=null;
    for(const symbol of UNIVERSE)this.s.assets[symbol]=await client.asset(symbol);
    await this.sync();this.log('Paper account connected and reconciled.');
    if(this.s.session?.autoAfterConnect)await this.activateSession();
  });}
  async configureSession(input){return this.exclusive(async()=>{
    if(this.s.running)throw Error('Stop entries before replacing a session.');
    if(this.client)await this.sync();
    const next=makeSession(input,this.s,this.now());
    if(this.s.session)(this.s.sessions??=[]).push({...this.s.session,performance:sessionTotals(this.s)});
    this.s.session=next;this.s.seen={};this.s.flatten=false;
    for(const idea of this.s.suggestions)if(pending(idea))idea.status='cancelled';
    this.log(`Session prepared for ${next.date}: $${next.capital} simulated capital. Connect to validate the exchange calendar and arm automatic trading.`);
    if(this.client)await this.activateSession();
  });}
  async activateSession(){
    const s=this.s,p=s.session,generation=this.generation;
    if(!p)throw Error('Prepare a session first.');
    const calendar=await this.client.calendar(p.date,p.date),day=calendar.find(d=>d.date===p.date);
    if(generation!==this.generation)throw Error('Arming was interrupted by a stop.');
    if(!day)throw Error('The selected date is not an exchange trading session. Choose another date.');
    p.openAt=exchangeTime(p.date,day.open);p.closeAt=exchangeTime(p.date,day.close);
    if(this.now()>=Date.parse(p.closeAt)-30*60000){p.status='expired';p.autoAfterConnect=false;throw Error('This session entry window has ended. Prepare a new dated session.');}
    const a=s.account,t=sessionTotals(s);
    if(a.status!=='ACTIVE'||a.trading_blocked||a.account_blocked||a.trade_suspended_by_user)throw Error('Paper account is blocked or inactive.');
    if(!t.valid||s.ownershipConflicts?.length||s.intents.some(i=>['unknown','submitting'].includes(i.status)))throw Error('Reconcile fills and ownership before arming.');
    if(s.positions.some(pos=>this.owned(pos.symbol)!==Number(pos.qty))||s.orders.some(o=>active(o)&&!s.intents.some(i=>i.client_order_id===o.client_order_id)))throw Error('Use a dedicated account without external positions or orders.');
    if(Number(a.cash)<t.cash||Number(a.buying_power)<t.cash)throw Error('Broker cash is below the allocated session cash.');
    if(t.pnl<=-p.capital*p.settings.dailyLossPct/100)throw Error('Session loss limit remains breached.');
    if(s.flatten)throw Error('Flatten is still in progress.');
    p.status=this.now()<Date.parse(p.openAt)?'armed':'running';p.autoAfterConnect=false;s.mode='auto';s.running=true;s.halted=false;s.lastError=null;
    this.log(`Automatic session armed for ${p.date}, ${day.open}–${day.close} Eastern, with $${p.capital} allocated. Entries stop 30 minutes before close; liquidation starts 10 minutes before close.`);
  }
  async sync(){
    if(!this.client)throw Error('Connect paper credentials first.');
    const results=await Promise.all([this.client.account(),this.client.positions(),this.client.orders(),this.client.clock(),this.client.quotes(UNIVERSE)]);
    const [a,positions,roots,clock,quotes]=results;
    if(a.id!==this.s.accountId)throw Error('Paper account identity changed.');
    if(!Array.isArray(positions)||!Array.isArray(roots)||!clock.timestamp)throw Error('Invalid broker response.');
    finite(a.equity,'equity');finite(a.cash,'cash');
    // Filled parents can disappear from the recent list while their protective legs remain open.
    for(const parent of this.s.intents.filter(i=>i.side==='buy'&&i.order_class==='bracket')){
      const children=this.s.intents.filter(i=>i.parentId===parent.client_order_id);
      const needed=active(parent)||this.owned(parent.symbol)>0||children.some(active);
      if(needed&&!roots.find(o=>o.client_order_id===parent.client_order_id)?.legs?.length&&parent.brokerId){
        const remote=await this.client.orderById(parent.brokerId);roots.push(remote);
      }
    }
    adoptLegs(this.s.intents,roots);
    const orders=flattenOrders(roots);
    // Supplement the bounded recent-order list with each unresolved durable intent.
    for(const intent of this.s.intents.filter(i=>!terminal.has(i.status))){
      let remote=orders.find(o=>o.client_order_id===intent.client_order_id);
      if(!remote){try{remote=await this.client.order(intent.client_order_id);adoptLegs(this.s.intents,[remote]);orders.push(...flattenOrders([remote]));}catch(e){if(e.status!==404)throw e;intent.status='unknown';}}
      if(remote)Object.assign(intent,{status:remote.status,brokerId:remote.id,qty:remote.qty??intent.qty,filled_qty:remote.filled_qty,filled_avg_price:remote.filled_avg_price,filled_at:remote.filled_at});
    }
    for(const intent of this.s.intents){const remote=orders.find(o=>o.client_order_id===intent.client_order_id);if(remote)Object.assign(intent,{status:remote.status,brokerId:remote.id,qty:remote.qty??intent.qty,filled_qty:remote.filled_qty,filled_avg_price:remote.filled_avg_price,filled_at:remote.filled_at});}
    this.s.ownershipConflicts=UNIVERSE.filter(symbol=>{const qty=this.s.intents.filter(i=>i.symbol===symbol).reduce((n,i)=>n+(i.side==='buy'?1:-1)*Number(i.filled_qty||0),0);return qty<-.000001||qty>0&&Math.abs(qty-Number(positions.find(p=>p.symbol===symbol)?.qty||0))>.000001;});
    Object.assign(this.s,{account:a,positions,orders,clock,quotes:quotes.quotes||{},connected:true,lastSync:new Date(this.now()).toISOString(),lastError:null});
    const day=stamp(clock.timestamp).day;
    if(day!==this.s.day){this.s.day=day;this.s.dayStart=finite(a.last_equity||a.equity,'previous close equity');this.s.history={};this.s.seen={};for(const idea of this.s.suggestions)if(pending(idea))idea.status='expired';}
    this.s.equity.push({time:new Date(this.now()).toISOString(),value:Number(a.equity)});this.s.equity=this.s.equity.slice(-2500);
    const p=this.s.session,t=sessionTotals(this.s);
    if(p&&t.valid&&!['complete','expired'].includes(p.status)){
      p.peak=Math.max(p.peak,t.equity);p.maxDrawdown=Math.max(p.maxDrawdown,(p.peak-t.equity)/p.peak*100);
      const point={time:new Date(this.now()).toISOString(),value:t.equity};
      if(!p.curve.length||this.now()-Date.parse(p.curve.at(-1).time)>=60000)p.curve.push(point);
      p.curve=p.curve.slice(-3000);
    }
  }
  owned(symbol){return Math.max(0,this.s.intents.filter(i=>i.symbol===symbol).reduce((n,i)=>n+(i.side==='buy'?1:-1)*Number(i.filled_qty||0),0));}
  owner(symbol){return [...this.s.intents].reverse().find(i=>i.symbol===symbol&&i.side==='buy'&&Number(i.filled_qty)>0);}
  protection(){
    const unprotected=this.s.positions.filter(p=>this.owned(p.symbol)>0&&!this.s.orders.some(o=>o.symbol===p.symbol&&o.side==='sell'&&['stop','stop_limit'].includes(o.type)&&active(o)&&!['held','pending_cancel'].includes(o.status)&&Number(o.qty)-Number(o.filled_qty||0)>=this.owned(p.symbol)&&this.s.intents.some(i=>i.protective&&i.brokerId===o.id))).map(p=>p.symbol);
    return {enabled:!!this.settings().brokerProtection,unprotected,pendingExits:Object.keys(this.s.exitRequests||{})};
  }
  async refreshHistory(){
    const day=this.s.day;
    if(!this.s.clock.is_open)return;
    const d=await this.client.historical({start:day,end:day,adjustment:'raw',now:this.now(),maxPages:3,requireAll:false});
    this.s.history={};for(const b of d.bars)(this.s.history[b.symbol]??=[]).push(b);
    if(this.strategies().includes('activity')&&this.volumeDay!==day){
      const end=new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
      const start=new Date(Date.parse(day+'T12:00:00Z')-45*86400000).toISOString().slice(0,10);
      const previous=await this.client.historical({start,end,adjustment:'split',now:this.now(),requireAll:false});
      this.openingVolumes={};
      for(const b of previous.bars)if(stamp(b.timestamp).minute===0){const values=this.openingVolumes[b.symbol]??=[];values.push(b.volume);this.openingVolumes[b.symbol]=values.slice(-14);}
      this.volumeDay=day;
    }
  }
  halt(reason='Paper entries stopped. Protective exit monitoring continues while connected.'){
    this.generation++;this.s.running=false;this.s.halted=true;
    if(this.s.session){this.s.session.autoAfterConnect=false;if(!['complete','expired','closing','attention'].includes(this.s.session.status))this.s.session.status='stopped';}
    for(const idea of this.s.suggestions)if(pending(idea))idea.status='cancelled';this.log(reason);this.persist();
  }
  async cancelEntries(){
    await this.sync();
    for(const o of this.s.orders.filter(o=>active(o)&&o.side==='buy'&&this.s.intents.some(i=>i.client_order_id===o.client_order_id))){try{await this.client.cancel(o.id);this.log(`Cancellation requested for ${o.symbol} entry; awaiting broker status.`);}catch(e){if(e.status!==422)throw e;}}
    await this.sync();
  }
  async stop(){this.halt();if(this.client)return this.exclusive(()=>this.cancelEntries());}
  async start(mode){const generation=this.generation;return this.exclusive(async()=>{
    if(!['auto','approval'].includes(mode))throw Error('Choose approval or automatic mode.');
    await this.sync();if(this.s.intents.some(i=>['unknown','submitting'].includes(i.status)))throw Error('Resolve uncertain order submissions with the broker before enabling entries.');
    if(generation!==this.generation)throw Error('Start was interrupted by an emergency stop.');
    if(this.s.ownershipConflicts?.length)throw Error('Position ownership mismatch. Reconcile external activity first.');
    if(this.s.session){if(mode!=='auto')throw Error('Dated sessions use automatic mode.');await this.activateSession();return;}
    if(Number(this.s.account.equity)-this.s.dayStart<=-this.s.dayStart*this.settings().dailyLossPct/100)throw Error('Daily loss limit remains breached.');
    if(this.s.flatten)throw Error('Flatten is still in progress.');
    this.s.mode=mode;this.s.running=true;this.s.halted=false;this.log(`${mode==='auto'?'Automatic':'Approval'} paper entries enabled. Markets must be open and quotes fresh before submission.`);
  });}
  async submit(idea,side,reason,quantity){
    const id=side==='buy'?'sd-'+createHash('sha256').update(idea.id).digest('hex').slice(0,32):'sd-'+randomUUID();
    if(this.s.intents.some(i=>i.client_order_id===id))throw Error('This idea already has a submission record.');
    let order;
    if(side==='buy'){
      const checked=entryRisk(this.s,idea,this.settings(),this.now());
      order={symbol:idea.symbol,qty:String(checked.qty),side,type:'limit',limit_price:checked.price.toFixed(2),time_in_force:'day',extended_hours:false,client_order_id:id};
      if(this.settings().brokerProtection){const prices=bracketPrices(checked.price,this.settings());Object.assign(order,{order_class:'bracket',time_in_force:'gtc',take_profit:{limit_price:prices.target.toFixed(2)},stop_loss:{stop_price:prices.stop.toFixed(2)}});}
    }else{
      if(!this.s.clock.is_open || this.now()>=Date.parse(this.s.clock.next_close) || this.now()-Date.parse(this.s.clock.timestamp)>30000)throw Error('Market is closed or clock is stale; exit deferred.');
      const current=this.s.positions.find(p=>p.symbol===idea.symbol);
      const qty=Math.min(quantity,this.owned(idea.symbol),Number(current?.qty||0));
      if(!Number.isInteger(qty)||qty<1)throw Error('No app-owned whole shares available to sell.');
      if(this.s.orders.some(o=>active(o)&&o.symbol===idea.symbol)||this.s.intents.some(o=>o.symbol===idea.symbol&&['unknown','submitting'].includes(o.status)))throw Error('An order already exists for this stock; exit deferred.');
      order={symbol:idea.symbol,qty:String(qty),side,type:'market',time_in_force:'day',extended_hours:false,client_order_id:id};
    }
    const intent={...order,status:'submitting',createdAt:new Date(this.now()).toISOString(),reason,strategy:idea.strategy||'manual',filled_qty:'0',signalId:idea.id};
    if(side==='buy'){const q=this.s.quotes[idea.symbol];Object.assign(intent,{quoteAsk:Number(q.ap),quoteBid:Number(q.bp),quoteTime:q.t,signalBar:idea.barTime});}
    this.s.intents.push(intent);idea.status='submitting';this.persist(); // Durable before the HTTP request.
    try{const remote=await this.client.submit(order);Object.assign(intent,{status:remote.status,brokerId:remote.id,filled_qty:remote.filled_qty||'0',filled_avg_price:remote.filled_avg_price,filled_at:remote.filled_at});adoptLegs(this.s.intents,[remote]);idea.status='submitted';this.s.orders.unshift(...flattenOrders([remote]));this.log(`${side.toUpperCase()} ${order.qty} ${order.symbol} submitted to paper broker; ${remote.status}${order.order_class==='bracket'?' with broker stop and target':''}.`);}
    catch(e){intent.status=[400,401,403,422].includes(e.status)?'rejected':'unknown';idea.status=intent.status;this.log(`${order.symbol}: ${intent.status==='unknown'?'submission outcome uncertain; new entries blocked':'submission rejected'}.`);throw e;}
    finally{this.persist();}
  }
  async approve(id){return this.exclusive(async()=>{
    const idea=this.s.suggestions.find(i=>i.id===id);if(!idea||idea.status!=='pending')throw Error('Suggestion is no longer pending.');
    if(idea.expiresAt<this.now()){idea.status='expired';throw Error('Suggestion expired.');}
    await this.sync();if(idea.status!=='pending')throw Error('Suggestion was cancelled.');
    try{await this.submit(idea,'buy',idea.reason);}catch(e){if(idea.status==='pending'){idea.status='rejected';idea.error=e.message;}throw e;}
  });}
  decline(id){const idea=this.s.suggestions.find(i=>i.id===id);if(!idea||idea.status!=='pending')throw Error('Suggestion is no longer pending.');idea.status='declined';this.persist();}
  async flatten(){this.halt('Flatten requested. Cancelling app entry orders, then attempting to close app-owned shares.');this.s.flatten=true;this.persist();return this.exclusive(async()=>{await this.cancelEntries();await this.exits();});}
  async closePosition(symbol,reason,strategy){
    const s=this.s;
    (s.exitRequests??={})[symbol]={reason,strategy};this.persist();
    const held=s.orders.filter(o=>o.symbol===symbol&&active(o)&&s.intents.some(i=>i.client_order_id===o.client_order_id));
    if(held.some(o=>o.side==='sell'&&!s.intents.find(i=>i.client_order_id===o.client_order_id)?.protective))return; // An earlier market exit still owns these shares.
    if(held.length){
      for(const o of held){try{await this.client.cancel(o.id);}catch(e){if(e.status!==422)throw e;}}
      // Cancellation can race with a fill. Broker acknowledgement alone does not free shares.
      await this.sync();
    }
    const qty=Math.floor(Math.min(this.owned(symbol),Number(s.positions.find(p=>p.symbol===symbol)?.qty||0)));
    if(qty<1){delete s.exitRequests[symbol];this.persist();return;}
    await this.submit({symbol,strategy},'sell',reason,qty);
  }
  async exits(){
    const s=this.s,c=this.settings(),now=this.now();if(!s.clock?.is_open)return;
    for(const position of s.positions){const qty=Math.min(this.owned(position.symbol),Number(position.qty));if(qty<1)continue;
      if(s.ownershipConflicts?.includes(position.symbol)){this.log(`${position.symbol}: holdings differ from app fill history; automatic exit deferred for reconciliation.`);continue;}
      const owner=this.owner(position.symbol),h=s.history[position.symbol]||[],last=h.at(-1),v=indicators(h);
      const held=(now-Date.parse(owner?.filled_at||owner?.createdAt))/60000;
      let price;try{price=freshQuote(s.quotes[position.symbol],now).bid;}catch{};
      const avg=Number(position.avg_entry_price);
      const reason=s.exitRequests?.[position.symbol]?.reason|| (s.flatten?'Manual or daily-loss flatten':Date.parse(s.clock.next_close)-now<=10*60000?'Exchange session close':held>=(c.maxHoldMinutes??60)?`${c.maxHoldMinutes??60}-minute time exit`:price&&price<=avg*(1-c.stopPct/100)?'Stop threshold':price&&price>=avg*(1+c.takePct/100)?'Profit threshold':last&&now-Date.parse(last.timestamp)<390000&&(owner?.strategy==='reversion'&&last.close>=v.vwap||['breakout','activity','scalp'].includes(owner?.strategy)&&last.close<v.vwap||owner?.strategy==='momentum'&&v.fast<v.slow)?'Strategy exit':null);
      if(reason){try{await this.closePosition(position.symbol,reason,owner?.strategy);}catch(e){this.log(`${position.symbol}: ${e.message}`);}}
    }
    for(const symbol of Object.keys(s.exitRequests||{}))if(this.owned(symbol)<1)delete s.exitRequests[symbol];
    if(!s.positions.some(p=>this.owned(p.symbol)>0)&&!s.orders.some(o=>active(o)&&s.intents.some(i=>i.client_order_id===o.client_order_id)))s.flatten=false;
  }
  async poll(){if(!this.client||this.busy)return;return this.exclusive(async()=>{
    try{
      await this.sync();const s=this.s,now=this.now(),c=this.settings();
      const plan=s.session;
      if(plan?.closeAt&&now>=Date.parse(plan.closeAt)-10*60000){
        if(s.running){plan.status='closing';this.halt('Dated session closing: entries stopped; app positions scheduled for liquidation.');}
        if(s.positions.some(p=>this.owned(p.symbol)>0)||unresolved(s))s.flatten=true;
        if(now>=Date.parse(plan.closeAt)){
          const remaining=s.positions.some(p=>this.owned(p.symbol)>0||Number(p.qty)<0)||unresolved(s)||s.ownershipConflicts?.length||sessionTotals(s)?.valid===false;
          plan.status=remaining?'attention':'complete';
          if(!remaining)s.flatten=false;
          if(!remaining&&!plan.completedAt){plan.completedAt=new Date(now).toISOString();this.log('Session complete. All app positions and orders are resolved; performance saved.');}
        }
      }else if(plan?.status==='armed'&&now>=Date.parse(plan.openAt))plan.status='running';
      for(const i of s.suggestions)if(pending(i)&&i.expiresAt<now)i.status='expired';
      // Cancel aged/unfilled app entries, including those left over after a restart.
      for(const o of s.orders.filter(o=>active(o)&&o.side==='buy')){const i=s.intents.find(i=>i.client_order_id===o.client_order_id);if(i&&(s.halted||now-Date.parse(i.createdAt)>90000||Date.parse(s.clock.next_close)-now<=30*60000)){try{await this.client.cancel(o.id);}catch(e){if(e.status!==422)throw e;}}}
      let capital;try{capital=riskCapital(s);}catch(e){await this.exits();throw e;}
      if(capital.pnl<=-capital.baseline*c.dailyLossPct/100){if(!s.halted)this.halt('Daily loss limit reached; new entries stopped and flatten scheduled.');s.flatten=true;}
      if(c.brokerProtection&&this.protection().unprotected.some(symbol=>!s.exitRequests?.[symbol])){this.halt('Broker stop is missing or not active; entries stopped and app positions scheduled for closure.');s.flatten=true;}
      await this.exits(); // Independent of entry mode, and does not depend on history download success.
      if(!s.clock.is_open||!s.running||s.halted||s.flatten||Object.keys(s.exitRequests||{}).length)return;
      if(plan){try{sessionEntryCheck(s,now);}catch{return;}}
      if(!this.historyFetchedAt||now-this.historyFetchedAt>=30000){await this.refreshHistory();this.historyFetchedAt=now;}
      if(plan)plan.scan={time:new Date(now).toISOString(),results:[]};
      const relative=symbol=>{const values=this.openingVolumes?.[symbol]||[],opening=s.history[symbol]?.find(b=>b.minute===0);return values.length===14&&opening?opening.volume/(values.reduce((n,v)=>n+v,0)/14||Infinity):0;};
      const scalpActivity=symbol=>signalPriority(s.history[symbol]||[],'scalp');
      const scorer=this.strategies().includes('activity')?relative:this.strategies().includes('scalp')?scalpActivity:null;
      const stocks=scorer?[...UNIVERSE].sort((a,b)=>scorer(b)-scorer(a)||a.localeCompare(b)):UNIVERSE;
      for(const symbol of stocks){const h=s.history[symbol]||[],last=h.at(-1),scan={symbol,message:'No qualifying signal on the latest completed bar.'};if(plan)plan.scan.results.push(scan);
        if(!last){scan.message='Waiting for completed five-minute IEX bars.';continue;}
        if(s.seen[symbol]===last.timestamp){scan.message='Latest completed bar already evaluated; waiting for a new bar.';continue;}
        s.seen[symbol]=last.timestamp;
        const recentExit=[...s.intents].reverse().find(i=>i.symbol===symbol&&i.side==='sell'&&Number(i.filled_qty)>0);
        if(recentExit&&now-Date.parse(recentExit.filled_at||recentExit.createdAt)<(c.cooldownMinutes??10)*60000){scan.message=`${c.cooldownMinutes??10}-minute cooldown after the last exit.`;continue;}
        if(s.positions.some(p=>p.symbol===symbol)||s.suggestions.some(i=>i.symbol===symbol&&pending(i))){scan.message='Position or pending suggestion already exists.';continue;}
        for(const strategy of this.strategies()){
          if(strategy==='activity'&&(this.openingVolumes?.[symbol]?.length||0)<14){scan.message='Active breakout needs opening volume from 14 preceding sessions.';continue;}
          const reason=signal(h,strategy,{openingVolumes:this.openingVolumes?.[symbol]});if(!reason)continue;
          let ask;try{ask=freshQuote(s.quotes[symbol],now).ask;}catch(e){scan.message=e.message;break;}
          const capital=riskCapital(s),eq=capital.equity,t=sessionTotals(s),budget=Math.min(eq*c.positionPct/100,eq*c.riskPct/c.stopPct,capital.cash,t?.available??Infinity,eq*c.grossPct/100-(t?.exposure||0)-(t?.reserved||0));
          const qty=Math.floor(Math.min(budget/(ask*1.003),last.volume*c.participationPct/100));if(qty<1){scan.message='Available budget or IEX volume is too small for one share.';break;}
          scan.budget=budget;scan.notional=qty*ask;scan.qty=qty;
          const idea={id:randomUUID(),symbol,strategy,reason,qty,reference:ask,barTime:last.timestamp,expiresAt:now+90000,status:'pending'};
          try{entryRisk(s,idea,c,now);}catch(e){scan.message=e.message;break;}s.suggestions.unshift(idea);this.persist();
          if(s.mode==='auto'){await this.submit(idea,'buy',reason);await this.sync();scan.message=`${qty} shares submitted; awaiting broker fills.`;}else scan.message='Suggestion awaits approval.';break;
        }
      }
      s.suggestions=s.suggestions.slice(0,300);
    }catch(e){this.s.lastError=e.message;
      const transient=e.status===0||e.status===429||e.status>=500;
      if(transient&&!this.s.intents.some(i=>['submitting','unknown'].includes(i.status)))this.log('Temporary provider issue; entries deferred until a fresh reconciliation succeeds. '+e.message);
      else this.halt('Connection or reconciliation issue: '+e.message);
    }
  });}
}
