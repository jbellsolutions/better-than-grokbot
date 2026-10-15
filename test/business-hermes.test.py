"""Exercise the actual bridge's locking, idempotency, file and credential boundaries without inference."""
import importlib.util,json,pathlib,tempfile,unittest,types
from unittest.mock import patch,MagicMock
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'vm/business-hermes.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class BridgeTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.original=bridge.ROOT;bridge.ROOT=pathlib.Path(self.temp.name);bridge.ROOT.mkdir(exist_ok=True)
 def tearDown(self): bridge.ROOT=self.original;self.temp.cleanup()
 def test_four_screens_and_release(self):
  leases=[bridge.screen_slot() for _ in range(4)];self.assertEqual([slot for slot,_ in leases],[0,1,2,3]);self.assertEqual(bridge.screen_slot(),(None,None));leases[0][1].close();slot,handle=bridge.screen_slot();self.assertEqual(slot,0);handle.close()
  for _,handle in leases[1:]:handle.close()
 def test_repeated_screenshots_show_current_pixels_without_stale_or_leftover_files(self):
  job=bridge.ROOT/'jobs/capture';job.mkdir(parents=True)
  paths=[]
  def capture(command,**kw):
   image=pathlib.Path(command[-1]);self.assertFalse(image.exists());paths.append(image)
   image.write_bytes(b'first pixels' if len(paths)==1 else b'updated pixels')
   self.assertEqual(kw['env']['DISPLAY'],':120')
  with patch.object(bridge.subprocess,'run',side_effect=capture):
   first=bridge.capture_screen(job,{'DISPLAY':':120'});second=bridge.capture_screen(job,{'DISPLAY':':120'})
  self.assertEqual(bridge.base64.b64decode(first),b'first pixels');self.assertEqual(bridge.base64.b64decode(second),b'updated pixels')
  self.assertNotEqual(paths[0],paths[1]);self.assertEqual(list(job.iterdir()),[])
  bridge.atomic(job/'state.json',{'status':'done','screen':0})
  with patch.object(bridge.subprocess,'run') as run:
   self.assertIn('error',bridge.command({'action':'snapshot','turn':'capture'}));run.assert_not_called()
 def test_screen_allocation_skips_foreign_displays_without_taking_them_over(self):
  real_exists=pathlib.Path.exists
  with patch.object(pathlib.Path,'exists',lambda p: str(p) in ('/tmp/.X11-unix/X120','/tmp/.X121-lock') or real_exists(p)):
   slot,handle=bridge.screen_slot();self.assertEqual(slot,2);handle.close()
  slot,handle=bridge.screen_slot();self.assertEqual(slot,0);handle.close()
 def test_screen_actions_require_and_deliver_their_actual_arguments(self):
  calls=[]
  tools={name:(props,required,handler) for name,_,props,required,handler in bridge.screen_tools(lambda args,**kw:calls.append(args))}
  for action,args in [('screenshot',{}),('navigate',{'url':'https://example.com'}),('click',{'x':200,'y':300}),('type',{'text':'hello'}),('key',{'key':'Return'})]:
   props,required,handler=tools['bops_screen_'+action]
   self.assertEqual(set(props),set(required));handler(args);self.assertEqual(calls[-1],{**args,'action':action})
 def test_sdk_bootstrap_happens_before_any_private_screen_is_allocated(self):
  job=bridge.ROOT/'jobs/bootstrap';bridge.atomic(job/'state.json',{'status':'queued'})
  bridge.atomic(job/'request.json',{'mode':'screen','session':'bootstrap'})
  with patch.object(bridge,'hermes_sdk',side_effect=RuntimeError('SDK bootstrap interrupted')),patch.object(bridge,'screen_slot') as allocate,patch.object(bridge.subprocess,'Popen') as spawn:
   bridge.worker('bootstrap');allocate.assert_not_called();spawn.assert_not_called()
  self.assertTrue(bridge.load(job/'state.json')['cleanupConfirmed']);self.assertFalse((job/'request.json').exists())
 def test_private_browser_bypasses_shared_desktop_path_wrapper(self):
  with patch.object(pathlib.Path,'is_file',lambda p:str(p) in ('/usr/bin/google-chrome','/usr/local/bin/google-chrome')):
   self.assertEqual(bridge.browser_executable(),'/usr/bin/google-chrome')
  with patch.object(pathlib.Path,'is_file',lambda p:str(p)=='/usr/local/bin/google-chrome'):
   with self.assertRaises(RuntimeError):bridge.browser_executable()
 def test_actual_public_fetch_records_evidence_separate_from_the_model_answer(self):
  job=bridge.ROOT/'jobs/public-read';bridge.atomic(job/'state.json',{'status':'done'})
  handlers={}
  registry=types.SimpleNamespace(register=lambda **kw:handlers.__setitem__(kw['name'],kw['handler']))
  class Agent:
   def __init__(self,**kw):pass
   def run_conversation(self,*a,**kw):
    handlers['bops_read_url']({'url':'https://example.com'})
    return {'completed':True,'final_response':'A separate model answer'}
  request={'session':'public-read','mode':'headless','model':'fixture','apiKey':'fixture','instructions':'Read only','input':'Read page','turn':'public-read'}
  with patch.object(bridge,'validate_url'),patch.object(bridge.urllib.request,'build_opener') as opener:
   response=opener.return_value.open.return_value.__enter__.return_value
   response.read.return_value=b'<title>Example Domain</title><p>Actual fetched text</p>';response.geturl.return_value='https://example.com/'
   bridge.run_agent(job,request,(Agent,registry,types.SimpleNamespace(TOOLSETS={})))
  reads=bridge.status(job)['publicReads'];self.assertEqual(len(reads),1)
  self.assertEqual(reads[0]['url'],'https://example.com/');self.assertIn('Actual fetched text',reads[0]['text'])
  self.assertNotIn('separate model answer',reads[0]['text'])
 def test_orchestrator_lifecycle_tools_use_the_durable_coordinator_mailbox(self):
  job=bridge.ROOT/'jobs/ops';bridge.atomic(job/'state.json',{'status':'running'})
  handlers={};registry=types.SimpleNamespace(register=lambda **kw:handlers.__setitem__(kw['name'],kw['handler']))
  names=['list_agents','create_bot','delete_bot','run_on_mac']
  class Agent:
   def __init__(self,**kw):pass
   def run_conversation(self,*a,**kw):
    for name in names:
     self_result=handlers[name]({'name':'Nova'});assert self_result=='coordinator receipt'
    return {'completed':True,'final_response':'Managed the team.'}
  request={'session':'ops','mode':'headless','model':'fixture','apiKey':'fixture','instructions':'Manage the team','input':'Create and remove a specialist','turn':'ops','tools':[{'name':name,'description':name,'parameters':{'properties':{},'required':[]}} for name in names]}
  real_atomic=bridge.atomic
  def atomic(path,value):
   real_atomic(path,value)
   if path.parent.name=='tool-calls':real_atomic(job/'tool-results'/path.name,{'output':'coordinator receipt'})
  with patch.object(bridge,'atomic',side_effect=atomic):bridge.run_agent(job,request,(Agent,registry,types.SimpleNamespace(TOOLSETS={})))
  self.assertEqual({bridge.load(file)['name'] for file in (job/'tool-calls').glob('*.json')},set(names))
  self.assertEqual(bridge.status(job)['toolCalls'],[])
 def test_browser_uses_short_owned_scratch_and_cleans_it_after_the_task(self):
  job=bridge.ROOT/'jobs/screen';bridge.atomic(job/'state.json',{'status':'queued'})
  bridge.atomic(job/'request.json',{'mode':'screen','session':'screen'});bridge.atomic(job/'answer.json',{'answer':'Visible page'})
  real_exists=pathlib.Path.exists;socket_checks=0
  def exists(p):
   nonlocal socket_checks
   if str(p)=='/tmp/.X11-unix/X120':socket_checks+=1;return socket_checks==2
   return real_exists(p)
  with patch.object(bridge,'hermes_sdk',return_value=()),patch.object(bridge,'run_agent'),patch.object(bridge,'screen_slot',return_value=(0,MagicMock())),patch.object(bridge,'browser_executable',return_value='/usr/bin/google-chrome'),patch.object(pathlib.Path,'exists',exists),patch.object(bridge.subprocess,'Popen') as spawn,patch.object(bridge.subprocess,'run',return_value=types.SimpleNamespace(stdout='123\n')),patch.dict(bridge.os.environ,{'TMPDIR':'/very/long/hermes/cache/scratch'}):
   bridge.worker('screen')
   browser_env=spawn.call_args_list[1].kwargs['env'];scratch=browser_env['TMPDIR']
   self.assertTrue(scratch.startswith('/tmp/bops-screen-'));self.assertLess(len(scratch),40)
   self.assertFalse(real_exists(pathlib.Path(scratch)));self.assertEqual(browser_env['DISPLAY'],':120')
  self.assertEqual(bridge.load(job/'state.json')['status'],'done')
 def test_history_home_follows_sdk_layout_not_instance_name(self):
  with patch.object(pathlib.Path,'is_file',return_value=True):self.assertEqual(bridge.installed_home(),pathlib.Path('/root/.hermes'))
  with patch.object(pathlib.Path,'is_file',return_value=False):self.assertEqual(bridge.installed_home(),pathlib.Path('/home/hermes/.hermes'))
 def test_sdk_reexec_keeps_worker_identity_and_rejects_other_turns_or_code(self):
  script=str(pathlib.Path(bridge.__file__).resolve());turn='owned-turn'
  self.assertTrue(bridge.worker_argv_matches(['python',script,'worker',turn,''],turn))
  for sdk in ['/usr/local/lib/hermes-agent','/home/hermes/.hermes/hermes-agent']:
   code=f"import sys, runpy; sys.path.insert(0, {sdk!r}); sys.argv = {[script,'worker',turn]!r}; runpy.run_path({script!r}, run_name='__main__')"
   argv=['python','-I','-c',code,''];self.assertTrue(bridge.worker_argv_matches(argv,turn));self.assertFalse(bridge.worker_argv_matches(argv,'other-turn'));self.assertFalse(bridge.worker_argv_matches(['python','-I','-c',code+'; print(1)'],turn))
   prefix=f"import sys, runpy; sys.path.insert(0, {sdk!r}); sys.argv = {[script,'worker',turn]!r}; "
   nested=prefix+f"exec({code!r})"
   self.assertTrue(bridge.worker_argv_matches(['python','-I','-I','-c',nested],turn))
   self.assertFalse(bridge.worker_argv_matches(['python','-I','-I','-c',nested+'; print(1)'],turn))
   self.assertFalse(bridge.worker_argv_matches(['python','-S','-I','-c',nested],turn))
 def test_cancel_cleans_owned_worker_even_after_an_old_monitor_marked_it_failed(self):
  job=bridge.ROOT/'jobs/reexec';bridge.atomic(job/'state.json',{'status':'failed','pid':123,'cleanupConfirmed':True})
  with patch.object(bridge,'owned_worker_alive',side_effect=[True,False,False,False]),patch.object(bridge.os,'killpg') as kill:
   self.assertEqual(bridge.command({'action':'cancel','turn':'reexec'})['status'],'failed');kill.assert_called_once_with(123,bridge.signal.SIGTERM)
 def test_cancel_escalates_only_for_its_owned_worker_that_defers_sigterm(self):
  job=bridge.ROOT/'jobs/blocked';bridge.atomic(job/'state.json',{'status':'waiting','pid':123,'screen':None})
  bridge.atomic(job/'request.json',{'apiKey':'private fixture'})
  alive=True;signals=[];clock=0
  def kill(pid,sig):
   nonlocal alive
   self.assertEqual(pid,123);signals.append(sig)
   if sig==bridge.signal.SIGKILL:alive=False
  def now():
   nonlocal clock
   clock+=20;return clock
  with patch.object(bridge,'owned_worker_alive',side_effect=lambda *a:alive),patch.object(bridge.os,'killpg',side_effect=kill),patch.object(bridge.time,'time',side_effect=now):
   result=bridge.command({'action':'cancel','turn':'blocked'})
  self.assertEqual(signals,[bridge.signal.SIGTERM,bridge.signal.SIGKILL]);self.assertEqual(result['status'],'failed');self.assertTrue(result['cleanupConfirmed'])
  self.assertFalse((job/'request.json').exists())
 def test_idempotent_receipt_and_changed_input_rejected(self):
  request={'action':'submit','turn':'same','session':'thread','mode':'headless','input':'original','apiKey':'private'}
  fingerprint=bridge.hashlib.sha256(json.dumps({k:v for k,v in request.items() if k!='apiKey'},sort_keys=True).encode()).hexdigest();bridge.atomic(bridge.ROOT/'jobs/same/receipt.json',{'fingerprint':fingerprint});bridge.atomic(bridge.ROOT/'jobs/same/state.json',{'status':'done','answer':'saved'})
  self.assertEqual(bridge.command(request)['answer'],'saved');request['input']='changed'
  with self.assertRaises(ValueError):bridge.command(request)
 def test_lost_worker_fails_without_replay(self):
  bridge.atomic(bridge.ROOT/'jobs/lost/state.json',{'status':'running','pid':99999999});self.assertEqual(bridge.command({'action':'status','turn':'lost'})['status'],'failed')
 def test_identity_and_private_url_boundaries(self):
  for turn in ['../other','a;echo secret','']:
   with self.assertRaises(ValueError):bridge.command({'action':'status','turn':turn})
  for url in ['http://example.com','https://127.0.0.1','https://localhost','https://user:secret@example.com']:
   with self.assertRaises(ValueError):bridge.validate_url(url)
 def test_file_traversal_and_credential_paths_refused(self):
  for path in ['../../etc/passwd','.env','credentials.json','hermes/config/token.json']:
   with self.assertRaises(ValueError):bridge.files({'root':'artifacts','path':path})
 def test_tool_calls_have_durable_idempotent_replies(self):
  job=bridge.ROOT/'jobs/tool-turn'
  bridge.atomic(job/'state.json',{'status':'done'})
  bridge.atomic(job/'tool-calls/call1.json',{'id':'call1','name':'custom_records','arguments':{'record':'one'}})
  self.assertEqual(bridge.command({'action':'status','turn':'tool-turn'})['toolCalls'][0]['id'],'call1')
  result={'action':'tool_result','turn':'tool-turn','callId':'call1','output':'record result'}
  self.assertTrue(bridge.command(result)['accepted']);self.assertTrue(bridge.command(result)['accepted'])
  self.assertEqual(bridge.command({'action':'status','turn':'tool-turn'})['toolCalls'],[])
  with self.assertRaises(ValueError): bridge.command({**result,'output':'changed result'})
  with self.assertRaises(ValueError): bridge.command({**result,'callId':'../../escape'})
  with self.assertRaises(ValueError): bridge.command({**result,'callId':'missing'})
 def test_human_handoff_retains_screen_resumes_once_and_rejects_stale_input(self):
  import threading,time
  job=bridge.ROOT/'jobs/help';bridge.atomic(job/'state.json',{'status':'running','screen':0,'pid':123})
  answers=[]
  thread=threading.Thread(target=lambda:answers.append(bridge.wait_for_human(job,{'kind':'sign_in','message':'Sign in on this screen.'})))
  thread.start();deadline=time.time()+2
  while bridge.load(job/'state.json')['status']!='waiting' and time.time()<deadline:time.sleep(.01)
  help_id=bridge.load(job/'state.json')['human']['id']
  request={'action':'input','turn':'help','helpId':help_id,'input':{'action':'type','text':'private fixture text'}}
  try:
   with patch.object(bridge,'owned_worker_alive',return_value=True),patch.object(bridge.subprocess,'run') as run:
    bridge.command(request);self.assertEqual(run.call_args.kwargs['env']['DISPLAY'],':120')
    with self.assertRaises(ValueError):bridge.command({**request,'helpId':'stale'})
    with self.assertRaises(ValueError):bridge.command({**request,'input':{'action':'click','x':1280,'y':10}})
    for _ in range(2):self.assertTrue(bridge.command({'action':'resume','turn':'help','helpId':help_id})['accepted'])
  finally:
   bridge.atomic(job/'human-results'/(help_id+'.json'),{'completed':True});thread.join(timeout=2)
  self.assertFalse(thread.is_alive());self.assertEqual(bridge.load(job/'state.json')['status'],'running');self.assertEqual(bridge.load(job/'state.json')['screen'],0)
  self.assertIn('verify the current screen',json.loads(answers[0])['instruction'])
  self.assertNotIn('private fixture text',''.join(p.read_text() for p in job.rglob('*.json')))
  with patch.object(bridge,'owned_worker_alive',return_value=True):
   with self.assertRaises(ValueError):bridge.command(request)
 def test_parallel_human_requests_share_one_card_and_one_resume(self):
  import threading,time
  job=bridge.ROOT/'jobs/parallel-help';bridge.atomic(job/'state.json',{'status':'running','screen':0,'pid':123})
  answers=[];threads=[];second_waiting=threading.Event();real_load=bridge.load
  def load(path,*args):
   value=real_load(path,*args)
   if threading.current_thread().name=='second-help' and path==job/'state.json' and value.get('status')=='waiting':second_waiting.set()
   return value
  mocked_load=patch.object(bridge,'load',side_effect=load);mocked_load.start()
  try:
   for message in ['First request','Parallel request']:
    thread=threading.Thread(name='first-help' if not threads else 'second-help',target=lambda m=message:answers.append(bridge.wait_for_human(job,{'kind':'sign_in','message':m})));threads.append(thread);thread.start()
    deadline=time.time()+2
    while bridge.load(job/'state.json')['status']!='waiting' and time.time()<deadline:time.sleep(.01)
    current=bridge.load(job/'state.json')['human']['id']
    if len(threads)==1:help_id=current
    else:
     self.assertTrue(second_waiting.wait(timeout=2));self.assertEqual(bridge.load(job/'state.json')['human']['id'],help_id)
   with patch.object(bridge,'owned_worker_alive',return_value=True):
    self.assertTrue(bridge.command({'action':'resume','turn':'parallel-help','helpId':help_id})['accepted'])
  finally:
   bridge.atomic(job/'human-results'/(help_id+'.json'),{'completed':True})
   for thread in threads:thread.join(timeout=2)
   mocked_load.stop()
  self.assertTrue(all(not t.is_alive() for t in threads));self.assertEqual(len(answers),2)
  self.assertEqual(bridge.load(job/'state.json')['status'],'running')
 def test_human_help_requires_a_private_screen_and_cannot_approve_payments(self):
  job=bridge.ROOT/'jobs/headless';bridge.atomic(job/'state.json',{'status':'running','screen':None})
  for args in [{'kind':'sign_in','message':'Sign in'},{'kind':'payment','message':'Pay'},{'kind':'error','message':''}]:
   with self.assertRaises(ValueError):bridge.wait_for_human(job,args)
 def test_a_lost_waiting_worker_fails_without_replaying_or_resuming(self):
  job=bridge.ROOT/'jobs/lost-help';bridge.atomic(job/'state.json',{'status':'waiting','pid':99999999,'screen':None,'human':{'id':'help','kind':'sign_in'}})
  self.assertEqual(bridge.command({'action':'status','turn':'lost-help'})['status'],'failed')
  with self.assertRaises(ValueError):bridge.command({'action':'resume','turn':'lost-help','helpId':'help'})
if __name__=='__main__':unittest.main()
