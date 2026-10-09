"""Isolated Hermes jobs. No existing profiles, displays, gateways or schedules are modified."""
import sqlite3
import base64, contextlib, fcntl, hashlib, ipaddress, json, os, pathlib, re, signal, socket, subprocess, sys, time, urllib.request, uuid
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


def owned_worker_alive(pid, turn):
    if not pid_alive(pid): return False
    try:
        argv=pathlib.Path('/proc')/str(pid)/'cmdline'
        parts=argv.read_bytes().decode().split('\0')
        return str(pathlib.Path(__file__).resolve()) in parts and ['worker',turn] == parts[-3:-1]
    except (OSError,UnicodeError): return False


def screen_clean(state):
    return state.get('screen') is None or not pathlib.Path('/tmp/.X11-unix/X'+str(120+state['screen'])).exists()


def status(job):
    state=load(job/'state.json',{'status':'missing'})
    if state['status'] in ('queued','running') and not owned_worker_alive(state.get('pid'),job.name):
        state.update(status='failed',cleanupConfirmed=screen_clean(state),error='Hermes worker stopped. Review before retrying; work was not replayed.');atomic(job/'state.json',state)
    if state.get('cleanupConfirmed') is False and screen_clean(state):
        state['cleanupConfirmed']=True;atomic(job/'state.json',state)
    return state


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
    if action=='cancel':
        with lock(ROOT/'submit.lock'):
            state=status(job)
            if state['status'] in ('queued','running'):
                # PID is our process group leader, stored only by submit.
                try: os.killpg(state['pid'],signal.SIGTERM)
                except ProcessLookupError: pass
                deadline=time.time()+10
                while owned_worker_alive(state.get('pid'),turn) and time.time()<deadline: time.sleep(.1)
                state=status(job)
        return state
    if action=='snapshot':
        state=status(job)
        if state.get('screen') is None: return {'error':'This job has no screen'}
        image=job/'preview.png'
        subprocess.run(['scrot',str(image)],env={**os.environ,'DISPLAY':':'+str(120+state['screen'])},check=True,timeout=10)
        return {'image':base64.b64encode(image.read_bytes()).decode(),'contentType':'image/png'}
    raise ValueError('Unsupported bridge action')


def history(request):
    home=pathlib.Path('/root/.hermes') if 'ai-guy'==ROOT.name else pathlib.Path('/home/hermes/.hermes')
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
    home=pathlib.Path('/root/.hermes') if 'ai-guy'==ROOT.name else pathlib.Path('/home/hermes/.hermes')
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
        try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);return slot,handle
        except BlockingIOError: handle.close()
    return None,None


def worker(turn):
    job=ROOT/'jobs'/turn
    # The submitter commits identity/PID before any tool or model request.
    while not (job/'state.json').exists(): time.sleep(.02)
    request=load(job/'request.json');state=load(job/'state.json')
    children=[];lease=None;slot=None
    try:
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
            children.append(subprocess.Popen(['Xvfb',display,'-screen','0','1280x900x24','-nolisten','tcp'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
            for _ in range(100):
                if pathlib.Path('/tmp/.X11-unix/X'+str(120+slot)).exists(): break
                time.sleep(.05)
            else: raise RuntimeError('Private screen did not start')
            os.environ['DISPLAY']=display
            children.append(subprocess.Popen(['google-chrome','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--user-data-dir='+str(ROOT/'sessions'/request['session']/'browser'),'--window-size=1280,900','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
        state.update(status='running',screen=slot,startedAt=int(time.time()*1000));atomic(job/'state.json',state)
        run_agent(job,request)
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
        (job/'request.json').unlink(missing_ok=True)
        state['cleanupConfirmed']=screen_clean(state);atomic(job/'state.json',state)


def run_agent(job,request):
    home=ROOT/'sessions'/request['session']/'hermes';home.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.environ['HERMES_HOME']=str(home)
    hermes=next((p for p in [pathlib.Path('/usr/local/lib/hermes-agent'),pathlib.Path('/home/hermes/.hermes/hermes-agent')] if (p/'run_agent.py').is_file()),None)
    if not hermes: raise RuntimeError('Installed Hermes library was not found')
    sys.path.insert(0,str(hermes))
    from run_agent import AIAgent
    import model_tools
    from tools.registry import registry
    import toolsets
    artifacts=ROOT/'sessions'/request['session']/'artifacts';artifacts.mkdir(parents=True,exist_ok=True,mode=0o700)
    def fetch_url(args,**kw):
        url=args['url']
        class PublicOnly(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,headers,newurl):
                validate_url(newurl);return super().redirect_request(req,fp,code,msg,headers,newurl)
        validate_url(url)
        with urllib.request.build_opener(PublicOnly).open(url,timeout=20) as response:
            text=response.read(100000).decode('utf-8','replace')
        return json.dumps({'text':re.sub('<[^>]+>',' ',re.sub(r'<(script|style).*?</\1>','',text,flags=re.S))[:16000]})
    def artifact(args,**kw):
        name=args['name']
        if not re.fullmatch(r'[\w-]{1,80}\.(md|txt|csv|json)',name): raise ValueError('Use a simple artifact filename')
        target=artifacts/name
        if args.get('text') is not None:
            text=args['text']
            if not isinstance(text,str) or len(text)>100000: raise ValueError('Artifact is too large')
            target.write_text(text);target.chmod(0o600);return json.dumps({'saved':name})
        return json.dumps({'text':target.read_text()[:16000]})
    def screen(args,**kw):
        if request['mode']!='screen': raise ValueError('This task has no screen lease')
        action=args['action']
        if action=='screenshot':
            image=job/'preview.png';subprocess.run(['scrot',str(image)],check=True,timeout=10)
            return {'_multimodal':True,'content':[{'type':'text','text':'Your leased private screen'},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode()}}]}
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
    def request_screens(args,**kw):
        count=int(args['count']);reason=str(args['reason'])[:1000]
        if not 1<=count<=16 or not reason.strip(): raise ValueError('Specify the required capacity and reason')
        state=load(job/'state.json');state.setdefault('requests',[]).append({'id':uuid.uuid4().hex,'requested':count,'reason':reason});atomic(job/'state.json',state)
        return json.dumps({'requested':count,'status':'pending owner review','limit':MAX_SCREENS})
    tools=[('bops_request_screens','Ask Operations to review extra screen capacity. Never provisions or charges automatically.',{'count':{'type':'integer'},'reason':{'type':'string'}},['count','reason'],request_screens),('bops_read_url','Read a public HTTPS page.',{'url':{'type':'string'}},['url'],fetch_url),('bops_artifact','Read or write this task’s draft artifacts. Cannot send or publish.',{'name':{'type':'string'},'text':{'type':'string'}},['name'],artifact)]
    if request['mode']=='screen': tools.append(('computer_use','Use only your leased private screen. No terminal or helper agents.',{'action':{'type':'string','enum':['screenshot','navigate','click','type','key']},'url':{'type':'string'},'x':{'type':'integer'},'y':{'type':'integer'},'text':{'type':'string'},'key':{'type':'string'}},['action'],screen))
    for name,description,properties,required,handler in tools:
        registry.register(name=name,toolset='bops_business',schema={'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required}},handler=handler,check_fn=lambda:True,override=True)
    toolsets.TOOLSETS['bops_business']={'tools':[t[0] for t in tools],'description':'Instance-scoped business work'}
    agent=AIAgent(model=request['model'],api_key=request['apiKey'],base_url='https://openrouter.ai/api/v1',provider='openrouter',enabled_toolsets=['bops_business'],max_iterations=20,quiet_mode=True,session_id='bops-'+request['session'],ephemeral_system_prompt=request['instructions'])
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
