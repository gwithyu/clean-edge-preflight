# Clean Edge Preflight 0.1.0

A read-only static local-dependency preflight for JS, JSX, TS, TSX and CommonJS projects. It parses source without executing it, follows supported local edges, and reports missing files, syntax errors, invalid JSON and root-boundary violations.

## Run

Requires Node.js 20 or newer, npm and Git.

Clone and verify the tool:

```sh
git clone https://github.com/gwithyu/clean-edge-preflight.git
cd clean-edge-preflight
npm ci --ignore-scripts
npm test
npm run verify:package
```

From the project you want to check:

```sh
node /absolute/path/to/clean-edge-preflight/index.cjs src/main.jsx
```

### Use in your project

From your own project's root directory, install the verified 0.1.0 source snapshot directly from GitHub:

```sh
npm install --save-dev --ignore-scripts git+https://github.com/gwithyu/clean-edge-preflight.git#55aeb3b00bbee2c85c45321d1a99a8d36b8c4f65
npx --no-install clean-edge src/main.jsx
```

The Git dependency is pinned to the verified commit. Direct installation, API import and local npx exits 0/1/2 have been checked in a separate project. The package is not published to the npm registry.

To use the installed API:

```js
const { check } = require('clean-edge-preflight');
const result = check(['src/main.jsx']);
console.log(result);
process.exitCode = result.ok ? 0 : 1;
```

### Build a local tarball

To install the CLI locally, run `npm pack` in the tool directory and install that generated tarball in your project. An automatic prepack guard checks the actual npm file list against the explicit allowlist and stops on missing or unexpected files. This includes npm-forced README/LICENSE files that a files list alone cannot exclude. The npm package is not publicly published.

Exit codes: `0` supported checks pass, `1` a check fails, `2` no CLI entrypoints. Results are JSON on stdout; the no-argument usage message is on stderr. Invalid API arguments and root/read failures return structured failure results.

The installed package also exposes `check(entrypoints, root)` and `parseImports(file, source)` through `require('clean-edge-preflight')`. Existing parseImports imports/errors fields remain; dependencies additionally records import/require/reference kinds. The optional fourth resolveLocal argument selects that same kind (default import).

## Supported checks

- Static imports/re-exports, literal dynamic imports (including options), CommonJS require/require.resolve, literal resolve property access, TypeScript import-equals/import types and triple-slash path references.
- Parentheses and TypeScript expression wrappers, and extra require arguments, do not hide literal dependencies.
- Lexical require scope binding, including default-parameter environments, preserves real CommonJS globals, ambient declarations and factory-created loaders.
- Import query/hash suffixes are stripped; CommonJS and reference filenames retain those characters. Bare triple-slash reference paths are relative to their source.
- CommonJS extension lookup uses .js/.json/.node and directory package.json main/index rules. The import resolver supports common JS/TS extensions and directory indexes, including dotted directory names.
- JSON dependencies and package manifests are validated, including leading BOMs. File, manifest and main targets stay within the selected root; symlink cycles terminate.
- The parser's scope binder reads no tsconfig, libraries or imported source. Source is never executed or modified, and the scanner makes no network calls.

## Scope

`ok: true` means these supported static checks passed. It is not a compiler, security audit, runtime test or proof of universal bundler equivalence. Always run the original project's own build and tests.

Package specifiers, project aliases, computed imports, CSS imports, loader aliases/reassignment and custom createRequire base paths are outside this tool's resolution scope. Factory-initialized require bindings are conservatively treated as possible loaders, so custom factories can produce false positives. TypeScript checking is syntactic, not a full semantic type check. The import resolver intentionally approximates common bundler source resolution.

## Verification

See VERIFICATION.md. All 80 tests pass independently on Node 20.20.2, 22.23.5 and 24.22.1 with locked TypeScript 5.9.3, and on Node 24 with TypeScript 5.8.3. The original private Home frontend passed both preflight and its original Vite build; an injected missing dependency failed in both. No private source or data is included here.

## License and attribution

Original code: MIT (LICENSE). Independently inspired by [Ponytail](https://github.com/DietrichGebert/ponytail), an unrelated MIT-licensed project by DietrichGebert; no Ponytail source is included.

The official TypeScript dependency is Apache-2.0 licensed: https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt. It is installed separately and not bundled.

Source: https://github.com/gwithyu/clean-edge-preflight (MIT). The package retains private: true and is not published to npm. The original Home project stays private; no Home merge or deployment is part of this release.
