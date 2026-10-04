import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initial,prepare,demoData,tick,account,approve,stop,log,updateSettings,evaluate,STRATEGIES} from './engine.mjs';
import {Alpaca} from './alpaca.mjs';
import {PaperService,paperInitial} from './paper.mjs';
import {downloadEvaluation} from './research.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),dir=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(root,'data');fs.mkdirSync(dir,{recursive:true});
// One engine per account directory, even if another process chooses a different port.
const lockPath=path.join(dir,'engine.lock'),lockToken=randomUUID();
if(fs.existsSync(lockPath)){
 const owner=JSON.parse(fs.readFileSync(lockPath,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<1)throw Error('Invalid engine lock. Inspect the account directory before starting.');
 let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
 if(alive)throw Error(`An engine already owns this account directory (process ${owner.pid}). Stop it or use a different DATA_DIR.`);
 fs.unlinkSync(lockPath);
}
fs.writeFileSync(lockPath,JSON.stringify({pid:process.pid,token:lockToken}),{flag:'wx'});
process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(lockPath,'utf8')).token===lockToken)fs.unlinkSync(lockPath);}catch{}});
if(process.env.SIGNAL_DESK_NO_ENV!=='1'&&fs.existsSync(path.join(root,'.env.local')))process.loadEnvFile(path.join(root,'.env.local'));
const statePath=path.join(dir,'state.json'),datasetPath=path.join(dir,'dataset.json');
let dataset=fs.existsSync(datasetPath)?JSON.parse(fs.readFileSync(datasetPath,'utf8')):demoData();let market=prepare(dataset);
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):initial();
state.running=false;state.lastDataAt=0;for(const o of state.queue)if(['pending','approved'].includes(o.status))o.status='expired';
if(!state.cursor)for(let i=0;i<12;i++)tick(state,market);
function save(){fs.writeFileSync(statePath+'.tmp',JSON.stringify(state));fs.renameSync(statePath+'.tmp',statePath);}
save();
const paperPath=path.join(dir,'paper.json'),downloadPath=path.join(dir,'downloaded-market.json');
function savePaper(value){const fd=fs.openSync(paperPath+'.tmp','w');try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(paperPath+'.tmp',paperPath);}
const paper=new PaperService({state:fs.existsSync(paperPath)?JSON.parse(fs.readFileSync(paperPath,'utf8')):paperInitial(),save:savePaper,settings:()=>state.settings,strategies:()=>state.strategies});
let dataJob={status:fs.existsSync(downloadPath)?'ready':'idle'};
function checkResearchIdle(){if(paper.busy||paper.s.running||paper.s.positions.some(p=>paper.owned(p.symbol)>0)||paper.s.intents.some(i=>!['filled','canceled','expired','rejected','replaced'].includes(i.status)))throw Error('Stop paper entries and resolve app positions and orders before historical research.');}
function checkResearchFinished(){if(dataJob.status==='loading'&&dataJob.kind==='research')throw Error('Wait for the real-data comparison to finish before arming paper entries.');}
function loadDataset(nextDataset){
 if(Object.keys(state.positions).length)throw Error('Close replay positions before replacing data.');
 const next=prepare(nextDataset);if(next.frames.length<12)throw Error('At least 12 distinct bar times required');
 const backup=path.join(dir,'backups');fs.mkdirSync(backup,{recursive:true});const tag=Date.now();
 fs.writeFileSync(path.join(backup,`replay-${tag}.json`),JSON.stringify({state,dataset}));
 fs.writeFileSync(datasetPath+'.tmp',JSON.stringify(nextDataset));fs.renameSync(datasetPath+'.tmp',datasetPath);
 const settings=state.settings,strategies=state.strategies;dataset=nextDataset;market=next;state=initial();state.settings=settings;state.strategies=strategies;
 for(let i=0;i<12;i++)tick(state,market);log(state,'Historical dataset loaded. Previous replay account and data backed up locally.');
}
const port=Number(process.env.PORT||4317),host='127.0.0.1';
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(403,{error:'Local access only'});
 const url=new URL(req.url,`http://${host}:${port}`);
 if(req.method==='GET'&&url.pathname==='/api/state')return send(200,{...state,history:undefined,account:account(state),watch:Object.values(state.quotes).map(q=>({...q,series:(state.history[q.symbol]||[]).map(b=>b.close)})),data:{label:market.label,synthetic:market.synthetic,source:market.source,total:market.frames.length,sessions:new Set(market.frames.map(f=>f.day)).size},strategyInfo:STRATEGIES,paper:paper.public(),dataJob});
 if(req.method==='GET'&&url.pathname==='/api/paper/export')return send(200,paper.public());
 if(req.method==='GET'&&url.pathname==='/api/export')return send(200,{account:account(state),orders:state.orders,trades:state.trades,settings:state.settings,research:state.research||null,dataset:market.label});
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
 if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return send(403,{error:'Origin blocked'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON required'});
 let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>40000000){send(413,{error:'Upload limit is 40 MB'});return;}body+=chunk;}let b;try{b=JSON.parse(body||'{}');}catch{throw Error('Invalid JSON request body.');}if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Request must be a JSON object.');
 switch(url.pathname){
 case '/api/step':{const count=b.count??1;if(!Number.isInteger(count)||count<1||count>78)throw Error('Advance 1–78 bars at a time');for(let i=0;i<count;i++)tick(state,market);break;}
 case '/api/run':if(state.halted)throw Error('Resume entries before starting replay');if(state.cursor>=market.frames.length)throw Error('Dataset ended. Reset the demo to replay it.');state.running=!state.running;log(state,state.running?'Replay started: one market bar every two seconds.':'Replay paused.');break;
 case '/api/stop':stop(state);save();try{await paper.stop();}catch(e){paper.s.lastError=e.message;paper.persist();}break;
 case '/api/resume':if(account(state).dailyPnl<=-state.dayStart*state.settings.dailyLossPct/100)throw Error('Daily loss limit still breached');state.halted=false;log(state,'New entries enabled.');break;
 case '/api/flatten':state.flatten=true;for(const o of state.queue)if(['approved','pending'].includes(o.status))o.status='cancelled';tick(state,market);break;
 case '/api/approve':approve(state,b.id);break;
 case '/api/reject':{const o=state.queue.find(o=>o.id===b.id);if(!o||o.status!=='pending')throw Error('Suggestion no longer pending');o.status='declined';break;}
 case '/api/settings':updateSettings(state,b);delete state.research;break;
 case '/api/mode':if(!['approval','auto'].includes(b.mode))throw Error('Invalid mode');state.mode=b.mode;for(const o of state.queue)if(['approved','pending'].includes(o.status))o.status='cancelled';log(state,`Mode changed to ${b.mode}; existing suggestions cancelled.`);break;
 case '/api/strategies':if(!Array.isArray(b.strategies)||!b.strategies.length||b.strategies.some(k=>!STRATEGIES[k]))throw Error('Choose at least one strategy');state.strategies=[...new Set(b.strategies)];for(const o of state.queue)if(['approved','pending'].includes(o.status)&&!state.strategies.includes(o.strategy))o.status='cancelled';break;
 case '/api/research':{checkResearchIdle();const report=evaluate(market,state.settings,{capital:b.capital??paper.s.session?.capital??2000});state.researchRuns=(state.researchRuns||0)+1;report.runNumber=state.researchRuns;state.research=report;break;}
 case '/api/research/real':{
  checkResearchIdle();
  if(!paper.client)throw Error('Connect Alpaca paper credentials locally first.');
  if(dataJob.status==='loading')throw Error('A historical download is already in progress.');
  const capital=Number(b.capital??paper.s.session?.capital??2000);
  if(!Number.isFinite(capital)||capital<100||capital>1000000)throw Error('Research capital must be between $100 and $1,000,000.');
  const end=new Date(Date.now()-86400000).toISOString().slice(0,10),start=new Date(Date.parse(end)-119*86400000).toISOString().slice(0,10);
  const client=paper.client,costs={...state.settings};
  dataJob={status:'loading',kind:'research',startedAt:new Date().toISOString(),start,end};
  downloadEvaluation(client,{start,end,costs,capital}).then(({dataset:d,report})=>{
   fs.writeFileSync(downloadPath+'.tmp',JSON.stringify(d));fs.renameSync(downloadPath+'.tmp',downloadPath);
   state.researchRuns=(state.researchRuns||0)+1;report.runNumber=state.researchRuns;state.research=report;save();
   dataJob={status:'ready',kind:'research',label:d.label,bars:d.bars.length,sessions:report.trainDays+report.testDays,source:d.source};
  }).catch(e=>{dataJob={status:'error',kind:'research',error:e.message};});break;
 }
 case '/api/import':loadDataset({...b,synthetic:false,source:undefined});break;
 case '/api/paper/connect':{
  checkResearchFinished();
  const key=b.key||process.env.ALPACA_PAPER_KEY,secret=b.secret||process.env.ALPACA_PAPER_SECRET;
  if(!key||!secret)throw Error('Add your Alpaca paper API key and secret in this form or .env.local.');
  await paper.connect(new Alpaca({key,secret}));break;
 }
 case '/api/paper/sync':await paper.exclusive(()=>paper.sync());break;
 case '/api/paper/session':checkResearchFinished();await paper.configureSession(b);break;
 case '/api/paper/start':checkResearchFinished();await paper.start(b.mode);break;
 case '/api/paper/stop':await paper.stop();break;
 case '/api/paper/approve':await paper.approve(b.id);break;
 case '/api/paper/decline':paper.decline(b.id);break;
 case '/api/paper/flatten':await paper.flatten();break;
 case '/api/paper/disconnect':{
  paper.halt();await paper.exclusive(async()=>{
   await paper.sync();
   if(paper.s.positions.some(p=>paper.owned(p.symbol)>0)||paper.s.intents.some(i=>!['filled','canceled','expired','rejected','replaced'].includes(i.status)))throw Error('App-owned positions or unresolved orders remain. Flatten/reconcile before disconnecting.');
   paper.client=null;paper.s.connected=false;paper.log('Paper credentials removed from process memory.');
  });break;
 }
 case '/api/data/download':{
  if(!paper.client)throw Error('Connect Alpaca paper credentials first.');if(dataJob.status==='loading')throw Error('A data download is already in progress.');
  dataJob={status:'loading',startedAt:new Date().toISOString()};const client=paper.client;
  client.historical({start:b.start,end:b.end,stocks:b.stocks,adjustment:'split'}).then(d=>{
   const checked=prepare(d);if(new Set(checked.frames.map(f=>f.day)).size<6)throw Error('Choose a range with at least six available exchange sessions.');
   fs.writeFileSync(downloadPath+'.tmp',JSON.stringify(d));fs.renameSync(downloadPath+'.tmp',downloadPath);
   dataJob={status:'ready',label:d.label,bars:d.bars.length,sessions:new Set(checked.frames.map(f=>f.day)).size,source:d.source};
  }).catch(e=>{dataJob={status:'error',error:e.message};});break;
 }
 case '/api/data/load':if(dataJob.status==='loading')throw Error('Wait for the download to finish.');if(!fs.existsSync(downloadPath))throw Error('Download historical bars first.');loadDataset(JSON.parse(fs.readFileSync(downloadPath,'utf8')));break;
 case '/api/reset':{const settings=state.settings,strategies=state.strategies;if(b.confirm!=='RESET')throw Error('Type RESET to clear the account');dataset=demoData();market=prepare(dataset);state=initial();state.settings=settings;state.strategies=strategies;if(fs.existsSync(datasetPath))fs.unlinkSync(datasetPath);for(let i=0;i<12;i++)tick(state,market);break;}
 default:return send(404,{error:'Unknown action'});
 }save();return send(200,{ok:true});
 }
 if(req.method!=='GET')return send(405,{error:'Method not allowed'});
 const assets={'/':'index.html','/app.js':'app.js','/paper-ui.js':'paper-ui.js','/session-ui.js':'session-ui.js','/research-ui.js':'research-ui.js','/standards-ui.js':'standards-ui.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};const name=assets[url.pathname];if(!name)return send(404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/javascript','Cache-Control':'no-cache'});res.end(fs.readFileSync(path.join(root,'public',name)));
 }catch(e){send(400,{error:e.message});}
});
setInterval(()=>{try{let changed=false;for(const o of state.queue)if(['pending','approved'].includes(o.status)&&Date.now()>o.expiresAt){o.status='expired';changed=true;}if(state.running){tick(state,market);changed=true;}if(changed)save();}catch(e){state.running=false;log(state,'Engine paused: '+e.message);console.error(e);}},2000);
setInterval(()=>{paper.poll().catch(e=>{paper.s.lastError=e.message;paper.halt('Paper monitor paused after a persistence or provider error.');});},10000);
server.listen(port,host,()=>console.log(`Signal Desk • paper only • http://${host}:${port}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{state.running=false;save();paper.halt('Server stopped. Exit monitoring is offline until reconnected. Broker orders may remain open.');server.close(()=>process.exit());});
