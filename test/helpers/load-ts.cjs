const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Execute the actual TypeScript modules, replacing only external boundaries supplied by a test. */
module.exports = function loadTs(file, mocks = {}, globals = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText;
    const requireModule = name => {
      if (name === 'server-only') return {};
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const resolved = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(filename), name);
        if (fs.existsSync(resolved + '.ts')) return load(resolved + '.ts');
        if (fs.existsSync(resolved + '.json')) return require(resolved + '.json');
      }
      return require(name);
    };
    vm.runInNewContext(source, { exports, require: requireModule, process, console, URL, Response, Request, ReadableStream, TextEncoder, TextDecoder, AbortSignal, AbortController, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, fetch, ...globals }, { filename });
    return exports;
  }
  return load(file);
};
