"""Isolated Hermes jobs. No existing profiles, displays, gateways or schedules are modified."""
import sqlite3
import base64, contextlib, fcntl, hashlib, ipaddress, json, os, pathlib, re, signal, socket, subprocess, sys, tempfile, time, urllib.request, uuid
ROOT = pathlib.Path(__file__).resolve().parent
ID = re.compile(r'^[a-zA-Z0-9_-]{1,80}$')
MAX_SCREENS = 4

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp=path.with_suffix('.tmp-'+uuid.uuid4().hex)
    temp.write_text(json.dumps(value));temp.chmod(0o600);temp.replace(path)

def load(path, fallback=None):
    try: return json.loads(path.read_text())
    except FileNotFoundError: return fallback

@contextlib.contextmanager
def lock(path, wait=True):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with path.open('a') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        yield


def pid_alive(pid):
    try: os.kill(int(pid),0);return True
    except (ProcessLookupError,ValueError,TypeError): return False


def worker_argv_matches(parts, turn):
    parts=[p for p in parts if p]
    script=str(pathlib.Path(__file__).resolve())
    if script in parts and ['worker',turn] == parts[-2:]: return True
    # Hermes bootstraps an isolated Python and re-execs this same worker using runpy.
    if not 4<=len(parts)<=7 or parts[-2]!='-c' or any(flag!='-I' for flag in parts[1:-2]): return False
    for sdk in ['/usr/local/lib/hermes-agent','/home/hermes/.hermes/hermes-agent']:
        prefix=f"import sys, runpy; sys.path.insert(0, {sdk!r}); sys.argv = {[script,'worker',turn]!r}; "
        code=prefix+f"runpy.run_path({script!r}, run_name='__main__')"
        # A second managed dependency activation wraps the prior launcher in
        # exec and preserves -I. Accept only the exact SDK-generated wrappers.
        for _ in range(4):
            if parts[-1]==code: return True
            code=prefix+f"exec({code!r})"
    return False


def owned_worker_alive(pid, turn):
    if not pid_alive(pid): return False
    try:
        argv=pathlib.Path('/proc')/str(pid)/'cmdline'
        parts=argv.read_bytes().decode().split('\0')
        return os.getpgid(int(pid))==int(pid) and worker_argv_matches(parts,turn)
    except (OSError,UnicodeError): return False


def screen_clean(state):
    return state.get('screen') is None or not pathlib.Path('/tmp/.X11-unix/X'+str(120+state['screen'])).exists()


def capture_screen(job, env=None):
    # scrot appends a number when the output exists; reading preview.png again
    # would silently return the first screenshot. Unique captures also keep
    # concurrent preview requests from reading each other's partial files.
    with tempfile.TemporaryDirectory(prefix='capture-',dir=job) as directory:
        image=pathlib.Path(directory)/'screen.png'
        subprocess.run(['scrot',str(image)],env=env or os.environ,check=True,timeout=10)
        return base64.b64encode(image.read_bytes()).decode()


def status(job):
    state=load(job/'state.json',{'status':'missing'})
    if state['status'] in ('queued','running','waiting') and not owned_worker_alive(state.get('pid'),job.name):
        state.update(status='failed',cleanupConfirmed=screen_clean(state),error='Hermes worker stopped. Review before retrying; work was not replayed.');atomic(job/'state.json',state)
    if state.get('cleanupConfirmed') is False and screen_clean(state):
        state['cleanupConfirmed']=True;atomic(job/'state.json',state)
    pending=[]
    for call in sorted((job/'tool-calls').glob('*.json')):
        if not (job/'tool-results'/call.name).exists(): pending.append(load(call))
    return {**state,'toolCalls':pending,'publicReads':[load(p) for p in sorted((job/'public-reads').glob('*.json'))]}


def command(request):
    action=request.get('action'); turn=request.get('turn','')
    if action=='history': return history(request)
    if action=='files': return files(request)
    if not ID.fullmatch(turn): raise ValueError('Invalid turn identity')
    job=ROOT/'jobs'/turn
    if action=='submit':
        if request.get('mode') not in ('headless','screen'): raise ValueError('Invalid execution mode')
        if not ID.fullmatch(request.get('session','')): raise ValueError('Invalid session identity')
        fingerprint=hashlib.sha256(json.dumps({k:v for k,v in request.items() if k!='apiKey'},sort_keys=True).encode()).hexdigest()
        with lock(ROOT/'submit.lock'):
            prior=load(job/'receipt.json')
            if prior:
                if prior['fingerprint']!=fingerprint: raise ValueError('Turn identity was reused for different work')
                return status(job)
            atomic(job/'request.json',request)
            atomic(job/'receipt.json',{'fingerprint':fingerprint})
            log=(job/'worker.log').open('ab')
            process=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'worker',turn],stdout=log,stderr=log,start_new_session=True)
            atomic(job/'state.json',{'status':'queued','pid':process.pid,'turn':turn,'mode':request['mode']})
            log.close()
        return status(job)
    if action=='status': return status(job)
    if action in ('resume','input'):
        help_id=request.get('helpId','')
        if not ID.fullmatch(help_id): raise ValueError('Invalid human handoff identity')
        with lock(job/'human.lock'):
            state=status(job);result=job/'human-results'/(help_id+'.json')
            if action=='resume' and result.is_file(): return {'accepted':True}
            if state.get('status')!='waiting' or state.get('human',{}).get('id')!=help_id: raise ValueError('This handoff is no longer waiting for you')
            if action=='resume':
                atomic(result,{'completed':True});return {'accepted':True}
            if result.is_file(): raise ValueError('The agent is resuming; input is closed')
            if state.get('screen') is None: raise ValueError('This handoff has no private screen')
            screen_input(request.get('input',{}),{**os.environ,'DISPLAY':':'+str(120+state['screen'])})
            return {'accepted':True}
    if action=='tool_result':
        call_id=request.get('callId','')
        if not ID.fullmatch(call_id) or not (job/'tool-calls'/(call_id+'.json')).is_file(): raise ValueError('Unknown tool call')
        output=request.get('output')
        if not isinstance(output,str) or len(output)>64000: raise ValueError('Invalid tool result')
        target=job/'tool-results'/(call_id+'.json')
        with lock(job/'tools.lock'):
            old=load(target)
            if old and old['output']!=output: raise ValueError('Tool result identity was reused')
            if not old: atomic(target,{'output':output})
        return {'accepted':True}
    if action=='cancel':
        with lock(ROOT/'submit.lock'):
            state=status(job)
            if state['status'] in ('queued','running','waiting') or owned_worker_alive(state.get('pid'),turn):
                # PID is our process group leader, stored only by submit.
                try: os.killpg(state['pid'],signal.SIGTERM)
                except ProcessLookupError: pass
                deadline=time.time()+10
                while owned_worker_alive(state.get('pid'),turn) and time.time()<deadline: time.sleep(.1)
                if owned_worker_alive(state.get('pid'),turn):
                    # Hermes may defer SIGTERM while a tool awaits the owner.
                    # Escalate only after rechecking our exact worker identity.
                    try: os.killpg(state['pid'],signal.SIGKILL)
                    except ProcessLookupError: pass
                    deadline=time.time()+5
                    while owned_worker_alive(state.get('pid'),turn) and time.time()<deadline: time.sleep(.1)
                state=status(job)
            if state['status'] in ('done','failed') and not owned_worker_alive(state.get('pid'),turn):
                (job/'request.json').unlink(missing_ok=True)
        return state
    if action=='snapshot':
        state=status(job)
        if state.get('screen') is None or state.get('status') not in ('running','waiting'): return {'error':'This job has no active screen'}
        return {'image':capture_screen(job,{**os.environ,'DISPLAY':':'+str(120+state['screen'])}),'contentType':'image/png'}
    raise ValueError('Unsupported bridge action')


def screen_input(args, env=None):
    action=args.get('action');options={'check':True,'timeout':10,'env':env or os.environ}
    if action=='click':
        x,y=args.get('x'),args.get('y')
        if type(x) is not int or type(y) is not int or not 0<=x<1280 or not 0<=y<900: raise ValueError('Click is outside the leased screen')
        subprocess.run(['xdotool','mousemove',str(x),str(y),'click','1'],**options)
    elif action=='type':
        text=args.get('text')
        if not isinstance(text,str) or not text or len(text)>10000: raise ValueError('Invalid screen text')
        subprocess.run(['xdotool','type','--clearmodifiers','--',text],**options)
    elif action=='key':
        key=args.get('key')
        if key not in ['Return','Tab','Escape','BackSpace','ctrl+a','ctrl+l','Page_Down','Page_Up','Down','Up']: raise ValueError('Unsupported key')
        subprocess.run(['xdotool','key','--clearmodifiers',key],**options)
    else: raise ValueError('Unsupported screen input')


def wait_for_human(job, args):
    kind=args.get('kind');message=args.get('message')
    if kind not in ('sign_in','two_factor','captcha','error'): raise ValueError('Choose login, verification, captcha or screen help; payments use their approval flow')
    if not isinstance(message,str) or not message.strip() or len(message)>2000: raise ValueError('Explain the help needed (up to 2000 characters)')
    with lock(job/'human.lock'):
        state=load(job/'state.json')
        if state.get('screen') is None: raise ValueError('Human computer help requires a screen-mode task')
        # Models can issue parallel tool calls. They share one owner checkpoint,
        # so a second request cannot invalidate the card the owner already sees.
        if state.get('status')=='waiting' and state.get('human'):
            help_id=state['human']['id']
        else:
            help_id=uuid.uuid4().hex
            state.update(status='waiting',human={'id':help_id,'kind':kind,'message':message});atomic(job/'state.json',state)
    # Keep this exact SDK conversation, private browser and screen lease. No model calls while waiting.
    deadline=time.time()+86400
    while not (job/'human-results'/(help_id+'.json')).is_file():
        if time.time()>deadline: raise RuntimeError('Human handoff expired after one day; review before retrying')
        time.sleep(.2)
    with lock(job/'human.lock'):
        state=load(job/'state.json')
        if state.get('human',{}) and state['human']['id']==help_id:
            state.update(status='running',human=None);atomic(job/'state.json',state)
    return json.dumps({'completed':True,'instruction':'The owner says the login or check is complete. Take a screenshot, verify the current screen, and continue the original goal. If still blocked, request help again.'})


def installed_home():
    return pathlib.Path('/root/.hermes') if pathlib.Path('/usr/local/lib/hermes-agent/run_agent.py').is_file() else pathlib.Path('/home/hermes/.hermes')


def history(request):
    home=installed_home()
    connection=sqlite3.connect('file:'+str(home/'state.db')+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
    page=max(0,min(100000,int(request.get('page',0))))
    if request.get('sessionId'):
        session_id=str(request['sessionId'])[:200]
        rows=connection.execute("SELECT id,role,content,timestamp FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY id LIMIT 100 OFFSET ?",(session_id,page*100)).fetchall()
        total=connection.execute("SELECT count(*) FROM messages WHERE session_id=? AND role IN ('user','assistant')",(session_id,)).fetchone()[0]
        return {'messages':[dict(r) for r in rows],'total':total,'page':page}
    query='%'+str(request.get('q',''))[:200]+'%'
    rows=connection.execute("SELECT id,title,profile_name,source,started_at,message_count FROM sessions WHERE coalesce(title,'') LIKE ? ORDER BY started_at DESC LIMIT 50 OFFSET ?",(query,page*50)).fetchall()
    total=connection.execute("SELECT count(*) FROM sessions WHERE coalesce(title,'') LIKE ?",(query,)).fetchone()[0]
    return {'sessions':[dict(r) for r in rows],'total':total,'page':page}


def files(request):
    home=installed_home()
    roots={'workspace':pathlib.Path('/workspace'),'hermes-home':home/'home','artifacts':ROOT/'sessions'}
    label=request.get('root','workspace')
    if label not in roots: raise ValueError('Unknown file root')
    root=roots[label].resolve();relative=pathlib.Path(str(request.get('path','')))
    target=(root/relative).resolve()
    if not target.is_relative_to(root): raise ValueError('File is outside the business computer root')
    denied=lambda name: name.startswith('.') or any(word in name.lower() for word in ['credential','secret','token','private-key'])
    if any(denied(part) for part in relative.parts): raise ValueError('Private credential paths are excluded')
    if not target.exists(): return {'files':[],'total':0,'root':label,'path':str(relative),'notice':'This directory does not exist on this computer'}
    if target.is_dir():
        rows=[]
        for path in sorted(target.iterdir(),key=lambda p:p.name):
            if path.is_symlink() or denied(path.name): continue
            rows.append({'name':path.name,'path':str(path.relative_to(root)),'directory':path.is_dir(),'bytes':path.stat().st_size})
        return {'files':rows[:200],'total':len(rows),'root':label,'path':str(relative)}
    if not target.is_file() or target.suffix.lower() not in ('.md','.txt','.csv','.json','.py','.js','.ts','.yaml','.yml','.html'): raise ValueError('Only text artifacts can be previewed')
    return {'text':target.read_text(errors='replace')[:100000],'root':label,'path':str(relative)}


def screen_slot():
    for slot in range(MAX_SCREENS):
        handle=(ROOT/f'screen-{slot}.lock').open('a')
        try:
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
            # Existing Hermes desktops may already use one of these display numbers.
            if pathlib.Path(f'/tmp/.X11-unix/X{120+slot}').exists() or pathlib.Path(f'/tmp/.X{120+slot}-lock').exists():
                handle.close();continue
            return slot,handle
        except BlockingIOError: handle.close()
    return None,None


def screen_tools(handler):
    # Each action declares its own required arguments. Some model backends omit
    # optional fields from a discriminator schema, leaving navigation unusable.
    specs=[
        ('screenshot','View your leased private browser screen.',{},[]),
        ('navigate','Open a public HTTPS URL in your leased private browser.',{'url':{'type':'string'}},['url']),
        ('click','Click a point observed on your leased 1280 by 900 screen.',{'x':{'type':'integer'},'y':{'type':'integer'}},['x','y']),
        ('type','Type text into the focused field on your leased screen.',{'text':{'type':'string'}},['text']),
        ('key','Press an allowed keyboard key on your leased screen.',{'key':{'type':'string'}},['key'])]
    def action_handler(action):
        return lambda args,**kw: handler({**args,'action':action},**kw)
    return [('bops_screen_'+action,description,properties,required,action_handler(action)) for action,description,properties,required in specs]


def browser_executable():
    # Orgo may put a wrapper first on PATH that forces its shared desktop
    # profile and debugging port. A leased screen needs a separate browser.
    for executable in ['/usr/bin/google-chrome','/usr/bin/chromium','/opt/google/chrome/chrome']:
        if pathlib.Path(executable).is_file(): return executable
    raise RuntimeError('No private-screen Chrome or Chromium executable is installed')


def worker(turn):
    job=ROOT/'jobs'/turn
    # The submitter commits identity/PID before any tool or model request.
    while not (job/'state.json').exists(): time.sleep(.02)
    request=load(job/'request.json');state=load(job/'state.json')
    children=[];lease=None;slot=None;browser_temp=None
    try:
        # The SDK may re-exec Python on import. Bootstrap before owning any
        # display or subprocess, so that restart cannot orphan them.
        sdk=hermes_sdk(request)
        if request['mode']=='screen':
            deadline=time.time()+600
            while lease is None:
                slot,lease=screen_slot()
                if lease is None:
                    if time.time()>deadline: raise RuntimeError('Waited ten minutes for a screen. Retry when capacity is available.')
                    time.sleep(.5)
            display=':'+str(120+slot)
            # Never attach to an existing display. Our private display belongs only to this job.
            if pathlib.Path('/tmp/.X11-unix/X'+str(120+slot)).exists(): raise RuntimeError('Private display is occupied outside this bridge; refusing takeover')
            state['screen']=slot;atomic(job/'state.json',state)
            children.append(subprocess.Popen(['Xvfb',display,'-screen','0','1280x900x24','-nolisten','tcp'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
            for _ in range(100):
                if pathlib.Path('/tmp/.X11-unix/X'+str(120+slot)).exists(): break
                time.sleep(.05)
            else: raise RuntimeError('Private screen did not start')
            os.environ['DISPLAY']=display
            # Hermes may set TMPDIR to a deeply nested session cache. Chrome's
            # Unix socket path must fit the OS limit, even on long instance IDs.
            browser_temp=tempfile.TemporaryDirectory(prefix='bops-screen-',dir='/tmp')
            with (job/'browser.log').open('ab') as browser_log:
                children.append(subprocess.Popen([browser_executable(),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--user-data-dir='+str(ROOT/'sessions'/request['session']/'browser'),'--window-size=1280,900','about:blank'],stdout=browser_log,stderr=browser_log,env={**os.environ,'TMPDIR':browser_temp.name}))
            window=subprocess.run(['xdotool','search','--sync','--onlyvisible','--class','Chrome|Chromium'],check=True,timeout=20,stdout=subprocess.PIPE,text=True).stdout.splitlines()[0]
            subprocess.run(['xdotool','windowfocus','--sync',window],check=True,timeout=10)
        state.update(status='running',screen=slot,startedAt=int(time.time()*1000));atomic(job/'state.json',state)
        run_agent(job,request,sdk)
        state=load(job/'state.json',state)
        state.update(status='done',answer=load(job/'answer.json')['answer'],endedAt=int(time.time()*1000))
    except BaseException as error:
        state=load(job/'state.json',state)
        state.update(status='failed',error=str(error)[:500],endedAt=int(time.time()*1000))
    finally:
        for child in reversed(children):
            try:
                child.terminate()
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill();child.wait()
            except ProcessLookupError: pass
        if lease: lease.close()
        if browser_temp: browser_temp.cleanup()
        (job/'request.json').unlink(missing_ok=True)
        state['cleanupConfirmed']=screen_clean(state);atomic(job/'state.json',state)


def hermes_sdk(request):
    home=ROOT/'sessions'/request['session']/'hermes';home.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.environ['HERMES_HOME']=str(home)
    hermes=next((p for p in [pathlib.Path('/usr/local/lib/hermes-agent'),pathlib.Path('/home/hermes/.hermes/hermes-agent')] if (p/'run_agent.py').is_file()),None)
    if not hermes: raise RuntimeError('Installed Hermes library was not found')
    sys.path.insert(0,str(hermes))
    from run_agent import AIAgent
    import model_tools
    from tools.registry import registry
    import toolsets
    return AIAgent,registry,toolsets


def run_agent(job,request,sdk):
    AIAgent,registry,toolsets=sdk
    artifacts=ROOT/'sessions'/request['session']/'artifacts';artifacts.mkdir(parents=True,exist_ok=True,mode=0o700)
    def fetch_url(args,**kw):
        url=args['url']
        class PublicOnly(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,headers,newurl):
                validate_url(newurl);return super().redirect_request(req,fp,code,msg,headers,newurl)
        validate_url(url)
        with urllib.request.build_opener(PublicOnly).open(url,timeout=20) as response:
            text=response.read(100000).decode('utf-8','replace')
            final_url=response.geturl()
        text=re.sub('<[^>]+>',' ',re.sub(r'<(script|style).*?</\1>','',text,flags=re.S))[:16000]
        atomic(job/'public-reads'/(uuid.uuid4().hex+'.json'),{'url':final_url,'text':text[:2000],'at':int(time.time()*1000)})
        return json.dumps({'text':text})
    def artifact(args,**kw):
        name=args['name']
        if not re.fullmatch(r'[\w-]{1,80}\.(md|txt|csv|json)',name): raise ValueError('Use a simple artifact filename')
        target=artifacts/name
        if args.get('text') is not None:
            text=args['text']
            if not isinstance(text,str) or len(text)>100000: raise ValueError('Artifact is too large')
            target.write_text(text);target.chmod(0o600);return json.dumps({'saved':name})
        return json.dumps({'text':target.read_text()[:16000]})
    def perform_screen(args,**kw):
        if request['mode']!='screen': raise ValueError('This task has no screen lease')
        action=args['action']
        if action=='screenshot':
            return {'_multimodal':True,'content':[{'type':'text','text':'Your leased private screen'},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+capture_screen(job)}}]}
        if action=='navigate':
            validate_url(args['url']);subprocess.run(['xdotool','key','--clearmodifiers','ctrl+l'],check=True);subprocess.run(['xdotool','type','--clearmodifiers','--',args['url']],check=True);subprocess.run(['xdotool','key','Return'],check=True)
        elif action=='click':
            x,y=int(args['x']),int(args['y'])
            if not 0<=x<1280 or not 0<=y<900: raise ValueError('Click is outside the leased screen')
            subprocess.run(['xdotool','mousemove',str(x),str(y),'click','1'],check=True)
        elif action=='type': subprocess.run(['xdotool','type','--clearmodifiers','--',str(args['text'])[:10000]],check=True)
        elif action=='key':
            key=args['key']
            if key not in ['Return','Tab','Escape','BackSpace','ctrl+a','ctrl+l','Page_Down','Page_Up','Down','Up']: raise ValueError('Unsupported key')
            subprocess.run(['xdotool','key','--clearmodifiers',key],check=True)
        else: raise ValueError('Unsupported screen action')
        return json.dumps({'done':True})
    def screen(args,**kw):
        with lock(job/'human.lock'):
            if load(job/'state.json').get('status')=='waiting': raise ValueError('The owner is using this screen; agent input is paused')
            return perform_screen(args,**kw)
    def request_screens(args,**kw):
        count=int(args['count']);reason=str(args['reason'])[:1000]
        if not 1<=count<=16 or not reason.strip(): raise ValueError('Specify the required capacity and reason')
        state=load(job/'state.json');state.setdefault('requests',[]).append({'id':uuid.uuid4().hex,'requested':count,'reason':reason});atomic(job/'state.json',state)
        return json.dumps({'requested':count,'status':'pending owner review','limit':MAX_SCREENS})
    tools=[('bops_request_screens','Ask Operations to review extra screen capacity. Never provisions or charges automatically.',{'count':{'type':'integer'},'reason':{'type':'string'}},['count','reason'],request_screens),('bops_read_url','Read a public HTTPS page.',{'url':{'type':'string'}},['url'],fetch_url),('bops_artifact','Read or write this task’s draft artifacts. Cannot send or publish.',{'name':{'type':'string'},'text':{'type':'string'}},['name'],artifact)]
    def coordinator_tool(name):
        def call(args,**kw):
            call_id=uuid.uuid4().hex
            atomic(job/'tool-calls'/(call_id+'.json'),{'id':call_id,'name':name,'arguments':args})
            deadline=time.time()+300
            while time.time()<deadline:
                result=load(job/'tool-results'/(call_id+'.json'))
                if result is not None: return result['output']
                time.sleep(.2)
            raise RuntimeError('The coordinator did not answer the tool call within five minutes')
        return call
    for tool in request.get('tools') or []:
        if not re.fullmatch(r'(custom_[a-z0-9_]+|ask_teammate|hand_off|team_task_status|create_bot|delete_bot|list_agents|run_on_mac)',tool['name']): raise ValueError('Unsupported coordinator tool')
        schema=tool['parameters']
        tools.append((tool['name'],tool['description'],schema.get('properties',{}),schema.get('required',[]),coordinator_tool(tool['name'])))
    if request['mode']=='screen': tools.extend(screen_tools(screen))
    if request['mode']=='screen': tools.append(('bops_request_help','Pause for the owner to sign in, enter a verification code, solve a captcha or help on this exact screen. Keeps the task and browser open; after return, inspect the screen and continue.',{'kind':{'type':'string','enum':['sign_in','two_factor','captcha','error']},'message':{'type':'string'}},['kind','message'],lambda args,**kw:wait_for_human(job,args)))
    for name,description,properties,required,handler in tools:
        registry.register(name=name,toolset='bops_business',schema={'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required}},handler=handler,check_fn=lambda:True,override=True)
    toolsets.TOOLSETS['bops_business']={'tools':[t[0] for t in tools],'description':'Instance-scoped business work'}
    agent=AIAgent(model=request['model'],api_key=request['apiKey'],base_url='https://openrouter.ai/api/v1',provider='openrouter',enabled_toolsets=['bops_business'],max_iterations=20,quiet_mode=True,session_id='bops-'+request['session'],ephemeral_system_prompt=request['instructions'],reasoning_config=request.get('reasoning'))
    result=agent.run_conversation(request['input'],conversation_history=request.get('history') or [],task_id=request['turn'])
    answer=result.get('final_response')
    if not answer or result.get('completed') is False: raise RuntimeError('Hermes did not complete this turn')
    atomic(job/'answer.json',{'answer':answer})


def validate_url(url):
    from urllib.parse import urlparse
    parsed=urlparse(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,443): raise ValueError('Use a public HTTPS URL')
    addresses=socket.getaddrinfo(parsed.hostname,443)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses): raise ValueError('Private network URLs are unavailable')

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='worker':
        # Kill the whole owned process group on cancellation, including private Chrome/Xvfb children.
        signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(SystemExit('Stopped by you')))
        worker(sys.argv[2])
    else:
        try: output=command(json.loads(base64.b64decode(sys.argv[1])))
        except Exception as error: output={'error':str(error)[:500]}
        print('BOPS_HERMES='+json.dumps(output,separators=(',',':')))
