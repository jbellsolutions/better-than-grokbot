const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// The team that ships. Separate teams are added to the registry with `node scripts/instances.cjs add`.
const definitions = [
  { id: 'default', name: 'Current Bops', port: 3210, purpose: 'Your existing team', cdp: 9300 },
];
const registryFile = root => path.join(root, '.data', 'instances.json');
function readRegistry(root) {
  if (!fs.existsSync(registryFile(root))) return [{ ...definitions[0], url: 'http://localhost:3210' }];
  const records = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'));
  return validateRegistry(records);
}

/** Future computers use independent local ports; never accept arbitrary remote endpoints. */
function validateRegistry(records) {
  if (!Array.isArray(records) || !records.length || records[0]?.id !== 'default' || new Set(records.map(r => r?.id)).size !== records.length || records.some((r, i) => !r || !/^[a-z][a-z0-9-]{0,39}$/.test(r.id) || r.port !== 3210 + i || r.port > 65535 || r.url !== `http://localhost:${r.port}`)) throw Error('Invalid Bops instance registry');
  return records;
}

/** Next will read the shared .env again: blank excluded values explicitly to prevent inheritance. */
function instanceEnv(root, entry, inherited = process.env) {
  const shared = {};
  for (const name of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) Object.assign(shared, parseEnv(fs.readFileSync(file, 'utf8')));
  }
  if (entry.id === 'default') return { ...inherited, PORT: String(entry.port), BOPS_INSTANCE_REGISTRY: registryFile(root) };
  const env = { ...inherited };
  const inference = /^(OPENROUTER_API_KEY|BOPS_(CHAT|SESSION|HARD)_MODEL|BOPS_ORGO_ORIGIN|TYPESAFE_.*)$/;
  for (const [key, value] of Object.entries({ ...shared, ...inherited })) {
    if (key in shared || /^(BOPS_|ORGO_|OPENAI_|OPENROUTER_|AGENTMAIL_|AGENTPHONE_|HONCHO_|COMPOSIO_|TYPESAFE_|SLACK_|TELEGRAM_|DISCORD_|TWILIO_|TAILSCALE_)/.test(key)) env[key] = inference.test(key) ? value : '';
  }
  const directory = path.join(root, '.data', 'instances', entry.id);
  const privateEnv = path.join(directory, '.env.local');
  if (fs.existsSync(privateEnv)) Object.assign(env, parseEnv(fs.readFileSync(privateEnv, 'utf8')));
  // Identity and computer binding are fixed by the registry, never overridden by shared settings.
  return { ...env, BOPS_INSTANCE_ID: entry.id, BOPS_INSTANCE_NAME: entry.name,
    BOPS_DATA_DIR: directory, BOPS_INSTANCE_REGISTRY: registryFile(root),
    BOPS_SELF_HOSTED: '1', BOPS_DATABASE_URL: '', BOPS_ORGO_COMPUTER_ID: entry.computerId,
    BOPS_CDP_PORT_BASE: String(entry.cdp), BOPS_COMPUTER_OBSERVE_ONLY: '1',
    BOPS_BUSINESS_RUNTIME: 'hermes', BOPS_DISABLE_MAC: '', PORT: String(entry.port), NODE_ENV: 'production' };
}

async function verify(entry, fetchImpl = fetch) {
  const r = await fetchImpl(`${entry.url}/api/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
  if (!r.ok) throw Error(`${entry.name} is unavailable`);
  const health = await r.json();
  if (!health.bops || health.instance?.id !== entry.id) throw Error(`Another server is using ${entry.name}'s port`);
  if (entry.computerId && health.instance.computerId !== entry.computerId) throw Error(`${entry.name} has the wrong computer binding`);
  return health;
}
module.exports = { definitions, registryFile, readRegistry, validateRegistry, instanceEnv, verify };
