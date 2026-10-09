// Adopt user-supplied recovery evidence and charters. Does not run agents or change provider state.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { redact } = require('./import-grok-recent.cjs');
const owners = [
  ['Reply Agent', 'Outflo Operator', 'Attio CRM Operator'],
  ['SMTP Newsletter Operator', 'Campaign Manager', 'List Manager', 'Editorial'],
  ['ESP & Deliverability', 'Instantly Operator', 'Head of operations'],
  ['Lead Radar', 'ClickUp Project Manager']
];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const atomic = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };
const identity = source => { const h = crypto.createHash('sha256').update(source).digest('hex').slice(0,32); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
async function importHandoff(source, project = path.resolve(__dirname, '..'), applyProfiles = false) {
  const charterText = fs.readFileSync(path.join(source, 'agent-charters.md'), 'utf8');
  const charters = charterText.split(/(?=^## [1-4]\. )/m).filter(text => /^## [1-4]\. /m.test(text)).map((text,i) => ({ id: String(i + 1), title: text.split('\n')[0].replace(/^## \d\. /,''), owners: owners[i], text: redact(text.trim()), status: 'Needs current readback; no execution authorized' }));
  if (charters.length !== 4) throw Error('Expected the four supplied reconstruction charters');
  const evidence = ['README.md', 'agent-charters.md', ...fs.readdirSync(path.join(source, 'threads')).filter(f => f.endsWith('.md')).map(f => 'threads/' + f)];
  const reconciliation = { source: 'Live Grok Bot email recovery supplied by Justin, October 8, 2026', importedAt: new Date().toISOString(), currentScope: ['SMTP newsletters', 'Instantly cold email'], excludedScope: ['Beehiiv'], status: 'Source evidence adopted; downstream verification and substantive approvals remain open', limitations: 'Bot reports and routine panels are evidence of reported state. Downstream Listmonk, Outflo, email, calendar and DNS states have not been independently verified.', charters,
    newsletters: [{ audience:'Solar',campaign:71,list:41,count:1614 },{ audience:'MCA / alternative financing',campaign:72,list:42,count:1413 },{ audience:'AI companies',campaign:73,list:43,count:872 }].map(r=>({...r,status:'Reported unscheduled draft; verify existing ID before any action'})),
    holds: ['Keep seed list 34 and reported Bird-only settings (2,000/rolling hour, max 1/second); verify current settings before any change.', 'Agency: 900 corrected batch-2 emails; loader reported disabled. First-batch 461 conflicts with writer counts: require readback.', 'Flagship: proposed 177 inboxes rejected; 300 Maildoso NO-SEND. Home Services: six usable inboxes / 60 per day; 660 remains conditional.', 'Inventory routine state per bot. Reply/health routines were not all stopped; never infer a blanket paused status.', 'Tony booking failure and Michael direct invite remain held. Do not assert a map-page root cause without provider evidence.', 'Homeschool Sent versus unsent conflict requires actual Sent-folder verification before any resend.', 'Email-capture page and duplicate-DMARC fixes are proposals, not confirmed completed changes.', 'No exact mailbox forwarding/redirect rule was recovered. Do not invent a rule from booking or website redirects.'] };
  for (const instance of ['ai-guy','revenue-partners']) {
    const root = path.join(project,'.data/instances',instance,'business'); fs.mkdirSync(path.join(root,'recent'),{recursive:true,mode:0o700});
    const review = read(path.join(root,'recent-review.json')); review.records = review.records.filter(r=>r.sourceKind!=='handoff');
    for (const relative of evidence) {
      const file=path.join(source,relative);if(fs.lstatSync(file).isSymbolicLink())throw Error('Refusing a linked evidence file');
      const id=identity('handoff-2026-10-08:'+relative);const text=redact(fs.readFileSync(file,'utf8'));
      fs.writeFileSync(path.join(root,'recent',id+'.txt'),text,{mode:0o600});review.records.push({id,agent:'Recovery handoff · '+relative,group:false,entries:1,observedAt:Date.now()/1000,sourceKind:'handoff'});
    }
    review.gaps=[...review.gaps.filter(g=>!g.startsWith('October 8 focused handoff:')), 'October 8 focused handoff: Beehiiv excluded; preserve existing newsletter drafts 71/72/73. Four reconstruction charters and their readbacks are available. Provider states and send conflicts still need verification.'];
    atomic(path.join(root,'recent-review.json'),review);atomic(path.join(root,'reconciliation.json'),reconciliation);
    if (applyProfiles) {
      const port=instance==='ai-guy'?3211:3212;
      const state=await(await fetch(`http://127.0.0.1:${port}/api/state`)).json();
      for (const charter of charters) for (const name of charter.owners) {
        const bot=state.state.bots.find(b=>b.name===name&&b.catalogId?.startsWith('grok-'));if(!bot)throw Error('Missing current profile: '+name);
        const marker=`\n\n[October 8 recovery charter ${charter.id}]\n`;
        if ((bot.instructions||'').includes(marker)) continue;
        const instructions=(bot.instructions||'')+marker+'This reconstruction charter supplies context, not approval to send, launch, invite, write CRM/provider state or resume routines. Begin with read-only verification; report missing access and Justin decisions. Preserve existing IDs and drafts.\n'+charter.text;
        const result=await fetch(`http://127.0.0.1:${port}/api/business`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'profile',botId:bot.id,instructions})});
        if(!result.ok)throw Error('Could not adopt charter for '+name);
      }
    }
  }
  return {charters:charters.length,readbacks:evidence.length-2,scope:reconciliation.currentScope,profilesUpdated:applyProfiles};
}
if(require.main===module) { if(!process.argv[2])throw Error('Usage: node scripts/import-live-handoff.cjs PRIVATE_HANDOFF_DIRECTORY [--apply-profiles]');importHandoff(path.resolve(process.argv[2]),undefined,process.argv.includes('--apply-profiles')).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.message);process.exitCode=1}); }
module.exports={importHandoff,identity};
