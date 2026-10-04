const round=n=>Math.round(n*100)/100;

// Aggregate partial exits into completed position cycles, net of recorded fees.
export function completedTrades(orders){
 const lots=new Map(),trades=[];
 for(const o of [...orders].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time))){
  const qty=Number(o.qty),price=Number(o.price),fee=Number(o.fee||0);
  if(!(qty>0&&price>0&&Number.isFinite(fee)))continue;
  const lot=lots.get(o.symbol)||{qty:0,entryCost:0,proceeds:0,entryQty:0,strategy:o.strategy,openedAt:o.time};
  if(o.side==='buy'){lot.qty+=qty;lot.entryQty+=qty;lot.entryCost+=qty*price+fee;}
  else if(o.side==='sell'){
   if(qty>lot.qty+1e-6)throw Error('Exit fills exceed owned shares in the performance ledger.');
   lot.qty-=qty;lot.proceeds+=qty*price-fee;
   if(lot.qty<1e-6){trades.push({symbol:o.symbol,strategy:lot.strategy,qty:lot.entryQty,openedAt:lot.openedAt,closedAt:o.time,pnl:round(lot.proceeds-lot.entryCost)});lots.delete(o.symbol);continue;}
  }
  lots.set(o.symbol,lot);
 }
 return trades;
}

export function tradeMetrics(trades){
 const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),sum=a=>a.reduce((n,t)=>n+t.pnl,0);
 const gains=sum(wins),loss=-sum(losses),realized=sum(trades),best=Math.max(0,...wins.map(t=>t.pnl));
 return {roundTrips:trades.length,realized:round(realized),winRate:trades.length?round(wins.length/trades.length*100):0,
  payoff:wins.length&&losses.length?round(gains/wins.length/(loss/losses.length)):null,
  profitFactor:losses.length?round(gains/loss):null,expectancy:trades.length?round(realized/trades.length):null,
  bestTrade:round(best),pnlWithoutBestTrade:round(realized-best),bestWinnerShare:gains?round(best/gains*100):null};
}

export function paperExecution(intents){
 const entries=intents.filter(i=>i.side==='buy'),filled=entries.filter(i=>Number(i.filled_qty)>0);
 const measured=filled.filter(i=>Number(i.quoteAsk)>0&&Number(i.filled_avg_price)>0);
 const shares=measured.reduce((n,i)=>n+Number(i.filled_qty),0);
 return {entryAttempts:entries.length,filledEntries:filled.length,rejectedEntries:entries.filter(i=>i.status==='rejected').length,
  measuredEntries:measured.length,entrySlippageBps:shares?round(measured.reduce((n,i)=>n+Number(i.filled_qty)*(Number(i.filled_avg_price)/Number(i.quoteAsk)-1)*10000,0)/shares):null};
}

export function dataQuality(data){
 const symbols=data.source?.stocks||[...new Set(data.frames.flatMap(f=>f.bars.map(b=>b.symbol)))];
 const days=[...new Set(data.frames.map(f=>f.day))],calendar=data.source?.calendar;
 const sessions=calendar?.length?calendar.map(d=>({day:d.date,closeMinute:Number(d.close.slice(0,2))*60+Number(d.close.slice(3))-570})):days.map(day=>({day,closeMinute:data.frames.find(f=>f.day===day)?.bars[0]?.sessionCloseMinute??390}));
 const present=new Set(data.frames.flatMap(f=>f.bars.map(b=>`${b.day}/${b.symbol}/${b.minute}`)));
 let expected=0,missing=0,offGrid=0;
 for(const {day,closeMinute} of sessions)for(const symbol of symbols)for(let minute=0;minute<closeMinute;minute+=5){expected++;if(!present.has(`${day}/${symbol}/${minute}`))missing++;}
 for(const f of data.frames)for(const b of f.bars)if(b.minute%5||Date.parse(b.timestamp)%300000)offGrid++;
 const missingSessions=sessions.filter(s=>!days.includes(s.day)).map(s=>s.day);
 return {symbols,sessions:sessions.length,expectedBars:expected,missingBars:missing,offGrid,missingSessions,coveragePct:expected?round((expected-missing)/expected*100):0,
  note:'Missing IEX bars may reflect no exchange trades; bars are never invented. Coverage uses five-minute calendar slots. This does not check survivorship, corporate actions or consolidated-market prices.'};
}

// A transparent passive comparator, excluded from strategy selection. Holds overnight.
export function basketBenchmark(data,days,capital,costs){
 const allowed=new Set(days),frames=data.frames.filter(f=>allowed.has(f.day));
 const symbols=data.source?.stocks||[...new Set(data.frames.flatMap(f=>f.bars.map(b=>b.symbol)))];
 const positions={},marks={};let cash=capital,peak=capital,drawdown=0;
 const curve=[];
 for(const f of frames){
  for(const b of f.bars){
   if(f.day===days[0]&&b.minute===0&&!positions[b.symbol]){
    const price=b.open*(1+(costs.spreadBps/2+costs.slippageBps)/10000),qty=Math.floor(capital/symbols.length/(price+costs.commission));
    if(qty>0){positions[b.symbol]=qty;cash-=qty*(price+costs.commission);}
   }
   marks[b.symbol]=b.close;
  }
  const equity=cash+Object.entries(positions).reduce((n,[sym,qty])=>n+qty*marks[sym],0);
  peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak*100);
  if(f.minute===0||f===frames.at(-1))curve.push({time:f.timestamp,value:equity});
 }
 const equity=cash+Object.entries(positions).reduce((n,[sym,qty])=>n+qty*marks[sym],0);
 return {name:'Equal-weight stock basket',pnl:round(equity-capital),returnPct:round((equity/capital-1)*100),drawdown:round(drawdown),cash:round(cash),curve,
  note:'Whole shares, equal starting cash per stock, entry costs included; holds through the entire period including overnight. Final value is marked, not liquidated. Different exposure and overnight risk from day trading. Missing opening bars leave that stock’s budget in cash. Not used to select a strategy.'};
}
