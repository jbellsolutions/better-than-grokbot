// Idempotent, private, provenance-bearing import. Unknown business ownership stays staged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('../lib/business-profiles.json');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(file+'.tmp',file)}
function ownership(relative){
 const file=relative.toLowerCase();
 if(/(ai-guy|agency|francois|homeservices|home-services|influencer|affiliate|newsletter|beehiiv)/.test(file))return 'ai-guy';
 if(/(revpartners|revenue-partner|lead-radar|dream100|dream-100|prospect|linkedin|outflo)/.test(file))return 'revenue-partners';
 const profile=catalog.find(p=>p.sources.some(s=>file.includes(s.id.toLowerCase())||file.includes(s.name.toLowerCase())));
 return profile?.instances.length===1?profile.instances[0]:null;
}
function contactRows(text,source){
 const out=[];let headers=[];
 for(const line of text.split('\n')){
  if(!line.trim().startsWith('|')){headers=[];continue}
  const columns=line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  if(columns.some(c=>/^e-?mail( address)?$/i.test(c))){headers=columns.map(c=>c.toLowerCase());continue}
  if(!headers.length||columns.every(c=>/^[-: ]+$/.test(c)))continue;
  const row=Object.fromEntries(headers.map((h,i)=>[h,columns[i]||'']));const field=row.email||row['e-mail']||row['email address']||'';
  const email=field.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase();if(!email)continue;
  out.push({id:hash(email).slice(0,32),name:row.name||row.contact||'',email,company:row.company||row.organization||'',suppressed:/unsubscrib|suppress|opt.?out|blocked|do.?not.?contact/i.test([row.status,row.suppressed,source].join(' ')),sources:[source],updatedAt:Date.now()});
 }
 if(/suppression/i.test(source))for(const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[])out.push({id:hash(email.toLowerCase()).slice(0,32),name:'',email:email.toLowerCase(),suppressed:true,sources:[source],updatedAt:Date.now()});
 return out;
}
function importArchive(sourceRoot,projectRoot=path.resolve(__dirname,'..'),commit='f3f8915cb66f65ee65820e6d70d7070048af68d3'){
 const existing={},docs={},contacts={},staged=[];for(const id of ['ai-guy','revenue-partners']){
  const root=path.join(projectRoot,'.data/instances',id,'business');existing[id]=root;
  docs[id]=fs.existsSync(path.join(root,'documents.json'))?JSON.parse(fs.readFileSync(path.join(root,'documents.json'))).filter(d=>!d.source.startsWith('grokbot:')):[];
  contacts[id]=fs.existsSync(path.join(root,'contacts.json'))?JSON.parse(fs.readFileSync(path.join(root,'contacts.json'))):[];
 }
 function visit(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isSymbolicLink())continue;if(ent.isDirectory()){visit(file);continue}const relative=path.relative(sourceRoot,file).replaceAll(path.sep,'/');if(!/^(recovered\/|history\/grokbot\/|analysis\/evidence\/companion\/)/.test(relative)||! /\.(md|txt|json)$/.test(file)||fs.statSync(file).size>2_000_000)continue;
  const target=ownership(relative);const checksum=hash(fs.readFileSync(file));if(!target){staged.push({source:relative,checksum,reason:'Business ownership unresolved'});continue}
  const text=fs.readFileSync(file,'utf8');const source='grokbot:'+relative;const id=hash(source).slice(0,32);const kind=/transcript|chats-|conversation/i.test(relative)?'history':'file';
  const folder=path.join(existing[target],'documents');fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.writeFileSync(path.join(folder,id+'.txt'),text,{mode:0o600});docs[target].push({id,title:relative.split('/').slice(-2).join(' / '),kind,source,checksum,bytes:Buffer.byteLength(text)});
  if(file.endsWith('.md'))for(const c of contactRows(text,source)){const prev=contacts[target].find(old=>old.email===c.email);if(prev){prev.suppressed ||= c.suppressed;prev.sources=[...new Set([...prev.sources,...c.sources])]}else contacts[target].push(c)}
 }}visit(sourceRoot);
 const reports=[];
 for(const id of ['ai-guy','revenue-partners']){atomic(path.join(existing[id],'documents.json'),docs[id]);atomic(path.join(existing[id],'contacts.json'),contacts[id]);const report={sourceCommit:commit,importedAt:new Date().toISOString(),counts:{documents:docs[id].length,contacts:contacts[id].length},excluded:staged.length,gaps:['Source chats cover only part of October 5–7; 18 routine prompts are missing.',`${staged.length} records have unresolved ownership and remain in private staging.`,'Source exports are historical; live CRM/Instantly contacts are not implied by these counts.']};atomic(path.join(existing[id],'manifest.json'),report);reports.push({instance:id,...report})}
 atomic(path.join(projectRoot,'.data/migration-staging.json'),staged);return reports;
}
if(require.main===module){if(!process.argv[2])throw Error('Usage: node scripts/import-business.cjs PRIVATE_ARCHIVE_ROOT');console.log(JSON.stringify(importArchive(path.resolve(process.argv[2])),null,2))}module.exports={importArchive,contactRows,ownership};
