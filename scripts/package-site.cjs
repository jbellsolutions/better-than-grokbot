// Publish an explicit static-site allowlist and Git-visible source. Never ship local state or keys.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-desktop', 'website');
const web = path.join(output, 'public_html');
fs.mkdirSync(path.join(web, 'download'), { recursive: true });
for (const name of ['index.html', 'styles.css', 'main.js', 'mark.svg', 'robots.txt', 'sitemap.xml', '.htaccess']) {
  fs.copyFileSync(path.join(root, 'site', name), path.join(web, name));
}
fs.cpSync(path.join(root, 'site', 'screenshots'), path.join(web, 'screenshots'), { recursive: true });
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(web, 'download', 'LICENSE.txt'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
// Include new project files, respecting .gitignore; fail if an unsafe path exists.
const unsafe = files.filter(f => /(^|\/)(\.env(?:\..*)?|\.data|envs|node_modules|dist-desktop|repo\.json)(\/|$)/.test(f) && f !== '.env.example');
if (unsafe.length) throw Error('Unsafe files are tracked; refusing to package a public download.');
const source = path.join(output, 'source', 'Better-Than-GrokBot');
fs.rmSync(source, { recursive: true, force: true });
fs.mkdirSync(source, { recursive: true });
for (const file of files.filter(f => !f.startsWith('.git'))) {
  const target = path.join(source, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
  fs.chmodSync(target, fs.statSync(path.join(root, file)).mode & 0o777);
}
const zip = path.join(web, 'download', 'Better-Than-GrokBot-source.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, 'Better-Than-GrokBot'], { cwd: path.dirname(source) });
fs.rmSync(path.dirname(source), { recursive: true, force: true });
const bundle = path.join(output, 'Better-Than-GrokBot-website.zip');
fs.rmSync(bundle, { force: true });
execFileSync('zip', ['-qr', bundle, '.'], { cwd: web });
const railway = path.join(output, 'railway');
fs.mkdirSync(railway, { recursive: true });
fs.cpSync(web, path.join(railway, 'public_html'), { recursive: true });
for (const name of ['Dockerfile', 'nginx.conf', 'railway.json']) {
  fs.copyFileSync(path.join(root, 'site', name), path.join(railway, name));
}
console.log(`Website archive: ${bundle}`);
console.log(`Railway deploy directory: ${railway}`);
console.log(`Web root: ${web}`);
