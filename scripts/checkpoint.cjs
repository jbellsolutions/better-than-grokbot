// Private encrypted disaster-recovery image. Never publish it or its separate recovery key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { readRegistry } = require('../desktop/instances.cjs');
async function main() {
  if (process.platform !== 'darwin') throw Error('Encrypted recovery images require macOS.');
  if (execFileSync('git', ['status','--porcelain'], { cwd: root }).length) throw Error('Commit project changes before taking an exact checkpoint.');
  const { state } = await (await fetch('http://127.0.0.1:3210/api/state', { signal: AbortSignal.timeout(5000) })).json();
  if (state.sessions.some(s => ['starting','running','queued'].includes(s.status)) || state.chats.some(c => c.typing?.length)) throw Error('Wait until work finishes before taking a checkpoint.');
  for (const instance of readRegistry(root).filter(e => e.id !== 'default')) {
    const file = path.join(root, '.data/instances', instance.id, 'state.json');
    if (!fs.existsSync(file)) continue;
    const response = await fetch(`${instance.url}/api/state`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error(`Could not checkpoint ${instance.name}.`);
    const saved = await response.json();
    if (saved.instance?.id !== instance.id || saved.state.sessions.some(s => ['starting','running','queued'].includes(s.status)) || saved.state.chats.some(c => c.typing?.length)) throw Error(`Wait until ${instance.name} is available and idle before taking a checkpoint.`);
  }
  const sha = execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root}).toString().trim();
  const name = `checkpoint-${new Date().toISOString().replace(/[:.]/g,'-')}-${sha}`;
  const home = path.join(os.homedir(),'Library/Application Support/Bops Self-Hosted');
  const backups = path.join(home,'backups'), keys = path.join(home,'recovery-keys');
  for (const p of [backups,keys]) { fs.mkdirSync(p,{recursive:true,mode:0o700}); fs.chmodSync(p,0o700); }
  const staging = fs.mkdtempSync(path.join(backups,'.checkpoint-'));
  const image = path.join(backups,`${name}.dmg`), keyFile = path.join(keys,`${name}.txt`);
  const password = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(keyFile, password+'\n', { mode:0o600 });
  try {
    execFileSync('git',['bundle','create',path.join(staging,'source.bundle'),'--all'],{cwd:root,stdio:'ignore'});
    fs.mkdirSync(path.join(staging,'settings'),{mode:0o700});
    for (const name of ['.env','.env.local','.env.production','.env.production.local']) {
      const from = path.join(root,name); if(fs.existsSync(from)) fs.copyFileSync(from,path.join(staging,'settings',name));
    }
    fs.mkdirSync(path.join(staging,'state'),{mode:0o700});
    for (const name of ['state.json','openrouter','models.json']) { const from=path.join(root,'.data',name); if(fs.existsSync(from)) fs.cpSync(from,path.join(staging,'state',name),{recursive:true}); }
    for (const name of ['instances.json','instances']) { const from = path.join(root,'.data',name); if(fs.existsSync(from))fs.cpSync(from,path.join(staging,'state',name),{recursive:true}); }
    const deployment = path.join(staging,'deployment');fs.mkdirSync(deployment,{mode:0o700});
    for (const name of ['ai.orgo.bops.selfhosted.server.plist','ai.orgo.bops.selfhosted.updates.plist','ai.orgo.bops.selfhosted.ai-guy.plist','ai.orgo.bops.selfhosted.revenue-partners.plist']) { const from=path.join(os.homedir(),'Library/LaunchAgents',name); if(fs.existsSync(from))fs.copyFileSync(from,path.join(deployment,name)); }
    fs.copyFileSync(path.join(root,'.data/service.json'),path.join(deployment,'service.json'));
    const zip=path.join(root,'dist-desktop/share/Better-Than-GrokBot-arm64.zip'); if(fs.existsSync(zip))fs.copyFileSync(zip,path.join(staging,'Better-Than-GrokBot-arm64.zip'));
    fs.copyFileSync(path.join(root,'README.md'),path.join(staging,'RESTORE.md'));
    fs.writeFileSync(path.join(staging,'checkpoint.json'),JSON.stringify({createdAt:new Date().toISOString(),commit:sha,branch:execFileSync('git',['branch','--show-current'],{cwd:root}).toString().trim(),sourcePath:root,bots:state.bots.map(b=>({id:b.id,name:b.name,computerId:b.computerId,computer:b.computer})),limitations:['Sign in to Orgo and Codex again; Keychain and authentication tokens are not exported.','Mac permissions and private Tailscale hostname must be configured again.','Orgo VM disks are not copied; reconnect the existing computers in your Orgo account.','Copy the encrypted image off this Mac and store its recovery key separately.']},null,2));
    const secure=p=>{const s=fs.statSync(p);fs.chmodSync(p,s.isDirectory()?0o700:0o600);if(s.isDirectory())for(const n of fs.readdirSync(p))secure(path.join(p,n));};secure(staging);
    execFileSync('/usr/bin/hdiutil',['create','-srcfolder',staging,'-volname','Bops Recovery','-format','UDZO','-encryption','AES-256','-stdinpass',image],{input:Buffer.from(password+'\0'),stdio:['pipe','ignore','pipe'],timeout:240000});
    fs.chmodSync(image,0o600);
    execFileSync('/usr/bin/hdiutil',['verify','-stdinpass',image],{input:Buffer.from(password+'\0'),stdio:['pipe','ignore','pipe'],timeout:120000});
    const sha256=crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');fs.writeFileSync(image+'.sha256',`${sha256}  ${path.basename(image)}\n`,{mode:0o600});
    console.log(`Encrypted checkpoint verified: ${image}\nRecovery key (keep separately): ${keyFile}`);
  } finally { fs.rmSync(staging,{recursive:true,force:true}); }
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
