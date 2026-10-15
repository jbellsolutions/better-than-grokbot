const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function load(file,modules,extras={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports,require:n=>n==='server-only'?{}:n in modules?modules[n]:require(n),...extras});return exports}
function scratch(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-business-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
// A team's imported profiles (.data/business/current-profiles.json); none ship with the app.
const profiles=[
 {id:'head-of-operations',name:'Head of operations',instances:['team-a','team-b'],optional:false,screen:'optional',instructions:'Coordinate the team.\nKeep work moving.',sources:[{id:'s1'}]},
 {id:'writer',name:'Writer',instructions:'Draft copy.',instances:['team-a','team-b'],optional:false,screen:'none',sources:[{id:'s2'}]},
 {id:'researcher',name:'Researcher',instructions:'Research accounts.',instances:['team-a'],optional:true,screen:'optional',sources:[{id:'s3'}]},
];
function profilesModule(t,list=profiles){const root=scratch(t),file=path.join(root,'current-profiles.json');fs.writeFileSync(file,JSON.stringify(list));return load('lib/server/business-profiles.ts',{'@/lib/types':{botChatId:id=>'bot:'+id,workspaceOf:b=>b.workspaceId??'ws_main'},'./instance':{dataPath:()=>file}})}

test('no profiles ship: a business instance starts empty',()=>{
 const {businessCatalog,reconcileProfiles}=load('lib/server/business-profiles.ts',{'@/lib/types':{botChatId:id=>'bot:'+id,workspaceOf:b=>b.workspaceId??'ws_main'},'./instance':{dataPath:()=>path.join(os.tmpdir(),'bops-no-current-catalog.json')}});
 assert.equal(businessCatalog().length,0);const state={workspace:'main',bots:[{id:'lead',isMain:true}],chats:[],messages:[]};reconcileProfiles(state,'team-a');assert.equal(state.bots.length,1);
});
test('imported profiles reconcile once, keeping edited roles, IDs and history',t=>{
 const {reconcileProfiles}=profilesModule(t);
 const state={workspace:'main',bots:[{id:'writer',catalogId:'writer',name:'My Writer',role:'Keep my edited role',instructions:'Keep edited instructions',isMain:false}],chats:[{id:'bot:writer',kind:'bot',botIds:['writer']}],messages:[{chatId:'bot:writer',text:'keep history'}]};
 reconcileProfiles(state,'team-a');const writer=state.bots.find(b=>b.id==='writer');assert.equal(writer.name,'My Writer');assert.equal(writer.role,'Keep my edited role');assert.equal(writer.instructions,'Keep edited instructions');assert.equal(state.bots.length,3);
 assert.equal(state.bots.find(b=>b.id==='researcher').role,'Research accounts.');assert.equal(state.bots.find(b=>b.id==='writer').screenMode,'none');
 reconcileProfiles(state,'team-a');assert.equal(state.bots.length,3);assert.equal(state.chats.filter(c=>c.id==='bot:writer').length,1);assert.equal(state.messages[0].text,'keep history');
 const other={workspace:'main',bots:[],chats:[],messages:[]};reconcileProfiles(other,'team-b');assert.deepEqual(other.bots.map(b=>b.id).sort(),['head-of-operations','writer']);
});
test('invalid imported profiles are refused',t=>{
 const {businessCatalog}=profilesModule(t,[{id:'Bad Id',name:'x',instructions:'x',instances:[],sources:[]}]);assert.throws(()=>businessCatalog(),/Invalid business profiles/);
});
test('four atomic leases span separate instances and headless work does not require one',t=>{
 const root=scratch(t);const moduleFor=instance=>load('lib/server/screen-capacity.ts',{'./instance':{registryPath:()=>path.join(root,'instances.json'),instanceId:()=>instance}});
 const a=moduleFor('team-a'),b=moduleFor('team-b');assert.equal(a.claimScreen('a'),0);assert.equal(b.claimScreen('b'),1);assert.equal(a.claimScreen('c'),2);assert.equal(b.claimScreen('d'),3);assert.equal(a.claimScreen('e'),null);assert.equal(b.claimScreen('e'),null);
 assert.equal(a.claimScreen('a'),0);b.releaseScreen('a');assert.equal(a.capacity().used,4);a.releaseScreen('a');assert.equal(b.claimScreen('e'),0);assert.equal(a.capacity().used,4);
});
test('queued screen workers leave capacity for a headless task',async()=>{
 const source=ts.createSourceFile('sessions.ts',fs.readFileSync('lib/server/sessions.ts','utf8'),ts.ScriptTarget.Latest,true);
 const pump=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='pump');assert.ok(pump);
 const sessions=Array.from({length:4},(_,i)=>({id:'screen'+i,botId:'bot',status:'queued',runtime:'hermes',taskMode:'screen'}));sessions.push({id:'research',botId:'bot',status:'queued',runtime:'hermes',taskMode:'headless'});
 const started=[],context={AbortController,MAX_SCREENS:4,businessRunning:new Set(),pumping:false,stopped:new Set(),notBefore:new Map(),interrupts:new Map(),getState:()=>({sessions}),session:id=>sessions.find(s=>s.id===id),bot:()=>({id:'bot'}),runBusinessSession:id=>{started.push(id);return new Promise(()=>{})}};
 vm.runInNewContext(ts.transpileModule(pump.getText(source)+'\nthis.invoke=pump;', {compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText,context);await context.invoke();assert.deepEqual(started,['screen0','screen1','screen2','screen3','research']);
});

test('hiding a profile preserves its data and protects the team lead', async () => {
 const writer={id:'writer',isMain:false,name:'Writer',model:'x-ai/grok-4.7'},lead={id:'lead',isMain:true};
 const state={bots:[lead,writer],messages:[{text:'Saved conversation'}],sessions:[{id:'saved'}]};
 const route=load('app/api/bots/route.ts',{'@/lib/server/bots':{},'@/lib/server/remove':{},'@/lib/types':{workspaceOf:b=>b?.workspaceId??'ws_main'},'@/lib/server/store':{bot:id=>state.bots.find(b=>b.id===id),getState:()=>state,update:fn=>fn(state)}},{Response});
 const request=body=>({json:async()=>body});
 assert.equal((await route.PATCH(request({botId:'writer',hidden:true}))).status,200);
 assert.equal(writer.hidden,true);assert.equal(writer.model,'x-ai/grok-4.7');assert.equal(state.messages[0].text,'Saved conversation');assert.equal(state.sessions.length,1);
 assert.equal((await route.PATCH(request({botId:'writer',hidden:false}))).status,200);assert.equal(writer.hidden,false);
 assert.equal((await route.PATCH(request({botId:'lead',hidden:true}))).status,400);assert.equal(lead.hidden,undefined);
 assert.equal((await route.PATCH(request({botId:'writer',hidden:'yes'}))).status,400);
});

test('removed catalog profiles stay removed after reconciliation; borrowed computers and remaining history survive', async t => {
 const profile=profiles[1];
 const lead={id:'lead',isMain:true,name:'Lead'},b={id:'writer',name:'Writer',isMain:false,catalogId:profile.id,computerId:'borrowed',externalComputer:true};
 const state={workspace:'main',bots:[lead,b],chats:[{id:'bot:lead',kind:'bot',botIds:['lead'],typing:[]},{id:'bot:writer',kind:'bot',botIds:['writer'],typing:[]}],messages:[{chatId:'bot:lead',text:'Keep this'},{chatId:'bot:writer',text:'Remove this'}],sessions:[],routines:[{botId:'writer'}],screens:{}};
 let resetCalls=0;
 const remove=load('lib/server/remove.ts',{'@/lib/types':{botChatId:id=>'bot:'+id,live:()=>false,workspaceOf:()=> 'main'},'./sessions':{dropGuestKey:async()=>{},resetComputer:async()=>{resetCalls++;},stopSession:()=>{}},'./store':{bot:id=>state.bots.find(b=>b.id===id),getState:()=>state,update:fn=>fn(state)},'./watches':{},'./mail':{deleteInboxes:async()=>{}},'./custom-tools':{deleteAgentTools:()=>{}}},{process:{env:{}}});
 await assert.rejects(remove.deleteBot('lead'),/can't be deleted/);
 await remove.deleteBot('writer');assert.equal(resetCalls,0);assert.equal(state.bots.length,1);assert.equal(state.messages.length,1);assert.equal(state.messages[0].text,'Keep this');assert.equal(state.routines.length,0);assert.equal(state.removedProfiles[0],profile.id);
 const {reconcileProfiles}=profilesModule(t);
 reconcileProfiles(state,'team-a');reconcileProfiles(state,'team-a');assert.ok(!state.bots.some(b=>b.catalogId===profile.id));assert.ok(!state.chats.some(c=>c.id==='bot:writer'));
 const visible=state.bots.find(b=>!b.isMain);visible.hidden=true;reconcileProfiles(state,'team-a');assert.equal(state.bots.find(b=>b.id===visible.id).hidden,true);
});

test('imported Head of Ops gains orchestration without overriding user roles, visibility or a configured lead', t => {
 const {reconcileProfiles}=profilesModule(t);
 const identity=profiles.find(p=>p.name==='Head of operations');
 for(const instance of ['team-a','team-b']) {
  const state={workspace:'ws_main',bots:[{id:'existing-head',catalogId:identity.id,name:'My Chief of Staff',role:'Keep role',instructions:'Keep charter',model:'keep/model'}],chats:[],messages:[]};
  reconcileProfiles(state,instance);const head=state.bots.find(b=>b.id==='existing-head');
  assert.equal(head.teamRole,'operations');assert.equal(head.name,'My Chief of Staff');assert.equal(head.role,'Keep role');assert.equal(head.instructions,'Keep charter');assert.equal(head.model,'keep/model');
  head.teamRole='specialist';reconcileProfiles(state,instance);assert.equal(head.teamRole,'specialist');
 }
 for(const edited of [{hidden:true},{teamRole:'specialist'}]) {
  const state={workspace:'ws_main',bots:[{id:identity.id,name:identity.name,...edited}],chats:[],messages:[]};reconcileProfiles(state,'team-a');assert.equal(state.bots[0].teamRole,edited.teamRole);assert.equal(state.bots[0].hidden,edited.hidden);
 }
 const state={workspace:'ws_main',bots:[{id:'my-ops',teamRole:'operations',name:'Custom Ops'}],chats:[],messages:[]};reconcileProfiles(state,'team-a');assert.equal(state.bots.filter(b=>b.teamRole==='operations').length,1);assert.equal(state.bots.find(b=>b.id===identity.id).teamRole,undefined);
});
