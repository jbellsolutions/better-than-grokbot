// A portable Apple-silicon app. Never include this Mac's source pointer, keys, or saved team.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
async function main() {
  if (process.platform !== 'darwin') throw Error('Package the Mac app on macOS.');
  if (!fs.existsSync(path.join(root, '.next/BUILD_ID'))) throw Error('Run npm run app:build first, while the coordinator is stopped.');
  const exports = path.join(root, 'dist-desktop/share');
  fs.mkdirSync(exports, { recursive: true });
  const working = fs.mkdtempSync(path.join(exports, '.portable-'));
  try {
    const folder = path.join(working, 'Better-Than-GrokBot');
    const app = path.join(folder, 'Better Than GrokBot.app');
    fs.mkdirSync(folder);
    // Let electron-builder regenerate ASAR integrity metadata for the portable build.
    const pointer = path.join(root, 'desktop/repo.json');
    const original = fs.existsSync(pointer) ? fs.readFileSync(pointer) : null;
    const outputDir = path.join(working, 'build');
    try {
      fs.rmSync(pointer, { force: true });
      execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', '--dir', '-c.mac.identity=null', '-c.productName=Better Than GrokBot', '-c.appId=ai.orgo.bops.selfhosted', `-c.directories.output=${outputDir}`], { cwd: root, stdio: 'inherit' });
    } finally { if (original) fs.writeFileSync(pointer, original); }
    execFileSync('/usr/bin/ditto', [path.join(outputDir, 'mac-arm64/Better Than GrokBot.app'), app]);
    const archive = path.join(app, 'Contents/Resources/app.asar');
    if (asar.listPackage(archive).includes('/desktop/repo.json')) throw Error('Source-folder pointer remained in the app.');
    const server = path.join(app, 'Contents/Resources/server');
    for (const name of fs.readdirSync(server)) if (name.startsWith('.env') || name === '.data') throw Error('Private settings or state found in the app.');
    for (const name of ['server.js', 'vm/openrouter-tools.py', 'vm/screen_mcp.py']) if (!fs.existsSync(path.join(server, name))) throw Error(`Bundled runtime is missing ${name}`);
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(folder, 'LICENSE.txt'));
    fs.writeFileSync(path.join(folder, 'START-HERE.txt'), `Better Than GrokBot — Apple silicon Macs\n\nThis is a separate installation. It does not contain the owner's keys, chats,\nOrgo assignments, or source-folder paths. It uses the server bundled inside the app.\n\n1. Copy Better Than GrokBot.app into Applications.\n2. Before first launch, create:\n   ~/Library/Application Support/Bops Self-Hosted/.env.local\n   with BOPS_SELF_HOSTED=1, your own OPENROUTER_API_KEY and ORGO_API_KEY, and:\n   BOPS_CHAT_MODEL=z-ai/glm-5.3-flash\n   BOPS_SESSION_MODEL=z-ai/glm-5.3-flash\n   BOPS_HARD_MODEL=z-ai/glm-5.3-flash\n   Keep that file private (chmod 600). Never reuse another person's keys.\n3. Open the app. This test build is unsigned and not notarized; macOS may\n   require explicit approval in Privacy & Security. A signed/notarized release\n   is needed for ordinary friction-free distribution.\n4. In the bot profile's Computer settings, select a running Linux desktop\n   from your own Orgo account. First use installs the required agent tools.\n5. For work on your Mac, install/sign in to Codex with your own ChatGPT\n   account, enable Computer Use, and approve the app/helper permissions.\n\nKeep the app open while using this standalone package: it owns its local\nserver. The original owner's login service, private browser hosting, daily\nbackups, and hourly updater are separate deployment setup and are not\ninstalled by this ZIP. Closing this app stops its coordinator.\n\nIf you intend to access the owner's existing team instead, request an\nauthorized browser invitation. This package creates a separate local team.\n`);
    const output = path.join(exports, 'Better-Than-GrokBot-arm64.zip');
    if (fs.existsSync(output)) throw Error('Share ZIP already exists; preserve or rename it before rebuilding.');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folder, output]);
    console.log(output);
  } finally { fs.rmSync(working, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
