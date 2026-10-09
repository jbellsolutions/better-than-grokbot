const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loadInstance = require('./helpers/instance.cjs');
const code = ts.transpileModule(fs.readFileSync('lib/server/models.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bops-models-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const state={bots:[{id:'boppy'},{id:'scout'}],sessions:[],chats:[{typing:[]}]};
 const make=(id,vision=true,tools=true,reasoning=true,efforts=['low'])=>({id,name:id,architecture:{input_modalities:vision?['text','image']:['text'],output_modalities:['text']},supported_parameters:[...(tools?['tools']:[]),...(reasoning?['reasoning']:[])],reasoning:{supported_efforts:efforts},pricing:{prompt:'0.000001',completion:'0.000002'}});
 const data=[make('z-ai/glm-5.3-flash'),make('x-ai/grok-4.7'),make('text/only',false),make('no/tools',true,false),make('test/plain',true,true,false),make('test/minimal',true,true,true,['minimal','high']),make('test/model:batch')];
 let calls=0;
 const exports={}; const env={BOPS_SELF_HOSTED:'1',OPENROUTER_API_KEY:'not-a-real-secret',BOPS_CHAT_MODEL:'z-ai/glm-5.3-flash'};
 vm.runInNewContext(code,{exports,require:id=>id==='@/lib/server/instance'?loadInstance({env,cwd:()=>root}):id==='server-only'?{}:id==='./store'?{bot:id=>state.bots.find(b=>b.id===id),getState:()=>state,update:fn=>fn(state)}:require(id),process:{env,cwd:()=>root},fetch:async (_url,options)=>{calls++;assert.equal(options.headers,undefined);return Response.json({data});},AbortSignal,Date});
 return {exports,state,root,calls:()=>calls,env};
}
test('team model persists and agent overrides stay independent of computer selection',async t=>{
 const s=setup(t),m=s.exports;
 assert.equal(m.modelFor('session','scout'),'z-ai/glm-5.3-flash');
 await m.setModel('x-ai/grok-4.7');
 assert.equal(m.modelFor('chat','scout'),'x-ai/grok-4.7');
 assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'.data/models.json'))).defaultModel,'x-ai/grok-4.7');
 await m.setModel('z-ai/glm-5.3-flash','scout');s.state.bots[1].computerId='different-vm';
 assert.equal(m.modelFor('chat','scout'),'z-ai/glm-5.3-flash');assert.equal(m.modelFor('session','scout'),'z-ai/glm-5.3-flash');
 await m.setModel(null,'scout');assert.equal(m.modelFor('session','scout'),'x-ai/grok-4.7');
 assert.equal(fs.statSync(path.join(s.root,'.data/models.json')).mode & 0o777,0o600);
});
test('model selection rejects unknown/incompatible models and changes during active work',async t=>{
 const s=setup(t),m=s.exports;
 for(const id of ['unknown/model','text/only','no/tools','test/model:batch'])await assert.rejects(m.setModel(id));
 s.state.sessions=[{botId:'scout',status:'starting'}];await assert.rejects(m.setModel('x-ai/grok-4.7','scout'),/Wait until/);
 await m.setModel('x-ai/grok-4.7','boppy');
 await assert.rejects(m.setModel('x-ai/grok-4.7'),/Wait until/);
 s.state.sessions=[];s.state.chats[0].typing=['boppy'];await assert.rejects(m.setModel('z-ai/glm-5.3-flash','boppy'),/Wait until/);
 s.env.BOPS_SELF_HOSTED='0';await assert.rejects(m.setModel('x-ai/grok-4.7'),/self-hosted/);
});
test('catalog is cached without sending keys and reasoning fits selected model capabilities',async t=>{
 const s=setup(t),m=s.exports;
 await Promise.all([m.modelCatalog(),m.modelCatalog()]);assert.equal(s.calls(),1);
 assert.deepEqual(JSON.parse(JSON.stringify(await m.modelReasoning('x-ai/grok-4.7'))),{effort:'low'});
 assert.equal(await m.modelReasoning('test/plain'),undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(await m.modelReasoning('test/minimal'))),{effort:'minimal'});
});
