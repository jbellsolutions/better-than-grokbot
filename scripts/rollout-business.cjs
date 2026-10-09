// Deploy only our isolated bridge; no runtime updates, scheduler changes or campaign activation.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const {readRegistry}=require('../desktop/instances.cjs');const root=path.resolve(__dirname,'..');
async function rollout(){
 const source=fs.readFileSync(path.join(root,'vm/business-hermes.py'));const checksum=crypto.createHash('sha256').update(source).digest('hex');
 for(const entry of readRegistry(root).filter(e=>e.id!=='default')){
  const key=execFileSync('security',['find-generic-password','-s',`Bops Vault ${entry.id}`,'-a','orgo-api-key','-w'],{encoding:'utf8'}).trim();
  const payload=Buffer.from(JSON.stringify({id:entry.id,computer:entry.computerId,source:source.toString('base64'),checksum})).toString('base64');
  const code=`import base64,json,pathlib,hashlib,time\nr=json.loads(base64.b64decode('${payload}'))\np=pathlib.Path('/opt/bops-business')/r['id']\np.mkdir(parents=True,exist_ok=True,mode=0o700)\nowner=p/'owner.json'\nif owner.exists() and json.loads(owner.read_text())!={'instance':r['id'],'computer':r['computer']}:raise RuntimeError('Existing bridge belongs to another instance')\ntarget=p/'business-hermes.py'\nif target.exists() and not owner.exists():raise RuntimeError('Unowned bridge file; refusing replacement')\nowner.write_text(json.dumps({'instance':r['id'],'computer':r['computer']}));owner.chmod(0o600)\ndata=base64.b64decode(r['source'])\nassert hashlib.sha256(data).hexdigest()==r['checksum']\nif target.exists() and target.read_bytes()!=data:\n backup=p/('business-hermes.backup-'+str(time.time_ns())+'.py');backup.write_bytes(target.read_bytes());backup.chmod(0o600)\ntemp=p/'business-hermes.new';temp.write_bytes(data);temp.chmod(0o700);temp.replace(target)\nprint('Bridge deployed; existing Hermes runtime preserved')`;
  const encoded=Buffer.from(code).toString('base64');const command=`python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`;
  const response=await fetch(`https://www.orgo.ai/api/computers/${entry.computerId}/bash`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({command,timeout:30}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok||result.exit_code!==0)throw Error(`${entry.name}: isolated bridge deployment failed`);
  const dir=path.join(root,'.data/instances',entry.id,'business');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'runtime-deployment.json'),JSON.stringify({instance:entry.id,computer:entry.computerId,checksum,at:new Date().toISOString()}),{mode:0o600});console.log(`${entry.name}: isolated Hermes bridge deployed`);
 }
}
if(require.main===module)rollout().catch(e=>{console.error(e.message);process.exitCode=1});module.exports={rollout};
