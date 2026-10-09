const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {importArchive,contactRows,ownership}=require('../scripts/import-business.cjs');const catalog=require('../lib/business-profiles.json');
function load(file,modules,extras={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports,require:n=>n==='server-only'?{}:n in modules?modules[n]:require(n),...extras});return exports}
function scratch(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-business-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
test('all 32 source seats reconcile into 22 spec profiles with independent shared roles',()=>{
 assert.equal(catalog.length,22);assert.equal(catalog.filter(p=>p.instances.includes('ai-guy')).length,17);assert.equal(catalog.filter(p=>p.instances.includes('revenue-partners')).length,14);
 const sources=catalog.flatMap(p=>p.sources.map(s=>s.id));assert.equal(new Set(sources).size,29);assert.ok(!catalog.some(p=>['none','deferred'].includes(p.id)));assert.equal(catalog.find(p=>p.id==='email-writer').screen,'none');
 const {reconcileProfiles}=load('lib/server/business-profiles.ts',{'@/lib/business-profiles.json':catalog,'@/lib/grokbot-current-profiles.json':catalog,'@/lib/types':{botChatId:id=>'bot:'+id},'./instance':{dataPath:()=>'/tmp/bops-no-current-catalog.json'}});
 const state={workspace:'main',bots:[{id:'writer',name:'My Writer',role:'Keep my edited role',isMain:false}],chats:[],messages:[{text:'keep history'}]};reconcileProfiles(state,'ai-guy');const writer=state.bots.find(b=>b.id==='writer');assert.equal(writer.role,'Keep my edited role');assert.equal(writer.catalogId,'email-writer');assert.equal(state.bots.length,17);reconcileProfiles(state,'ai-guy');assert.equal(state.bots.length,17);assert.equal(state.messages[0].text,'keep history');
});
test('four atomic leases span separate instances and headless work does not require one',t=>{
 const root=scratch(t);const moduleFor=instance=>load('lib/server/screen-capacity.ts',{'./instance':{registryPath:()=>path.join(root,'instances.json'),instanceId:()=>instance}});
 const ai=moduleFor('ai-guy'),rev=moduleFor('revenue-partners');assert.equal(ai.claimScreen('a'),0);assert.equal(rev.claimScreen('b'),1);assert.equal(ai.claimScreen('c'),2);assert.equal(rev.claimScreen('d'),3);assert.equal(ai.claimScreen('e'),null);assert.equal(rev.claimScreen('e'),null);
 assert.equal(ai.claimScreen('a'),0);rev.releaseScreen('a');assert.equal(ai.capacity().used,4);ai.releaseScreen('a');assert.equal(rev.claimScreen('e'),0);assert.equal(ai.capacity().used,4);
});
test('archive reruns preserve contact suppression, provenance, manual records and unresolved ownership',t=>{
 const root=scratch(t),archive=path.join(root,'archive');const file=path.join(archive,'recovered/workspace/ai-guy/leads.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'| Name | Email | Company | Status |\n|---|---|---|---|\n| Ada | ADA@example.com | Example | unsubscribed |\n');const unknown=path.join(archive,'recovered/workspace/unknown.md');fs.writeFileSync(unknown,'Unknown business');
 const first=importArchive(archive,root);const second=importArchive(archive,root);assert.equal(first[0].counts.contacts,1);assert.equal(second[0].counts.contacts,1);assert.equal(second[0].counts.documents,1);assert.equal(second[1].counts.contacts,0);const c=JSON.parse(fs.readFileSync(path.join(root,'.data/instances/ai-guy/business/contacts.json')))[0];assert.equal(c.suppressed,true);assert.equal(c.email,'ada@example.com');assert.equal(c.sources.length,1);assert.equal(first[0].excluded,1);
 assert.equal(ownership('recovered/workspace/lead-radar/leads.md'),'revenue-partners');assert.equal(contactRows('A random address human@example.com in a note','note.md').length,0);
});
test('queued screen workers leave capacity for a headless task',async()=>{
 const source=ts.createSourceFile('sessions.ts',fs.readFileSync('lib/server/sessions.ts','utf8'),ts.ScriptTarget.Latest,true);
 const pump=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='pump');assert.ok(pump);
 const sessions=Array.from({length:4},(_,i)=>({id:'screen'+i,botId:'bot',status:'queued',runtime:'hermes',taskMode:'screen'}));sessions.push({id:'research',botId:'bot',status:'queued',runtime:'hermes',taskMode:'headless'});
 const started=[],context={AbortController,MAX_SCREENS:4,businessRunning:new Set(),pumping:false,stopped:new Set(),notBefore:new Map(),interrupts:new Map(),getState:()=>({sessions}),session:id=>sessions.find(s=>s.id===id),bot:()=>({id:'bot'}),runBusinessSession:id=>{started.push(id);return new Promise(()=>{})}};
 vm.runInNewContext(ts.transpileModule(pump.getText(source)+'\nthis.invoke=pump;', {compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText,context);await context.invoke();assert.deepEqual(started,['screen0','screen1','screen2','screen3','research']);
});
test('recent import preserves the full source window and keeps routines as records',t=>{
 const {importRecent,redact}=require('../scripts/import-grok-recent.cjs');const root=scratch(t),source=path.join(root,'snapshot');fs.mkdirSync(source);const id='11111111-1111-4111-8111-111111111111';
 fs.writeFileSync(path.join(source,'roster.json'),JSON.stringify({complete:true,agents:[{id,name:'Current Agent',isGroup:false}]}));
 fs.writeFileSync(path.join(source,id+'.json'),JSON.stringify({id,name:'Current Agent',isGroup:false,covered:true,cutoff:Date.now()-172800000,observedAt:Date.now(),entries:[{id:'m1',kind:'message',role:'user',content:'Current task',timestampMs:Date.now()}]}));
 fs.writeFileSync(path.join(source,'routines.json'),JSON.stringify({status:'ready',value:[{agentId:id,automation:{name:'Current routine',prompt:'Keep original prompt',isEnabled:true,createdAt:Date.now(),triggerDescription:'Weekdays'}}]}));
 const result=importRecent(source,root);assert.equal(result.bots,1);assert.equal(result.enabledSourceRoutines,1);importRecent(source,root);
 const business=path.join(root,'.data/instances/revenue-partners/business');const review=JSON.parse(fs.readFileSync(path.join(business,'recent-review.json')));assert.equal(review.records.length,2);assert.match(fs.readFileSync(path.join(business,'recent/routines.txt'),'utf8'),/NOT scheduled in Bops/);assert.match(fs.readFileSync(path.join(business,'recent',id+'.txt'),'utf8'),/Current task/);
 assert.equal(redact('api_key=abcdefghijklmnopqrstuvwxyz01234'),'api_key=[REDACTED]');assert.equal(redact('sk-or-v1-abcdefghijklmnopqrstuvwxyz01234'),'[REDACTED]');
 const incomplete=JSON.parse(fs.readFileSync(path.join(source,id+'.json')));incomplete.covered=false;fs.writeFileSync(path.join(source,id+'.json'),JSON.stringify(incomplete));assert.throws(()=>importRecent(source,root),/not fully covered/);
});
test('current source roles reconcile without losing existing IDs, profile edits or history',()=>{
 const current=require('../lib/grokbot-current-profiles.json');assert.equal(current.length,30);assert.equal(new Set(current.map(p=>p.sources[0].id)).size,30);assert.ok(current.every(p=>p.instances.includes('ai-guy')&&p.instances.includes('revenue-partners')));
 const {reconcileProfiles}=load('lib/server/business-profiles.ts',{'@/lib/business-profiles.json':catalog,'@/lib/grokbot-current-profiles.json':current,'@/lib/types':{botChatId:id=>'bot:'+id},'./instance':{dataPath:()=>'/tmp/bops-no-current-catalog.json'}});
 const state={workspace:'main',bots:[{id:'writer',catalogId:'email-writer',name:'My Writer',role:'My role',instructions:'Keep edited instructions',isMain:false}],chats:[{id:'bot:writer',kind:'bot',botIds:['writer']}],messages:[{id:'saved',chatId:'bot:writer',text:'Saved conversation'}]};
 reconcileProfiles(state,'ai-guy');assert.equal(state.bots.length,30);assert.equal(state.bots.find(b=>b.id==='writer').name,'My Writer');assert.equal(state.bots.find(b=>b.id==='writer').instructions,'Keep edited instructions');assert.match(state.bots.find(b=>b.id==='writer').catalogId,/^grok-/);assert.equal(state.messages[0].text,'Saved conversation');reconcileProfiles(state,'ai-guy');assert.equal(state.bots.length,30);assert.equal(state.chats.filter(c=>c.id==='bot:writer').length,1);
});
test('recovery handoff preserves existing IDs and survives a fresh source import without executing profiles',async t=>{
 const {importRecent}=require('../scripts/import-grok-recent.cjs');const {importHandoff}=require('../scripts/import-live-handoff.cjs');const root=scratch(t),source=path.join(root,'snapshot'),handoff=path.join(root,'handoff');fs.mkdirSync(source);fs.mkdirSync(path.join(handoff,'threads'),{recursive:true});const id='11111111-1111-4111-8111-111111111111';
 fs.writeFileSync(path.join(source,'roster.json'),JSON.stringify({complete:true,agents:[{id,name:'Current Agent',isGroup:false}]}));fs.writeFileSync(path.join(source,id+'.json'),JSON.stringify({covered:true,cutoff:Date.now()-172800000,observedAt:Date.now(),entries:[]}));fs.writeFileSync(path.join(source,'routines.json'),JSON.stringify({status:'ready',value:[]}));importRecent(source,root);
 fs.writeFileSync(path.join(handoff,'README.md'),'Recovery limits: reported state only.');fs.writeFileSync(path.join(handoff,'agent-charters.md'),[1,2,3,4].map(i=>`## ${i}. Charter ${i}\nRead-only verification required.\n`).join('\n'));for(let i=0;i<24;i++)fs.writeFileSync(path.join(handoff,'threads',i+'.md'),'Source readback');
 let result=await importHandoff(handoff,root);assert.equal(result.profilesUpdated,false);assert.equal(result.readbacks,24);await importHandoff(handoff,root);importRecent(source,root);
 for(const instance of ['ai-guy','revenue-partners']){const dir=path.join(root,'.data/instances',instance,'business');const review=JSON.parse(fs.readFileSync(path.join(dir,'recent-review.json')));assert.equal(review.records.filter(r=>r.sourceKind==='handoff').length,26);assert.equal(review.records.length,28);const rec=JSON.parse(fs.readFileSync(path.join(dir,'reconciliation.json')));assert.deepEqual(rec.newsletters.map(n=>[n.campaign,n.list]),[[71,41],[72,42],[73,43]]);assert.deepEqual(rec.excludedScope,['Beehiiv']);assert.equal(rec.charters.length,4);assert.match(rec.limitations,/not been independently verified/);}
});


test('hiding a profile preserves its data and protects the team lead', async () => {
 const writer={id:'writer',isMain:false,name:'Writer',model:'x-ai/grok-4.7'},lead={id:'lead',isMain:true};
 const state={bots:[lead,writer],messages:[{text:'Saved conversation'}],sessions:[{id:'saved'}]};
 const route=load('app/api/bots/route.ts',{'@/lib/server/bots':{},'@/lib/server/remove':{},'@/lib/server/store':{bot:id=>state.bots.find(b=>b.id===id),update:fn=>fn(state)}},{Response});
 const request=body=>({json:async()=>body});
 assert.equal((await route.PATCH(request({botId:'writer',hidden:true}))).status,200);
 assert.equal(writer.hidden,true);assert.equal(writer.model,'x-ai/grok-4.7');assert.equal(state.messages[0].text,'Saved conversation');assert.equal(state.sessions.length,1);
 assert.equal((await route.PATCH(request({botId:'writer',hidden:false}))).status,200);assert.equal(writer.hidden,false);
 assert.equal((await route.PATCH(request({botId:'lead',hidden:true}))).status,400);assert.equal(lead.hidden,undefined);
 assert.equal((await route.PATCH(request({botId:'writer',hidden:'yes'}))).status,400);
});

test('removed catalog profiles stay removed after reconciliation; borrowed computers and remaining history survive', async () => {
 const current=require('../lib/grokbot-current-profiles.json'),profile=current[1];
 const lead={id:'lead',isMain:true,name:'Lead'},b={id:'writer',name:'Writer',isMain:false,catalogId:profile.id,computerId:'borrowed',externalComputer:true};
 const state={workspace:'main',bots:[lead,b],chats:[{id:'bot:lead',kind:'bot',botIds:['lead'],typing:[]},{id:'bot:writer',kind:'bot',botIds:['writer'],typing:[]}],messages:[{chatId:'bot:lead',text:'Keep this'},{chatId:'bot:writer',text:'Remove this'}],sessions:[],routines:[{botId:'writer'}],screens:{}};
 let resetCalls=0;
 const remove=load('lib/server/remove.ts',{'@/lib/types':{botChatId:id=>'bot:'+id,live:()=>false,workspaceOf:()=> 'main'},'./sessions':{dropGuestKey:async()=>{},resetComputer:async()=>{resetCalls++;},stopSession:()=>{}},'./store':{bot:id=>state.bots.find(b=>b.id===id),getState:()=>state,update:fn=>fn(state)},'./watches':{},'./mail':{deleteInboxes:async()=>{}}},{process:{env:{}}});
 await assert.rejects(remove.deleteBot('lead'),/can't be deleted/);
 await remove.deleteBot('writer');assert.equal(resetCalls,0);assert.equal(state.bots.length,1);assert.equal(state.messages.length,1);assert.equal(state.messages[0].text,'Keep this');assert.equal(state.routines.length,0);assert.equal(state.removedProfiles[0],profile.id);
 const {reconcileProfiles}=load('lib/server/business-profiles.ts',{'@/lib/business-profiles.json':catalog,'@/lib/grokbot-current-profiles.json':current,'@/lib/types':{botChatId:id=>'bot:'+id},'./instance':{dataPath:()=>'/tmp/bops-no-current-catalog.json'}});
 reconcileProfiles(state,'ai-guy');reconcileProfiles(state,'ai-guy');assert.ok(!state.bots.some(b=>b.catalogId===profile.id));assert.ok(!state.chats.some(c=>c.id==='bot:writer'));
 const visible=state.bots.find(b=>!b.isMain);visible.hidden=true;reconcileProfiles(state,'ai-guy');assert.equal(state.bots.find(b=>b.id===visible.id).hidden,true);
});
