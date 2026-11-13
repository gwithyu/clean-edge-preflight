'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, parseImports } = require('../index.cjs');

function fixture(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'clean-edge-'));
  const put = (relative, body) => {
    const dest = path.join(root, relative);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    return dest;
  };
  try { return fn({ root, put }); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

test('static import, side effect, and export-star specifiers', () => {
  assert.deepEqual(parseImports('entry.js', `import './style.css';\nimport {thing} from './thing.js';\nexport * from './extra.js'`,).imports,
    ['./style.css', './thing.js', './extra.js']);
});
test('multiline import and re-export with comments', () => {
  const src = `import { thing } from /* old */ './thing.js';\nexport { thing } from\n './other.js';`;
  assert.deepEqual(parseImports('x.jsx', src).imports, ['./thing.js', './other.js']);
});
test('template strings, comments, JSX text and regex cannot invent imports', () => {
  const src = '// import "./comment.js"\nconst text = `import "./fake.js"`;\n'
    + 'const rx = /import \\".\\/regex.js\\"/;\n'
    + 'export default <div>import "./jsx-text.js"</div>;';
  assert.deepEqual(parseImports('x.jsx', src).imports, []);
});
test('static import syntax does not confuse dynamic import or import.meta', () => {
  assert.deepEqual(parseImports('x.js', 'import.meta.url; import("./literal.js"); import(name);').imports, ['./literal.js']);
});
test('relative dependencies resolve recursively and cycles terminate', () => fixture(({root, put}) => {
  put('src/main.jsx', `import './a.js';`);
  put('src/a.js', `export * from './main.jsx';`);
  const result = check(['src/main.jsx'], root);
  assert.equal(result.ok, true);
  assert.equal(result.files, 2);
  assert.equal(result.importsChecked, 2);
}));
test('missing transitive import must fail', () => fixture(({root, put}) => {
  put('src/main.jsx', `import './a.js';`);
  put('src/a.js', `export {x} from './missing.js';`);
  const result = check(['src/main.jsx'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('a.js -> ./missing.js')));
}));
test('missing CSS is not satisfied by a CSS.js impostor', () => fixture(({root, put}) => {
  put('src/main.js', `import './theme.css'`);
  put('src/theme.css.js', 'export default 1');
  assert.equal(check(['src/main.js'], root).ok, false);
}));
test('CSS query suffixes resolve to exact CSS file', () => fixture(({root, put}) => {
  put('src/main.js', `import styles from './theme.css?inline'`);
  put('src/theme.css', 'html{}');
  assert.equal(check(['src/main.js'], root).ok, true);
}));
test('extensionless index modules resolve', () => fixture(({root, put}) => {
  put('src/main.js', `import './lib'`);
  put('src/lib/index.jsx', 'export const x = 1;');
  assert.equal(check(['src/main.js'], root).ok, true);
}));
test('a directory without index is not a file', () => fixture(({root, put}) => {
  put('src/main.js', `import './lib'`);
  mkdirSync(path.join(root, 'src/lib'));
  assert.equal(check(['src/main.js'], root).ok, false);
}));
test('outside-root relative import is rejected', () => fixture(({root, put}) => {
  put('src/main.js', `import '../../secret.js'`);
  assert.equal(check(['src/main.js'], root).ok, false);
}));
test('symlink escape is rejected', () => fixture(({root, put}) => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  try {
    const external = path.join(outside, 'secret.js');
    writeFileSync(external, 'export const x = 1');
    put('src/main.js', `import './private.js'`);
    symlinkSync(external, path.join(root, 'src/private.js'));
    assert.equal(check(['src/main.js'], root).ok, false);
  } finally { rmSync(outside, { force:true, recursive:true }); }
}));
test('syntax errors fail instead of silently passing', () => fixture(({root, put}) => {
  put('src/main.js', 'import { broken from "./ok.js";');
  assert.equal(check(['src/main.js'], root).ok, false);
}));
test('missing root file fails', () => fixture(({root}) => {
  const result = check(['not-here.js'], root);
  assert.equal(result.ok, false);
}));

test('literal CommonJS require is checked, but computed require is left to the bundler', () => fixture(({root, put}) => {
  put('src/main.cjs', `const x = require('./missing.cjs');`);
  const result = check(['src/main.cjs'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('main.cjs -> ./missing.cjs')));
  put('src/main.cjs', `const x = require(name);`);
  assert.equal(check(['src/main.cjs'], root).ok, true);
}));
test('TypeScript external import-equals require is checked', () => fixture(({root, put}) => {
  put('src/main.cts', `import widget = require('./missing.cjs'); export = widget;`);
  const result = check(['src/main.cts'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('main.cts -> ./missing.cjs')));
}));
test('in-project symlink cycles are visited once', () => fixture(({root, put}) => {
  put('src/main.js', `import './alias/main.js';`);
  symlinkSync('.', path.join(root, 'src/alias'));
  const result = check(['src/main.js'], root);
  assert.equal(result.ok, true);
  assert.equal(result.files, 1);
  assert.equal(result.importsChecked, 1);
}));

test('TypeScript-only annotations in JavaScript must not pass preflight', () => fixture(({root, put}) => {
  put('src/main.js', 'const impossible: string = "x";');
  assert.equal(check(['src/main.js'], root).ok, false);
}));

test('TypeScript import type expressions and triple-slash references are checked', () => fixture(({root, put}) => {
  put('src/main.ts', `/// <reference path="./missing.d.ts" />\ntype Widget = import('./missing-widget').Widget;`);
  const result = check(['src/main.ts'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('main.ts -> ./missing.d.ts')));
  assert.ok(result.failures.some(f => f.includes('main.ts -> ./missing-widget')));
  put('src/missing.d.ts', 'declare const available: true;');
  put('src/missing-widget.d.ts', 'export type Widget = string;');
  assert.equal(check(['src/main.ts'], root).ok, true);
}));
test('literal require.resolve is checked for missing paths', () => fixture(({root, put}) => {
  put('src/main.cjs', `require.resolve('./unavailable.js');`);
  const result = check(['src/main.cjs'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('main.cjs -> ./unavailable.js')));
}));

test('require.resolve with options checks its literal dependency', () => fixture(({root, put}) => {
  put('src/main.cjs', `require.resolve('./missing.cjs', { paths: [__dirname] });`);
  const result = check(['src/main.cjs'], root);
  assert.equal(result.ok, false);
  assert.equal(result.importsChecked, 1);
  assert.ok(result.failures.some(f => f.includes('main.cjs -> ./missing.cjs')));
  put('src/missing.cjs', 'module.exports = 1;');
  assert.equal(check(['src/main.cjs'], root).ok, true);
}));

test('malformed .d.ts declarations fail safely without transpileModule', () => fixture(({root, put}) => {
  put('src/main.ts', `import type { Widget } from './types';`);
  put('src/types.d.ts', 'export interface Widget { bad: ; }');
  const result = check(['src/main.ts'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('Parse error in src/types.d.ts')));
}));

test('dynamic import with options still checks the literal module dependency', () => fixture(({root, put}) => {
  put('src/main.js', `import('./missing.json', { with: { type: 'json' } });`);
  let result = check(['src/main.js'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('main.js -> ./missing.json')));
  put('src/missing.json', '{}');
  result = check(['src/main.js'], root);
  assert.equal(result.ok, true);
}));

for (const [name, source, expected, typeScriptOnly] of [
  ['function parameters', `function render(require) { require('./local'); require.resolve('./local', {}); }`, []],
  ['arrow destructured parameters', `const render = ({loader: require}) => require('./local');`, []],
  ['block lexical declarations before their declaration', `{ require('./local'); const require = x => x; } require('./real.cjs');`, ['./real.cjs']],
  ['hoisted var declarations', `function render() { require('./local'); if (false) { var require; } } require('./real.cjs');`, ['./real.cjs']],
  ['catch bindings', `try {} catch (require) { require.resolve('./local'); } finally { require('./real.cjs'); }`, ['./real.cjs']],
  ['loop bindings', `for (let require of loaders) { require('./local'); } require('./real.cjs');`, ['./real.cjs']],
  ['destructured block bindings', `{ const {loader: require} = registry; require('./local'); } require('./real.cjs');`, ['./real.cjs']],
  ['import bindings', `import {loader as require} from 'custom-loader'; require('./local');`, ['custom-loader']],
  ['function declarations', `require('./local'); function require(value) { return value; }`, []],
  ['class declarations', `class require {} require.resolve('./local');`, []],
  ['type-only names leave the runtime require visible', `type require = string; require('./real.cjs');`, ['./real.cjs'], true],
  ['ambient declarations do not hide the runtime loader', `declare const require: any; require('./real.cjs');`, ['./real.cjs'], true],
  ['parameter initializers do not see body var bindings', `function render(value = require('./real.cjs')) { var require; }`, ['./real.cjs']],
  ['parameter initializers retain an outer local binding', `function outer(require) { function inner(value = require('./local')) { var require; } }`, []],
  ['loader factories remain conservatively checked', `import {createRequire} from 'node:module'; const require = createRequire(import.meta.url); require('./real.cjs'); require.resolve('./other.cjs', {});`, ['node:module', './real.cjs', './other.cjs']],
  ['wrapped loader factories remain checked', `const require = ((factory()) as any)!; require('./real.cjs');`, ['./real.cjs'], true],
  ['dynamic imports remain checked inside shadowed scopes', `function render(require) { import('./real.js', {with: {type: 'json'}}); require('./local'); }`, ['./real.js']],
]) {
  test(`require scope: ${name}`, () => {
    for (const file of typeScriptOnly ? ['entry.ts'] : ['entry.ts', 'entry.js', 'entry.cjs']) {
      assert.deepEqual(parseImports(file, source).imports, expected, file);
    }
  });
}

test('shadowed require passes without hiding a real missing dependency', () => fixture(({root, put}) => {
  put('src/main.cjs', `function render(require) { require('./not-a-module.cjs'); }\nrequire('./real.cjs');`);
  let result = check(['src/main.cjs'], root);
  assert.equal(result.ok, false);
  assert.equal(result.importsChecked, 1);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].includes('./real.cjs'));
  put('src/real.cjs', 'module.exports = 1;');
  result = check(['src/main.cjs'], root);
  assert.equal(result.ok, true);
  assert.equal(result.files, 2);
  assert.equal(result.importsChecked, 1);
}));

for (const [name, file, source, expected] of [
  ['require with extra arguments', 'entry.cjs', `require('./missing.cjs', {});`, ['./missing.cjs']],
  ['parenthesized import argument', 'entry.js', `import(('./missing.js'));`, ['./missing.js']],
  ['wrapped import argument with options', 'entry.ts', `import(('./missing.json' as string), {with: {type: 'json'}});`, ['./missing.json']],
  ['parenthesized require and argument', 'entry.cjs', `((require))(('./missing.cjs'));`, ['./missing.cjs']],
  ['parenthesized require.resolve', 'entry.cjs', `(require.resolve)('./missing.cjs', {});`, ['./missing.cjs']],
  ['parenthesized resolve receiver', 'entry.cjs', `(require).resolve('./missing.cjs');`, ['./missing.cjs']],
  ['TypeScript wrapped loader', 'entry.ts', `((require as any)!)(('./missing.cjs' satisfies string));`, ['./missing.cjs']],
  ['wrapped factory loader', 'entry.ts', `const require = ((factory()) as any)!; (require)('./missing.cjs');`, ['./missing.cjs']],
  ['wrapped computed dependency stays unsupported', 'entry.js', `require((name)); import((name));`, []],
  ['wrapped local require stays excluded', 'entry.js', `function render(require) { (require)(('./local'), {}); (require).resolve(('./local')); }`, []],
  ['unrelated require property stays excluded', 'entry.js', `require.custom('./local');`, []],
]) {
  test(`literal call: ${name}`, () => {
    assert.deepEqual(parseImports(file, source).imports, expected);
  });
}

test('wrapped import and extra-argument require fail until both targets exist', () => fixture(({root, put}) => {
  put('src/main.js', `import(('./panel.js')); (require)(('./loader.cjs'), {});`);
  let result = check(['src/main.js'], root);
  assert.equal(result.ok, false);
  assert.equal(result.importsChecked, 2);
  assert.equal(result.failures.length, 2);
  put('src/panel.js', 'export const ready = true;');
  result = check(['src/main.js'], root);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].includes('./loader.cjs'));
  put('src/loader.cjs', 'module.exports = 1;');
  result = check(['src/main.js'], root);
  assert.equal(result.ok, true);
  assert.equal(result.files, 3);
  assert.equal(result.importsChecked, 2);
}));

test('CommonJS keeps query and fragment characters in filenames', () => fixture(({root, put}) => {
  put('src/main.cjs', `require('./actual.cjs?raw'); require.resolve('./actual.cjs#fragment');`);
  put('src/actual.cjs', 'module.exports = 1;');
  assert.equal(check(['src/main.cjs'], root).failures.length, 2);
  put('src/actual.cjs?raw', 'module.exports = 1;');
  put('src/actual.cjs#fragment', 'module.exports = 1;');
  assert.equal(check(['src/main.cjs'], root).ok, true);
}));

test('triple-slash bare paths are relative dependencies', () => fixture(({root, put}) => {
  put('src/main.ts', '/// <reference path="types.d.ts" />\nexport {};');
  let result = check(['src/main.ts'], root);
  assert.equal(result.ok, false);
  assert.equal(result.importsChecked, 1);
  put('src/types.d.ts', 'declare const value: string;');
  result = check(['src/main.ts'], root);
  assert.equal(result.ok, true);
  assert.equal(result.files, 2);
}));

test('triple-slash absolute paths cannot escape the root', () => fixture(({root, put}) => {
  put('src/main.ts', `/// <reference path="${path.join(root, '..', 'outside.d.ts')}" />`);
  const result = check(['src/main.ts'], root);
  assert.equal(result.ok, false);
  assert.equal(result.importsChecked, 1);
}));

test('filesystem root is a valid selected project root', () => fixture(({root, put}) => {
  const entry = put('main.js', 'export const x = 1;');
  assert.equal(check([entry], path.parse(root).root).ok, true);
}));

test('empty entrypoints must not report success', () => fixture(({root}) => {
  assert.equal(check([], root).ok, false);
}));

test('missing and non-directory roots produce structured failures', () => fixture(({root, put}) => {
  assert.equal(check(['main.js'], path.join(root, 'missing')).ok, false);
  const file = put('file.js', 'export {};');
  assert.equal(check(['main.js'], file).ok, false);
}));

test('a source read failure is reported without leaking an exception', () => fixture(({root, put}) => {
  const file = put('main.js', 'export {};');
  const read = fs.readFileSync;
  try {
    fs.readFileSync = (name, ...args) => {
      if (name === file) throw Object.assign(new Error('private diagnostic'), {code:'EACCES'});
      return read(name, ...args);
    };
    const result = check(['main.js'], root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(value => value.includes('EACCES')));
    assert.ok(!JSON.stringify(result).includes('private diagnostic'));
  } finally { fs.readFileSync = read; }
}));

test('CommonJS uses its own extension rules', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget.ts', 'export const x = 1;');
  assert.equal(check(['main.cjs'], root).ok, false);
  put('widget.js', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, true);
}));

test('CommonJS directory package main takes precedence over index', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget/package.json', '{"main":"entry.cjs"}');
  put('widget/entry.cjs', `require('./missing.cjs');`);
  put('widget/index.js', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, false);
  put('widget/missing.cjs', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, true);
}));

test('CommonJS package main cannot escape through a sibling or symlink', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget/package.json', '{"main":"../../private.cjs"}');
  put('widget/index.js', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, false);
}));

test('CommonJS directory cycles terminate and invalid manifests fail', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget/package.json', '{"main":"."}');
  assert.equal(check(['main.cjs'], root).ok, false);
  put('widget/index.js', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, true);
  put('widget/package.json', '{bad json');
  assert.equal(check(['main.cjs'], root).ok, false);
}));

test('dotted directory names resolve their index modules', () => fixture(({root, put}) => {
  put('main.js', `import './widget.v1';`);
  put('widget.v1/index.js', 'export const x = 1;');
  assert.equal(check(['main.js'], root).ok, true);
}));

test('computed literal resolve property is a real loader', () => fixture(({root, put}) => {
  put('main.cjs', `require['resolve']('./missing.cjs', {});`);
  assert.equal(check(['main.cjs'], root).ok, false);
  put('missing.cjs', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, true);
}));

test('malformed computed access reports syntax errors without throwing', () => fixture(({root, put}) => {
  put('main.js', `require[]('./missing.js');`);
  const result = check(['main.js'], root);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(value => value.includes('Parse error')));
}));

test('JSON dependencies must be valid JSON, including BOM handling', () => fixture(({root, put}) => {
  put('main.js', `import './data.json';`);
  put('data.json', '{private invalid contents');
  let result = check(['main.js'], root);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('private invalid contents'));
  put('data.json', '\uFEFF{"ready":true}');
  assert.equal(check(['main.js'], root).ok, true);
}));

test('package manifests accept a leading BOM', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget/package.json', '\uFEFF{"main":"entry.cjs"}');
  put('widget/entry.cjs', 'module.exports = 1;');
  assert.equal(check(['main.cjs'], root).ok, true);
}));

test('a package manifest symlink cannot expose outside source', () => fixture(({root, put}) => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'manifest-outside-'));
  try {
    put('main.cjs', `require('./widget');`);
    put('widget/index.js', 'module.exports = 1;');
    writeFileSync(path.join(outside,'package.json'), '{"main":"private.cjs"}');
    symlinkSync(path.join(outside,'package.json'), path.join(root,'widget/package.json'));
    assert.equal(check(['main.cjs'], root).ok, false);
  } finally { rmSync(outside,{recursive:true,force:true}); }
}));

test('missing package main falls back to index and cycles do not recurse', () => fixture(({root, put}) => {
  put('main.cjs', `require('./widget');`);
  put('widget/package.json', '{"main":"missing.cjs"}');
  put('widget/index.json', '{"ready":true}');
  assert.equal(check(['main.cjs'], root).ok, true);
}));

test('invalid API entrypoint shapes return structured failures', () => fixture(({root}) => {
  for (const entries of [undefined, null, 'main.js', [null], ['']]) {
    assert.equal(check(entries, root).ok, false);
  }
}));

test('checking a source never executes it', () => fixture(({root, put}) => {
  const marker = path.join(root, 'executed');
  put('main.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'oops');`);
  assert.equal(check(['main.cjs'], root).ok, true);
  assert.equal(fs.existsSync(marker), false);
}));

test('scope binding reads no config, library or imported source', () => {
  const read = fs.readFileSync;
  try {
    fs.readFileSync = () => { throw new Error('Unexpected filesystem read'); };
    assert.deepEqual(parseImports('entry.cjs', `function local(require) { require('./local'); } require('./real.cjs');`).imports, ['./real.cjs']);
  } finally { fs.readFileSync = read; }
});

test('package root exposes the same public API as its CLI module', () => {
  assert.equal(require('..').check, check);
  assert.equal(require('..').parseImports, parseImports);
});

function packageFixture(fn) {
  return fixture(({root, put}) => {
    const project = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    put('package.json', JSON.stringify(manifest));
    for (const name of manifest.files ?? ['index.cjs', 'scripts/check-package.cjs']) {
      put(name, fs.readFileSync(path.join(project, name), 'utf8'));
    }
    const run = () => spawnSync(process.execPath, ['scripts/check-package.cjs'], {
      cwd:root, encoding:'utf8', timeout:25000,
    });
    const pack = () => spawnSync('npm', ['pack', '--json'], {
      cwd:root, encoding:'utf8', timeout:25000,
    });
    return fn({root, put, run, pack});
  });
}

test('npm package allowlist excludes accidental private and temporary files', () => packageFixture(({put, run}) => {
  put('Home-private.jsx', '// generic private-source canary');
  put('runtime-data/memory.json', '{"fixture":"private-data-canary"}');
  put('debug-output.txt', 'temporary output');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
}));

test('package guard rejects npm-forced files outside the allowlist', () => packageFixture(({put, run}) => {
  put('README.private.md', 'generic private-file canary');
  const result = run();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('README.private.md'), result.stderr);
  assert.ok(!result.stderr.includes('generic private-file canary'));
}));

test('ordinary npm pack automatically blocks an unexpected forced file', () => packageFixture(({root, put, pack}) => {
  put('README.private.md', 'generic private-file canary');
  const result = pack();
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('README.private.md'), result.stderr);
  assert.ok(!fs.readdirSync(root).some(file => file.endsWith('.tgz')));
}));

test('package guard rejects a missing required runtime file', () => packageFixture(({root, run}) => {
  rmSync(path.join(root, 'index.cjs'));
  const result = run();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('index.cjs'), result.stderr);
}));

test('package guard never echoes malformed manifest contents', () => packageFixture(({put, run}) => {
  put('package.json', 'generic-private-canary');
  const result = run();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.split(/\r?\n/).includes('Invalid JSON in package manifest or npm preview'));
  assert.ok(!result.stderr.includes('generic-private-canary'));
}));
