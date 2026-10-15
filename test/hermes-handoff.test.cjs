const {test}=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load-ts.cjs');
function fixture(){
 const task={id:'task',botId:'ops',title:'Original goal',goal:'Keep this goal',chatId:'bot:ops',runtime:'hermes',taskMode:'screen',status:'queued',hermesTurn:'owned-turn',replies:[]};
 let remote={status:'waiting',screen:0,human:{id:'help1',kind:'sign_in',message:'Please sign in.'}},resumes=0,releases=0,deliveries=0,failResume=false;
 const calls=[],messages=[];
 const store={session:()=>task,bot:()=>({id:'ops',name:'Bapi'}),id:()=> 'reply',patchSession:(_id,p)=>typeof p==='function'?p(task):Object.assign(task,p),addMessage:m=>messages.push(m)};
 const orgo={hermes:async request=>{calls.push(request);if(request.action==='resume'){resumes++;if(failResume)throw Error('Connection lost');return {accepted:true};}if(request.action==='cancel')return {status:'failed',cleanupConfirmed:true};return remote;}};
 const modules={'./store':store,'./orgo':{orgo},'./business-records':{},'./screen-capacity':{claimScreen:()=>0,releaseScreen:()=>releases++,ownedScreenTurns:()=>[]},'./business-profiles':{instructionsFor:()=>''},'./models':{modelFor:()=> 'fixture',modelReasoning:async()=>({})},'./custom-tools':{connectedTools:async()=>[]},'./team-tools':{teamTools:()=>[],deliverDelegationResult:()=>deliveries++}};
 const runtime=load('lib/server/business-runtime.ts',modules,{process:{env:{OPENROUTER_API_KEY:'fixture'}},setTimeout:(fn,ms)=>setTimeout(fn,ms===2000?1:ms)});
 return {task,store,orgo,runtime,calls,messages,remote:value=>remote=value,fail:value=>failResume=value,counts:()=>({resumes,releases,deliveries})};
}
test('a paused Hermes task keeps its turn and lease, resumes once, and finishes the original goal',async()=>{
 const f=fixture();await f.runtime.runBusinessSession('task',new AbortController().signal);
 assert.equal(f.task.blocker,'sign_in');assert.equal(f.task.hermesHelpId,'help1');assert.equal(f.task.hermesTurn,'owned-turn');assert.equal(f.task.waitingOnYou,true);assert.equal(f.counts().releases,0);assert.equal(f.counts().deliveries,0);
 assert.equal(await f.runtime.resumeHermesHandoff('task','stale'),false);
 const acknowledgments=await Promise.all([f.runtime.resumeHermesHandoff('task','help1'),f.runtime.resumeHermesHandoff('task','help1')]);
 assert.deepEqual(acknowledgments,[true,false]);assert.equal(f.counts().resumes,1);assert.equal(f.task.status,'queued');assert.equal(f.task.blocker,undefined);
 f.remote({status:'done',answer:'Verified the same screen and completed the original goal.',cleanupConfirmed:true});
 await f.runtime.runBusinessSession('task',new AbortController().signal);
 assert.equal(f.task.status,'done');assert.equal(f.task.goal,'Keep this goal');assert.equal(f.task.hermesTurn,undefined);assert.equal(f.counts().releases,1);assert.equal(f.counts().deliveries,1);
 assert.equal(f.calls.filter(r=>r.action==='submit').length,0);
});
test('an uncertain acknowledgment stays retryable; dismissed handoffs never reopen',async()=>{
 const f=fixture();await f.runtime.runBusinessSession('task',new AbortController().signal);f.fail(true);
 await assert.rejects(f.runtime.resumeHermesHandoff('task','help1'),/Connection lost/);assert.equal(f.task.hermesHelpId,'help1');assert.equal(f.task.blocker,'sign_in');
 f.fail(false);assert.equal(await f.runtime.resumeHermesHandoff('task','help1'),true);
 f.task.hermesHelpId='help2';f.task.blocker='two_factor';f.task.dismissed=true;
 assert.equal(await f.runtime.resumeHermesHandoff('task','help1'),false);assert.equal(f.counts().resumes,2);
});
test('cancelling a waiting Hermes worker releases its confirmed private screen',async()=>{
 const f=fixture();await f.runtime.runBusinessSession('task',new AbortController().signal);
 await f.runtime.cancelHermesSession('task');assert.equal(f.task.hermesTurn,undefined);assert.equal(f.task.hermesHelpId,undefined);assert.equal(f.counts().releases,1);
});
test('private screen input is bound to the current handoff and never saved as a message',async()=>{
 const f=fixture();await f.runtime.runBusinessSession('task',new AbortController().signal);
 const route=load('app/api/business/route.ts',{'@/lib/server/store':{...f.store,getState:()=>({sessions:[f.task]})},'@/lib/server/business-records':{assertBusiness:()=>{}},'@/lib/server/business-profiles':{},'@/lib/server/screen-capacity':{},'@/lib/server/instance':{},'@/lib/server/orgo':{orgo:{hermes:async request=>{assert.equal(request.turn,'owned-turn');assert.equal(request.helpId,'help1');assert.equal(request.input.text,'private test input');return {accepted:true};}}}});
 const run=helpId=>route.POST(new Request('http://localhost/business',{method:'POST',body:JSON.stringify({action:'screen-input',sessionId:'task',helpId,input:{action:'type',text:'private test input'}})}));
 assert.equal((await run('stale')).status,400);assert.equal((await run('help1')).status,200);assert.ok(f.messages.every(m=>!m.text.includes('private test input')));
 f.task.dismissed=true;assert.equal((await run('help1')).status,400);
});
test('stop all includes paused Hermes workers and respects the selected agent',async()=>{
 const stopped=[];
 const route=load('app/api/sessions/route.ts',{'@/lib/server/sessions':{stopSession:id=>stopped.push(id)},'@/lib/server/store':{getState:()=>({sessions:[{id:'paused',botId:'ops',status:'done',hermesHelpId:'help'},{id:'active',botId:'other',status:'running'},{id:'finished',botId:'ops',status:'done'}]})}});
 const request=body=>new Request('http://localhost/sessions',{method:'DELETE',body:JSON.stringify(body)});
 assert.equal((await (await route.DELETE(request({botId:'ops'}))).json()).stopped,1);assert.deepEqual(stopped,['paused']);
 stopped.length=0;assert.equal((await (await route.DELETE(request({}))).json()).stopped,2);assert.deepEqual(stopped,['paused','active']);
});
function removalFixture(confirmed){
 const task={id:'paused',botId:'specialist',status:'done',hermesHelpId:'help',hermesTurn:'owned-turn'};
 const b={id:'specialist',name:'Specialist',externalComputer:true};
 const state={bots:[b],sessions:[task],chats:[],messages:[],routines:[]};const calls=[];
 const remove=load('lib/server/remove.ts',{'./store':{bot:()=>b,session:()=>task,getState:()=>state,update:fn=>fn(state)},'./sessions':{stopSession:()=>calls.push('stop'),dropGuestKey:async()=>{},resetComputer:async()=>{}},'./business-runtime':{cancelHermesSession:async()=>{calls.push('cancel');if(confirmed)task.hermesTurn=undefined;}},'./watches':{},'./mail':{deleteInboxes:async()=>{}},'./custom-tools':{deleteAgentTools:()=>{}}});
 return {remove,state,calls};
}
test('removing a paused specialist confirms its remote cancellation before dropping ownership',async()=>{
 const f=removalFixture(true);assert.throws(()=>f.remove.deleteThread('paused'),/stop it first/);
 await f.remove.deleteBot('specialist');assert.deepEqual(f.calls,['stop','cancel']);assert.equal(f.state.bots.length,0);assert.equal(f.state.sessions.length,0);
});
test('an uncertain remote cancellation preserves the specialist and its screen identity',async()=>{
 const f=removalFixture(false);await assert.rejects(f.remove.deleteBot('specialist'),/confirmed stopped/);
 assert.equal(f.state.bots.length,1);assert.equal(f.state.sessions[0].hermesTurn,'owned-turn');
});
test('an uncertain Mac cancellation preserves the specialist and task ownership',async()=>{
 const f=removalFixture(false),task=f.state.sessions[0];delete task.hermesTurn;delete task.hermesHelpId;task.codexTurn='mac-turn';task.macPending=true;
 await assert.rejects(f.remove.deleteBot('specialist'),/Mac task is confirmed stopped/);assert.deepEqual(f.calls,['stop']);assert.equal(f.state.bots.length,1);assert.equal(task.codexTurn,'mac-turn');
});
