import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {demoData} from '../engine.mjs';
const base='http://127.0.0.1:14317';
test('HTTP workflow, origin protection, persistence and safe restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'signal-desk-test-'));let child;
 async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'14317',DATA_DIR:dir,SIGNAL_DESK_NO_ENV:'1',ALPACA_PAPER_KEY:'',ALPACA_PAPER_SECRET:''},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server failed to start');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Server start timeout')),5000);t.unref();})]);}
 async function end(){const wait=once(child,'exit');child.kill();await wait;}
 const get=()=>fetch(base+'/api/state').then(r=>r.json());
 const post=(route,body={},headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
 const downloadFixture={...demoData(),label:'Synthetic download fixture (not real market data)',source:{provider:'Yahoo Finance',feed:'public chart',fingerprint:'test-only-fixture'}};
 await writeFile(path.join(dir,'downloaded-market.json'),JSON.stringify(downloadFixture));
 await start();let s=await get();assert.equal(s.account.cash,100000);assert.equal((await fetch(base)).status,200);
 assert.equal(s.dataJob.label,downloadFixture.label);assert.equal(s.dataJob.source.provider,'Yahoo Finance');assert.equal((await fetch(base+'/data-ui.js')).status,200);
 const competing=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'14318',DATA_DIR:dir,SIGNAL_DESK_NO_ENV:'1'},stdio:['ignore','pipe','pipe']});let competingError='';competing.stderr.on('data',chunk=>competingError+=chunk);const [code]=await once(competing,'exit');assert.notEqual(code,0);assert.match(competingError,/already owns this account directory/);
 assert.equal(s.paper.configured,false);assert.equal(s.paper.running,false);assert.equal((await fetch(base+'/paper-ui.js')).status,200);
 assert.equal((await post('paper/connect')).status,400);assert.equal((await post('data/download',{start:'2026-09-01',end:'2026-09-20'})).status,400);
 assert.equal((await post('paper/start',{mode:'auto'})).status,400);assert.equal((await fetch(base+'/api/paper/export')).status,200);
 const sessionDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
 assert.equal((await fetch(base+'/session-ui.js')).status,200);
 assert.equal((await fetch(base+'/standards-ui.js')).status,200);
 assert.equal((await post('paper/session',{date:sessionDate,capital:-1})).status,400);
 assert.equal((await post('paper/session',{date:sessionDate,capital:2000})).status,200);
 s=await get();assert.equal(s.paper.session.capital,2000);assert.equal(s.paper.session.date,sessionDate);assert.equal(s.paper.session.status,'needs_connection');assert.equal(s.paper.running,false);assert.equal(s.paper.performance.equity,2000);
 const malformed=await fetch(base+'/api/paper/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"secret":"sensitive-test-value"'});assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('sensitive-test-value'));
 assert.equal((await post('mode',{mode:'auto'},{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await fetch(base+'/api/stop',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
 assert.equal((await post('step',{count:99999})).status,400);
 assert.equal((await post('settings',{positionPct:-3})).status,400);
 assert.equal((await post('mode',{mode:'auto'})).status,200);await post('step',{count:12});s=await get();assert.ok(s.orders.length>0);assert.ok(s.account.cash<100000);assert.ok(s.orders.every(o=>o.price>0));
 assert.equal((await post('data/load',{capital:2000})).status,400);assert.equal((await get()).cursor,s.cursor);
 await post('stop');s=await get();assert.equal(s.halted,true);assert.equal(s.running,false);assert.ok(!s.queue.some(o=>['pending','approved'].includes(o.status)));
 const cash=s.cash,cursor=s.cursor;assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).cash,cash);await end();await start();s=await get();assert.equal(s.cash,cash);assert.equal(s.cursor,cursor);assert.equal(s.running,false);assert.equal(s.lastDataAt,0);
 assert.equal((await post('flatten')).status,200);s=await get();assert.equal(Object.keys(s.positions).length,0);
 assert.equal((await post('research',{capital:2000})).status,200);s=await get();assert.equal(s.research.results.length,6);assert.equal(s.research.capital,2000);assert.equal(s.research.evidence.status,'insufficient');
 assert.equal((await post('research/real',{capital:2000})).status,400);assert.equal((await get()).research.runNumber,1);
 assert.equal((await fetch(base+'/api/export')).status,200);
 assert.equal((await post('import',{label:'bad',bars:[]})).status,400);assert.equal((await get()).cursor,s.cursor);
 const paperBefore=await fetch(base+'/api/paper/export').then(r=>r.json());
 assert.equal((await post('data/load',{archiveReplay:true,capital:2000})).status,200);
 s=await get();assert.equal(s.startingCash,2000);assert.equal(s.cash,2000);assert.equal(s.mode,'approval');assert.equal(s.running,false);assert.equal(s.data.source.provider,'Yahoo Finance');assert.equal(s.data.synthetic,true);assert.equal(s.data.bars,downloadFixture.bars.length);assert.equal(s.research,undefined);
 await post('mode',{mode:'auto'});await post('step',{count:12});s=await get();assert.ok(Object.keys(s.positions).length);
 assert.equal((await post('data/load',{archiveReplay:true,capital:-1})).status,400);
 assert.equal((await post('data/load',{archiveReplay:true,capital:2000})).status,200);
 const backups=await readdir(path.join(dir,'backups'));const accounts=await Promise.all(backups.map(f=>readFile(path.join(dir,'backups',f),'utf8').then(JSON.parse)));
 assert.ok(accounts.some(b=>b.state.cursor===s.cursor&&Object.keys(b.state.positions).length&&b.dataset.label===downloadFixture.label));
 assert.deepEqual(await fetch(base+'/api/paper/export').then(r=>r.json()),paperBefore);
 await end();await start();s=await get();assert.equal(s.data.source.provider,'Yahoo Finance');assert.equal(s.dataJob.label,downloadFixture.label);assert.equal(s.startingCash,2000);
 }finally{if(child?.exitCode===null)await end();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('signal-desk-test-'));await rm(resolved,{recursive:true,force:true});}
});
