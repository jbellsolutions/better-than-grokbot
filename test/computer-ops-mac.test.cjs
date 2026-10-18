const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawn } = require('node:child_process');
const load = require('./helpers/load-ts.cjs');

test('current and twenty future teams each have one main Head of Ops orchestrator', () => {
  const { ensureTeamOperations } = load('lib/team-operations.ts');
  const state = { bots: Array.from({length: 21}, (_,i)=>({id:`lead-${i}`,name:`Computer ${i}`,workspaceId:`team-${i}`,isMain:true,instructions:'Keep my charter',computerId:`computer-${i}`})), chats: [], messages: [{text:'Keep history'}] };
  ensureTeamOperations(state);
  assert.equal(state.bots.length, 21);
  for (let i=0;i<21;i++) {
    const team=state.bots.filter(b=>b.workspaceId===`team-${i}`);
    assert.equal(team.filter(b=>b.isMain).length,1); assert.equal(team.filter(b=>b.teamRole==='operations').length,1);
    const ops=team.find(b=>b.teamRole==='operations'); assert.equal(ops.isMain,true); assert.equal(ops.role,'Head of Ops · Orchestrator');
    ops.name=`My Ops ${i}`; ops.instructions='Keep these instructions'; ops.hidden=i%2===0;
  }
  const before=JSON.stringify(state); ensureTeamOperations(state); assert.equal(JSON.stringify(state),before);
  assert.equal(new Set(state.bots.map(b=>b.id)).size,21);
});

test('store migration and later team creation establish Ops without provider calls or rewriting history', () => {
  const initial={bots:[{id:'lead',name:'Custom Lead',isMain:true}],chats:[],messages:[{id:'saved',chatId:'bot:lead',text:'Keep me'}]};
  const store=load('lib/server/store.ts', {'./instance':{instanceId:()=> 'new-computer',instanceName:()=> 'New Computer',instanceComputer:()=> 'machine'},'./business-profiles':{reconcileProfiles:()=>{}},'./persist':{onPostgres:()=>false,fileStore:()=>({initial:()=>initial,changed:()=>{}})},'./persist-pg':{}});
  assert.equal(store.getState().bots.filter(b=>b.teamRole==='operations').length,1);
  store.update(s=>{s.bots.push({id:'second-lead',name:'Another',isMain:true,workspaceId:'second-team'});});
  assert.equal(store.getState().bots.filter(b=>b.teamRole==='operations').length,2);
  assert.equal(store.getState().messages[0].text,'Keep me');
});

test('Mac access is denied for every fresh instance until its owner allows it; opt-out remains', () => {
  for (const id of ['default','team-a','team-b','team-c','team-d','future-computer']) {
    const state={}; const processStub={env:{}};
    const {macAccessAllowed}=load('lib/server/mac-access.ts',{'./store':{getState:()=>state},'./instance':{instanceId:()=>id}},{process:processStub});
    assert.equal(macAccessAllowed(),false); state.mac={accessEnabled:true};assert.equal(macAccessAllowed(),true);
    state.mac.accessEnabled=false;assert.equal(macAccessAllowed(),false);state.mac.accessEnabled=true;processStub.env.BOPS_DISABLE_MAC='1';assert.equal(macAccessAllowed(),false);
  }
});

test('Mac discovery finds an existing Codex beside version-managed Node when LaunchAgent PATH omits it', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-codex-discovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const nodeDir=path.join(root,'version-managed/bin');fs.mkdirSync(nodeDir,{recursive:true});const installed=path.join(nodeDir,'codex');fs.writeFileSync(installed,'fixture',{mode:0o700});
  const cli=load('lib/server/codex-cli.ts',{'node:os':{homedir:()=>root}},{process:{env:{PATH:path.join(root,'empty')},execPath:path.join(nodeDir,'node')}});
  assert.equal(cli.findCodex(),installed);fs.rmSync(installed);assert.equal(cli.findCodex(),undefined);
});

test('Mac approval API rejects invalid or stale decisions and permission edits retain scoped settings', async () => {
  const state={mac:{ready:true,approvals:[],alwaysApps:['Calculator'],rules:['my Mac']},sessions:[]};let answers=0,checks=0;
  const route=load('app/api/mac/route.ts',{'@/lib/server/codex':{emptyMac:()=>({ready:false,approvals:[],alwaysApps:[],rules:[]}),answer:()=>{answers++;return false;},checkMac:async()=>{checks++;}},'@/lib/server/store':{getState:()=>state,update:fn=>fn(state)},'@/lib/server/owner-email':{fromThisMac:r=>new URL(r.url).hostname==='localhost'}});
  const post=body=>route.POST(new Request('http://localhost/api/mac',{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await post({id:'request',decision:'yes'})).status,400);assert.equal(answers,0);
  assert.equal((await post({id:'stale',decision:'once'})).status,409);
  assert.equal((await route.PATCH(new Request('https://outside.example/api/mac',{method:'PATCH',body:'{"enabled":true}'}))).status,403);
  const patch=body=>route.PATCH(new Request('http://localhost/api/mac',{method:'PATCH',body:JSON.stringify(body)}));
  assert.equal((await patch({enabled:'yes'})).status,400);
  assert.equal((await patch({enabled:true})).status,200);assert.equal(state.mac.accessEnabled,true);assert.equal(checks,1);
  assert.deepEqual(state.mac.alwaysApps,['Calculator']);state.sessions.push({runsOn:'mac',status:'running'});
  assert.equal((await patch({enabled:false})).status,409);assert.equal(state.mac.accessEnabled,true);
  state.sessions[0].status='failed';state.sessions[0].macPending=true;
  assert.equal((await patch({enabled:false})).status,409);state.sessions[0].macPending=false;
});

function controller(instance='future-computer') {
  const state={sessions:[{id:'task',botId:'ops',codexThread:'thread',status:'running'}]};let allowed=false,sequence=0;
  const api=load('lib/server/codex.ts',{'./store':{getState:()=>state,update:fn=>fn(state),id:p=>`${p}-${++sequence}`},'./instance':{instanceId:()=>instance,instanceName:()=>instance},'./mac-access':{macAccessAllowed:()=>allowed},'./codex-cli':{findCodex:()=>'/fixture/codex',installStatus:()=>undefined},'./local':{agentEnv:()=>({})},'./persist':{onPostgres:()=>false},'node:fs':{existsSync:()=>true,readFileSync:()=> '[plugins."computer-use@openai-bundled"]\nenabled = true'}},{process:{env:{},platform:'darwin'},setInterval:()=>0,setTimeout:(fn,ms)=>setTimeout(fn,ms).unref()});
  return {state,module:api,allow:()=>{allowed=true;state.mac.accessEnabled=true;}};
}

test('Mac checks finish at a permission state; concurrent checks share one bounded provider connection check', async () => {
  const f=controller();await f.module.checkMac();assert.equal(f.state.mac.next,'permission');assert.match(f.state.mac.reason,/Allow/);
  f.allow();let finish,reads=0;f.module.codex.ready=()=>new Promise(r=>{finish=r;});f.module.codex.request=async method=>{assert.equal(method,'account/read');reads++;return {account:{type:'chatgpt',planType:'pro'}};};
  const first=f.module.checkMac(),second=f.module.checkMac();assert.equal(first,second);finish();assert.equal(await first,true);assert.equal(reads,1);assert.equal(f.state.mac.ready,true);
  f.module.codex.ready=async()=>{throw Error('Unavailable');};assert.equal(await f.module.checkMac(),false);assert.match(f.state.mac.reason,/Unavailable/);
});

test('even Calculator requests an explicit app grant; task and always grants stay in their instance', async () => {
  const f=controller('computer-a'),other=controller('computer-b');await Promise.all([f.module.checkMac(),other.module.checkMac()]);f.allow();other.allow();
  const responses=[];f.module.codex.respond=(id,result)=>responses.push({id,result});
  const ask=id=>f.module.codex.ask({id,method:'mcpServer/elicitation/request',params:{threadId:'thread',message:'Need to use "Calculator"'}});
  await ask(1);assert.equal(responses.length,0);assert.equal(f.state.mac.approvals.length,1);
  const id=f.state.mac.approvals[0].id;assert.equal(other.module.answer(id,'always'),false);
  assert.equal(f.module.answer(id,'once'),true);assert.equal(responses[0].result.action,'accept');
  await ask(2);assert.equal(f.state.mac.approvals.length,1);f.module.answer(f.state.mac.approvals[0].id,'always');
  assert.equal(f.state.mac.alwaysApps[0],'Calculator');assert.equal(other.state.mac.alwaysApps.length,0);
  await ask(3);assert.equal(f.state.mac.approvals.length,0);assert.equal(responses.at(-1).result.action,'accept');
});

test('file and network permissions return only the owner-approved request with the correct scope', async () => {
  const f=controller();await f.module.checkMac();f.allow();const responses=[];f.module.codex.respond=(id,result)=>responses.push(result);
  const permissions={fileSystem:{write:['/fixture/project']}};
  await f.module.codex.ask({id:7,method:'item/permissions/requestApproval',params:{threadId:'thread',permissions,reason:'Build the app'}});
  assert.equal(f.state.mac.approvals[0].kind,'permissions');f.module.answer(f.state.mac.approvals[0].id,'session');
  assert.equal(JSON.stringify(responses[0]),JSON.stringify({permissions,scope:'session'}));
  await f.module.codex.ask({id:8,method:'item/permissions/requestApproval',params:{threadId:'thread',permissions}});
  f.module.answer(f.state.mac.approvals[0].id,'deny');assert.equal(JSON.stringify(responses.at(-1)),JSON.stringify({permissions:{},scope:'turn'}));
});

test('command previews are scoped to a pending approval and are not copied into persisted state', async()=>{
  const f=controller();await f.module.checkMac();f.allow();f.module.codex.respond=()=>{};
  const command=['node','create-app.js'];await f.module.codex.ask({id:44,method:'item/commandExecution/requestApproval',params:{threadId:'thread',itemId:'action',command,cwd:'/fixture/project'}});
  const id=f.state.mac.approvals[0].id;
  assert.equal(f.state.mac.approvals[0].command,undefined);assert.equal(f.state.mac.approvals[0].preview,undefined);
  const route=load('app/api/mac/preview/route.ts',{'@/lib/server/codex':{codex:f.module.codex},'@/lib/server/store':{getState:()=>f.state}});
  const data=await (await route.GET(new Request(`http://localhost/api/mac/preview?id=${id}`))).json();assert.deepEqual(data.preview.command,command);assert.equal(data.preview.cwd,'/fixture/project');
  f.module.answer(id,'deny');assert.equal((await route.GET(new Request(`http://localhost/api/mac/preview?id=${id}`))).status,409);
  assert.equal((await route.GET(new Request('http://localhost/api/mac/preview?id=another-computer'))).status,409);
});

test('future registries accept twenty new local computer identities while rejecting unsafe endpoints', () => {
  const {validateRegistry,instanceEnv}=require('../desktop/instances.cjs');
  const entries=Array.from({length:21},(_,i)=>({id:i?`future-${i}`:'default',name:`Computer ${i}`,port:3210+i,url:`http://localhost:${3210+i}`}));
  assert.equal(validateRegistry(entries).length,21);
  for(const change of [{id:'../unsafe'},{port:9999},{url:'https://outside.example'},{id:'default'}]) assert.throws(()=>validateRegistry(entries.map((e,i)=>i===20?{...e,...change}:e)),/Invalid/);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-future-env-'));try{assert.equal(instanceEnv(root,entries[20],{}).BOPS_DISABLE_MAC,'');}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Mac admission spans coordinators and cannot reclaim a live worker or release another computer’s slot', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-mac-slots-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const living=new Set([1,2,3,4]);
  const capacity=(id,pid)=>load('lib/server/mac-capacity.ts',{'./instance':{instanceId:()=>id,registryPath:()=>path.join(root,'instances.json')}},{process:{pid,kill:p=>{if(!living.has(p))throw Object.assign(Error('Gone'),{code:'ESRCH'});}}});
  const a=capacity('a',1),b=capacity('b',2),c=capacity('c',3),d=capacity('future',4);
  assert.equal(a.claimMac('one'),0);assert.equal(b.claimMac('two'),1);assert.equal(c.claimMac('three'),2);assert.equal(d.claimMac('four'),null);
  b.releaseMac('one');assert.equal(d.claimMac('four'),null);a.bindMacWorker('one',2);living.delete(1);assert.equal(d.claimMac('four'),null);
  living.delete(2);assert.equal(d.claimMac('four'),0);d.releaseMac('four');assert.equal(c.claimMac('next'),0);
});

test('startup clears stale Mac turns only when both recorded owners ended and preserves legacy default permission', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-mac-recovery-'));
  try {
    for (const [slot,task,instance,worker] of [[0,'ended','default',987654322],[1,'live','default',process.pid],[2,'other','elsewhere',987654322]]) {
      const dir=path.join(root,'mac-leases',String(slot));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({instance,task,coordinator:987654321,worker}));
    }
    const initial={bots:[{id:'lead',name:'Lead',isMain:true}],chats:[],messages:[],mac:{checkedAt:1,ready:true,alwaysApps:['Calculator']},sessions:['ended','live','missing'].map(id=>({id,goal:'Keep goal',runsOn:'mac',status:'running',codexTurn:'turn',macPending:true}))};
    const store=load('lib/server/store.ts',{'./instance':{instanceId:()=> 'default',instanceName:()=> 'Default',instanceComputer:()=> '',registryPath:()=>path.join(root,'instances.json')},'./business-profiles':{reconcileProfiles:()=>{}},'./persist':{onPostgres:()=>false,fileStore:()=>({initial:()=>initial,changed:()=>{}})},'./persist-pg':{}});
    const state=store.getState();assert.equal(state.mac.accessEnabled,true);assert.equal(state.mac.ready,false);assert.deepEqual(Array.from(state.mac.alwaysApps),['Calculator']);
    const ended=state.sessions.find(s=>s.id==='ended');assert.equal(ended.codexTurn,undefined);assert.equal(ended.macPending,false);assert.equal(ended.status,'failed');
    for(const id of ['live','missing']){const s=state.sessions.find(s=>s.id===id);assert.equal(s.codexTurn,'turn');assert.equal(s.macPending,true);assert.equal(s.status,'failed');}
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('two real Node coordinators racing to reclaim a dead Mac slot admit only one', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-mac-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(let slot=0;slot<3;slot++){fs.mkdirSync(path.join(root,'mac-leases',String(slot)),{recursive:true});fs.writeFileSync(path.join(root,'mac-leases',String(slot),'owner.json'),JSON.stringify({instance:'old',task:String(slot),coordinator:slot?process.pid:987654321}));}
  const code=`const load=require('./test/helpers/load-ts.cjs');const path=require('node:path');const m=load('lib/server/mac-capacity.ts',{'./instance':{instanceId:()=>process.argv[2],registryPath:()=>path.join(process.argv[1],'instances.json')}});process.stdin.resume();console.log(JSON.stringify({slot:m.claimMac('work')}));`;
  const children=[spawn(process.execPath,['-e',code,root,'a']),spawn(process.execPath,['-e',code,root,'b'])];t.after(()=>children.forEach(c=>c.kill()));
  const results=await Promise.all(children.map(c=>new Promise((resolve,reject)=>{let output='';c.stdout.on('data',data=>{output+=data;if(output.includes('\n'))resolve(JSON.parse(output).slot);});c.on('error',reject);c.on('exit',code=>{if(!output)reject(Error(`Child exited ${code}`));});})));
  assert.equal(results.filter(slot=>slot===0).length,1);assert.equal(results.filter(slot=>slot===null).length,1);
});

function macTurnFixture(){
  const source=ts.createSourceFile('sessions.ts',fs.readFileSync('lib/server/sessions.ts','utf8'),ts.ScriptTarget.Latest,true);const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='macTurn');
  const state={steps:[]};let listener,startResolve,startReject,timer,released=0;const calls=[];
  const context={exports:{},codex:{on:(_id,fn)=>{listener=fn;},off:()=>{listener=undefined;},request:(method,params)=>{calls.push({method,params});return method==='turn/start'?new Promise((r,j)=>{startResolve=r;startReject=j;}):Promise.resolve({});}},patchSession:(_id,patch)=>typeof patch==='function'?patch(state):Object.assign(state,patch),session:()=>state,step:()=>{},noteMacTarget:()=>{},stopped:new Set(),interrupts:new Map(),TURN_TIMEOUT_MS:10,setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{},releaseMac:()=>{released++;},pump:()=>{}};
  vm.runInNewContext(ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS}}).outputText,context);
  return {state,calls,run:()=>context.macTurn('task','thread','Build app'),resolve:()=>startResolve({turn:{id:'turn'}}),reject:()=>startReject(Object.assign(Error('Rejected'),{rpcRejected:true})),timeout:()=>timer(),emit:m=>listener?.(m),released:()=>released};
}

test('Mac timeout retains admission until actual terminal cleanup, including a late start response', async()=>{
  const f=macTurnFixture();const p=f.run();f.timeout();await assert.rejects(p,/too long/);assert.equal(f.state.macPending,true);assert.equal(f.released(),0);
  f.resolve();await Promise.resolve();assert.equal(f.state.codexTurn,'turn');assert.ok(f.calls.some(c=>c.method==='turn/interrupt'));
  f.emit({method:'turn/completed',params:{turn:{status:'interrupted'}}});assert.equal(f.state.codexTurn,undefined);assert.equal(f.state.macPending,false);assert.equal(f.released(),1);
});

test('Mac terminal-before-response and explicit RPC rejection cannot leave a false live turn',async()=>{
  const f=macTurnFixture();const p=f.run();f.emit({method:'turn/completed',params:{turn:{status:'completed'}}});assert.equal(await p,'Done.');f.resolve();await Promise.resolve();assert.equal(f.state.codexTurn,undefined);assert.equal(f.state.macPending,false);
  const g=macTurnFixture();const q=g.run();g.reject();await assert.rejects(q,/Rejected/);assert.equal(g.state.macPending,false);assert.equal(g.state.codexTurn,undefined);
});
