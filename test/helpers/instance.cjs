const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
module.exports = function loadInstance(processStub) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/server/instance.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require, process: processStub });
  return exports;
};
