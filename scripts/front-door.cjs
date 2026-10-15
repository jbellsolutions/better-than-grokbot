// The front door on this Mac (edge/server.mjs) behind a Cloudflare named tunnel, so one Slack app can
// reach every Bops here: Slack's events and button clicks, and the bots' pictures. Both run as login
// services under caffeinate, like the Bops servers (scripts/instances.cjs).
//
//   node scripts/front-door.cjs tunnel <hostname>   make the tunnel "bops-edge" and its DNS name (once)
//   node scripts/front-door.cjs enable <hostname>   start the front door and the tunnel, now and at login
//   node scripts/front-door.cjs disable             stop both and remove their login services
//   node scripts/front-door.cjs remove              disable, then delete the tunnel (its DNS record stays:
//                                                   delete it in Cloudflare's dashboard, DNS)
//   node scripts/front-door.cjs status
//
// The tunnel passes only the paths Slack needs (events, clicks, pictures); everything else gets a 404
// at Cloudflare. The front door listens on 127.0.0.1 only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { readRegistry } = require('../desktop/instances.cjs');

const root = path.resolve(__dirname, '..');
const TUNNEL = 'bops-edge';
const PORT = 3290;
const CF_DIR = path.join(os.homedir(), '.cloudflared');
const CONFIG = path.join(CF_DIR, `${TUNNEL}.yml`);
const LOGS = path.join(os.homedir(), 'Library/Logs/Bops');
const EDGE = 'ai.orgo.bops.selfhosted.edge';
const TUN = 'ai.orgo.bops.selfhosted.edge-tunnel';
const plist = (label) => path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
const xml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const PATHS = String.raw`^/(hooks/slack(/events|/interactivity)?|mascot/[A-Za-z0-9-]+\.(png|jpg)|brand/[A-Za-z0-9-]+\.png|health)$`;

function cloudflared() {
  for (const p of ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']) if (fs.existsSync(p)) return p;
  throw Error('cloudflared is not installed (brew install cloudflared), or not signed in (cloudflared tunnel login).');
}
const hostOf = (h) => {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h ?? '')) throw Error('Give the public name, like bops-hooks.example.com');
  return h;
};
function tunnelId() {
  const list = JSON.parse(execFileSync(cloudflared(), ['tunnel', 'list', '--output', 'json', '--name', TUNNEL], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || 'null') ?? [];
  return list.find((t) => t.name === TUNNEL && !t.deleted_at)?.id ?? null;
}

function tunnel(hostname) {
  hostOf(hostname);
  let id = tunnelId();
  if (!id) {
    execFileSync(cloudflared(), ['tunnel', 'create', TUNNEL], { stdio: 'inherit' });
    id = tunnelId();
  }
  if (!id) throw Error('The tunnel was not made.');
  // Adds a CNAME for this name only; an existing record of that name is never overwritten (no --overwrite-dns).
  execFileSync(cloudflared(), ['tunnel', 'route', 'dns', TUNNEL, hostname], { stdio: 'inherit' });
  const yml = [
    `tunnel: ${id}`,
    `credentials-file: ${path.join(CF_DIR, `${id}.json`)}`,
    'ingress:',
    `  - hostname: ${hostname}`,
    `    path: ${JSON.stringify(PATHS)}`,
    `    service: http://127.0.0.1:${PORT}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
  fs.writeFileSync(CONFIG, yml, { mode: 0o600 });
  console.log(`Tunnel ${TUNNEL} (${id}) → https://${hostname}, only Slack's paths, to 127.0.0.1:${PORT}. Config: ${CONFIG}`);
}

function service(label, args, env, log) {
  const envXml = Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join('');
  fs.writeFileSync(
    plist(label),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array><key>EnvironmentVariables</key><dict>${envXml}</dict><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>${xml(path.join(LOGS, `${log}.log`))}</string><key>StandardErrorPath</key><string>${xml(path.join(LOGS, `${log}-error.log`))}</string></dict></plist>`,
    { mode: 0o600 },
  );
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' });
  } catch {}
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist(label)], { stdio: 'pipe' });
}

function enable(hostname) {
  hostOf(hostname);
  if (!fs.existsSync(CONFIG)) throw Error(`Make the tunnel first: node scripts/front-door.cjs tunnel ${hostname}`);
  const entries = readRegistry(root);
  // Every Bops on this Mac, the first one first (it answers Slack's address check).
  const upstreams = entries.map((e) => `${e.id}=http://127.0.0.1:${e.port}`).join(',');
  fs.mkdirSync(LOGS, { recursive: true });
  const node = fs.realpathSync(process.execPath);
  service(EDGE, ['/usr/bin/caffeinate', '-i', '-s', node, path.join(root, 'edge/server.mjs')], { PORT: String(PORT), HOST: '127.0.0.1', BOPS_PUBLIC_URL: `https://${hostname}`, BOPS_UPSTREAM: `http://127.0.0.1:${entries[0].port}`, BOPS_UPSTREAMS: upstreams }, 'edge');
  service(TUN, ['/usr/bin/caffeinate', '-i', '-s', cloudflared(), 'tunnel', '--no-autoupdate', '--config', CONFIG, 'run', TUNNEL], {}, 'edge-tunnel');
  console.log(`Front door on 127.0.0.1:${PORT} for ${entries.map((e) => e.id).join(', ')}; public at https://${hostname}. Logs: ${LOGS}/edge*.log`);
}

function disable() {
  for (const label of [TUN, EDGE]) {
    try {
      execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(plist(label), { force: true });
  }
  console.log('Front door and tunnel stopped; their login services removed.');
}

function remove() {
  disable();
  const id = tunnelId();
  if (id) {
    execFileSync(cloudflared(), ['tunnel', 'cleanup', TUNNEL], { stdio: 'inherit' });
    execFileSync(cloudflared(), ['tunnel', 'delete', TUNNEL], { stdio: 'inherit' });
  }
  fs.rmSync(CONFIG, { force: true });
  console.log(`Tunnel ${TUNNEL} deleted. Its DNS record stays: delete the public name's CNAME (it points at the tunnel) in Cloudflare's dashboard (DNS).`);
}

function status() {
  for (const label of [EDGE, TUN]) {
    let line = 'not running';
    try {
      line = execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/state = (\w+)/)?.[1] ?? 'loaded';
    } catch {}
    console.log(`${label}: ${line}`);
  }
  console.log(`tunnel ${TUNNEL}: ${tunnelId() ?? 'not made'}`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'tunnel') tunnel(arg);
  else if (command === 'enable') enable(arg);
  else if (command === 'disable') disable();
  else if (command === 'remove') remove();
  else if (command === 'status') status();
  else throw Error('Use: tunnel <hostname> | enable <hostname> | disable | remove | status');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
