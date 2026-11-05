// Reuse the root's standalone-server resources, without the private macOS relay binary.
const base = require('../package.json').build;
module.exports = {
  extends: null,
  ...base,
  appId: 'com.betterthangrokbot.desktop.windows',
  productName: 'Better Than GrokBot',
  files: [...base.files, 'LICENSE', 'TRADEMARK.md'],
  extraResources: base.extraResources.filter(r => !r.from.startsWith('vendor/')),
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'desktop/icon.png', signAndEditExecutable: false },
  nsis: { license: 'LICENSE', oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, runAfterFinish: false, deleteAppDataOnUninstall: false },
  artifactName: 'Better-Than-GrokBot-${version}-windows-${arch}-setup.${ext}',
};
