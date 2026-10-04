import {createHash} from 'node:crypto';
import {initial, tick, account, STRATEGIES, openingVolume,prepare} from './engine.mjs';

const round = n => Math.round(n * 100) / 100;
const defaults = {positionPct:25,grossPct:100,riskPct:.5,dailyLossPct:2,maxPositions:4,stopPct:1,takePct:2,participationPct:1};

export async function downloadEvaluation(client,{start,end,costs,capital=2000}) {
  const dataset=await client.historical({start,end,adjustment:'split'});
  const report=evaluate(prepare(dataset),costs,{capital});
  report.datasetFingerprint=createHash('sha256').update(JSON.stringify(dataset.bars)).digest('hex');
  return {dataset,report};
}

// Only preceding sessions supply volume context. No orders or profits from warmup leak into evaluation.
function warmup(frames, before) {
  const sessions = new Map();
  for (const f of frames) {
    if (f.day >= before) break;
    for (const b of f.bars) if (b.minute === 0) {
      const values = sessions.get(b.symbol) || [];
      values.push(openingVolume([b])); sessions.set(b.symbol, values.slice(-14));
    }
  }
  return Object.fromEntries(sessions);
}

function run(data, days, strategies, settings, capital) {
  const allowed = new Set(days), frames = data.frames.filter(f => allowed.has(f.day));
  const s = initial();
  Object.assign(s, {cash:capital,startingCash:capital,dayStart:capital,settings:{...settings},
    mode:'auto',researchMode:true,allocationMode:true,strategies,openingHistory:warmup(data.frames,days[0])});
  for (let i=0; i<frames.length; i++) {
    // A research run represents successive daily tests. A prior day's loss stop does not suppress every later day.
    if (s.day && s.day !== frames[i].day && s.halted) s.halted=false;
    tick(s, {frames}, i*1000);
  }
  let peak=capital, drawdown=0;
  const daily=new Map();
  for (const x of s.equity) {
    peak=Math.max(peak,x.value); drawdown=Math.max(drawdown,(peak-x.value)/peak*100);
    daily.set(x.time.slice(0,10),x.value);
  }
  let previous=capital;
  const dailyReturns=[...daily].map(([date,equity]) => {
    const pnl=equity-previous, returnPct=pnl/previous*100; previous=equity;
    return {date,pnl:round(pnl),returnPct:round(returnPct),equity};
  });
  const wins=s.trades.filter(t=>t.pnl>0),losses=s.trades.filter(t=>t.pnl<0);
  const total=a=>a.reduce((n,t)=>n+t.pnl,0), pnl=account(s).pnl;
  return {returnPct:round(pnl/capital*100),pnl,drawdown:round(drawdown),
    winRate:s.trades.length?round(wins.length/s.trades.length*100):0,
    payoff:wins.length&&losses.length?round((total(wins)/wins.length)/(-total(losses)/losses.length)):null,
    profitFactor:losses.length?round(total(wins)/-total(losses)):null,
    expectancy:s.trades.length?round(total(s.trades)/s.trades.length):null,
    trades:s.trades.length,entries:s.orders.filter(o=>o.side==='buy').length,
    costs:round(s.orders.reduce((n,o)=>n+o.fee+o.qty*o.price*(settings.spreadBps/2+settings.slippageBps)/10000,0)),
    openPositions:Object.keys(s.positions).length,dailyReturns,
    worstDay:dailyReturns.length?Math.min(...dailyReturns.map(d=>d.returnPct)):0,
    curve:s.equity.filter((_,i)=>i%12===0||i===s.equity.length-1)};
}

export function evaluate(data, costs=initial().settings, options={}) {
  const capital=Number(options.capital??2000);
  if (!Number.isFinite(capital)||capital<100||capital>1000000) throw Error('Research capital must be between $100 and $1,000,000.');
  const days=[...new Set(data.frames.map(f=>f.day))];
  if (days.length<6) throw Error('Historical evaluation needs at least six sessions.');
  const split=Math.floor(days.length*.7), train=days.slice(0,split),test=days.slice(split);
  // Match the dated-session preset rather than the unrelated $100k replay account.
  const settings={...initial().settings,...costs,...defaults};
  const stress={...settings,spreadBps:Math.max(10,settings.spreadBps*2),slippageBps:Math.max(10,settings.slippageBps*2),commission:Math.max(.01,settings.commission*2)};
  const recipes=Object.keys(STRATEGIES).map(strategy=>({strategy,enabled:[strategy]}));
  recipes.push({strategy:'baseline',enabled:['breakout','reversion','momentum']});
  const results=recipes.map(({strategy,enabled})=>({strategy,
    train:run(data,train,enabled,settings,capital),test:run(data,test,enabled,settings,capital),
    stress:run(data,test,enabled,stress,capital)}));
  const selected=[...results].sort((a,b)=>b.train.returnPct-a.train.returnPct)[0].strategy;
  // Three expanding-window selections within development data. Final test days never participate.
  const folds=[];
  let end=Math.max(2,Math.floor(train.length*.4));
  const width=Math.max(1,Math.ceil((train.length-end)/3));
  while (end<train.length) {
    const fit=train.slice(0,end), validation=train.slice(end,Math.min(train.length,end+width));
    const scores=recipes.map(r=>({r,score:run(data,fit,r.enabled,settings,capital).returnPct}));
    const choice=scores.sort((a,b)=>b.score-a.score)[0].r;
    folds.push({trainStart:fit[0],trainEnd:fit.at(-1),testStart:validation[0],testEnd:validation.at(-1),
      selected:choice.strategy,validation:run(data,validation,choice.enabled,settings,capital)});
    end+=width;
  }
  const winner=results.find(r=>r.strategy===selected), checks=[
    {label:'Provider-labelled real data',pass:!data.synthetic&&data.source?.provider==='Alpaca'},
    {label:'At least 60 sessions and 15 final test sessions',pass:days.length>=60&&test.length>=15},
    {label:'At least 20 realized exit fills in the final test',pass:winner.test.trades>=20},
    {label:'Positive final-test P&L after modeled costs',pass:winner.test.pnl>0},
    {label:'Positive final-test P&L with stressed costs',pass:winner.stress.pnl>0},
    {label:'No remaining positions at train or test boundaries',pass:!winner.train.openPositions&&!winner.test.openPositions&&!winner.stress.openPositions},
    {label:'At least two of three development walk-forward folds profitable',pass:folds.length===3&&folds.filter(f=>f.validation.pnl>0&&!f.validation.openPositions).length>=2}
  ];
  return {version:2,label:data.label,synthetic:data.synthetic,capital,settings,stressSettings:stress,
    trainDays:split,testDays:test.length,trainEnd:train.at(-1),testStart:test[0],selected,results,folds,
    evidence:{status:checks.every(c=>c.pass)?'paper_candidate':'insufficient',checks},created:new Date().toISOString(),
    note:'Selection uses development net return only; the final chronological 30% is excluded. Walk-forward folds choose using only preceding sessions. Each account starts independently with the stated budget; volume context uses only prior sessions. Costs are modeled, not actual quotes. Exit fill slices count as trades. Residual positions are marked, never fictitiously liquidated. Repeated changes after viewing results contaminate the holdout. Passing checks is a heuristic for further paper observation, not statistical proof or permission for live trading.'};
}
