#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.d.ts', '.d.mts', '.d.cts', '.json', '.css'];
const CODE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

function unwrapExpression(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function isFileInside(root, candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    return within(root, fs.realpathSync(candidate));
  } catch {
    return false;
  }
}

function resolveLocal(root, importer, specifier, kind = 'import') {
  const cleaned = kind === 'import' ? specifier.split(/[?#]/, 1)[0] : specifier;
  const target = path.resolve(path.dirname(importer), cleaned);
  if (!within(root, target)) return null;
  const extensions = kind === 'require' ? ['.js', '.json', '.node'] : EXTENSIONS;
  const files = value => path.extname(value) ? [value] : [value, ...extensions.map(ext => value + ext)];
  const indexes = value => extensions.filter(ext => kind === 'require' || CODE.has(ext)).map(ext => path.join(value, 'index' + ext));
  function pick(choices) {
    for (const candidate of choices) {
      if (!within(root, candidate) || (fs.existsSync(candidate) && !within(root, fs.realpathSync(candidate)))) {
        throw Object.assign(new Error('Outside project'), {code:'OUTSIDE_PROJECT'});
      }
      if (isFileInside(root, candidate)) return candidate;
    }
    return null;
  }
  const file = pick(files(target));
  if (file) return file;
  if (kind === 'require') {
    const manifest = pick([path.join(target, 'package.json')]);
    if (manifest) {
      let config;
      try { config = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')); }
      catch (error) { throw Object.assign(error, {code:error.code ?? 'INVALID_PACKAGE_JSON'}); }
      if (config && typeof config.main === 'string' && config.main) {
        const main = path.resolve(target, config.main);
        const resolved = pick(files(main)) || pick(indexes(main));
        if (resolved) return resolved;
      }
    }
  }
  return pick(indexes(target));
}

function parseImports(file, source) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX
    : file.endsWith('.jsx') ? ts.ScriptKind.JSX
    : /\.(?:ts|mts|cts)$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const parsed = ts.createSourceFile(path.resolve(file), source, ts.ScriptTarget.Latest, true, kind);
  // transpileModule cannot emit declaration-only files; parse those without emitting.
  const declaration = /\.d\.(?:ts|mts|cts)$/.test(file);
  const diagnostics = declaration ? parsed.parseDiagnostics : (ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, checkJs: true, jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).diagnostics ?? []);
  const errors = diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  const imports = [];
  const dependencies = [];
  function addImport(specifier, kind = 'import') {
    imports.push(specifier);
    dependencies.push({specifier, kind});
  }
  for (const reference of parsed.referencedFiles) addImport(reference.fileName, 'reference');
  for (const statement of parsed.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      addImport(statement.moduleSpecifier.text);
    }
  }
  let checker;
  function isLoader(identifier) {
    // Bind only this in-memory source; never read configs, libraries or imported files.
    checker ??= ts.createProgram([parsed.fileName], { allowJs: true, noLib: true, noResolve: true }, {
      getSourceFile: name => name === parsed.fileName ? parsed : undefined,
      getDefaultLibFileName: () => '',
      writeFile: () => {},
      getCurrentDirectory: () => path.dirname(parsed.fileName),
      getCanonicalFileName: name => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: name => name === parsed.fileName,
      readFile: () => undefined,
    }).getTypeChecker();
    let symbol = checker.getSymbolAtLocation(identifier);
    // Default parameters cannot see var declarations inside their function body.
    for (let node = identifier.parent; node; node = node.parent) {
      const body = ts.isParameter(node) && node.parent.body;
      const declaration = symbol?.valueDeclaration;
      if (body && declaration && declaration.pos >= body.pos && declaration.end <= body.end) {
        symbol = checker.resolveName('require', node.parent.parent, ts.SymbolFlags.Value | ts.SymbolFlags.Alias, false);
      }
    }
    const initializer = unwrapExpression(symbol?.valueDeclaration?.initializer);
    // shortcut: factory calls may create real loaders; keep checking until loader provenance is modeled.
    return !symbol?.declarations?.length
      || symbol.declarations.every(declaration => ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient)
      || !!(initializer && ts.isCallExpression(initializer));
  }
  // Follow literal dynamic imports and CommonJS requires; computed paths belong to the bundler.
  function walk(node) {
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const expression = unwrapExpression(node.expression);
      const argument = unwrapExpression(node.arguments[0]);
      const key = ts.isElementAccessExpression(expression) && unwrapExpression(expression.argumentExpression);
      const resolve = (ts.isPropertyAccessExpression(expression) && expression.name.text === 'resolve')
        || (key && ts.isStringLiteralLike(key) && key.text === 'resolve');
      const loader = resolve
        ? unwrapExpression(expression.expression) : expression;
      if (ts.isStringLiteralLike(argument)
        && (expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(loader) && loader.text === 'require' && isLoader(loader)))) {
        addImport(argument.text, expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : 'require');
      }
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)) {
      addImport(node.argument.literal.text);
    }
    if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
      addImport(node.moduleReference.expression.text, 'require');
    }
    ts.forEachChild(node, walk);
  }
  walk(parsed);
  return { imports, errors, dependencies };
}

function check(entrypoints, root = process.cwd()) {
  const invalid = message => ({ ok: false, files: 0, importsChecked: 0, failures: [message] });
  if (!Array.isArray(entrypoints) || !entrypoints.length || entrypoints.some(file => typeof file !== 'string' || !file)) {
    return invalid('At least one nonempty entrypoint is required');
  }
  try {
    root = fs.realpathSync(root);
    if (!fs.statSync(root).isDirectory()) return invalid('Project root is not a directory');
  } catch (error) { return invalid(`Cannot access project root: ${error.code ?? 'filesystem error'}`); }
  const pending = entrypoints.map(file => path.resolve(root, file));
  const visited = new Set();
  const failures = [];
  let edges = 0;
  while (pending.length) {
    const candidate = pending.pop();
    const relative = path.relative(root, candidate);
    if (!isFileInside(root, candidate)) {
      failures.push(`Missing or outside project: ${relative}`);
      continue;
    }
    // Canonicalize before deduplication so in-project symlink cycles terminate.
    const file = fs.realpathSync(candidate);
    if (visited.has(file)) continue;
    visited.add(file);
    const extension = path.extname(file);
    if (!CODE.has(extension) && extension !== '.json') continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); }
    catch (error) {
      failures.push(`Cannot read ${relative}: ${error.code ?? 'filesystem error'}`);
      continue;
    }
    if (extension === '.json') {
      try { JSON.parse(source.replace(/^\uFEFF/, '')); }
      catch { failures.push(`Invalid JSON in ${relative}`); }
      continue;
    }
    const { dependencies, errors } = parseImports(file, source);
    for (const error of errors) failures.push(`Parse error in ${relative}: ${error}`);
    for (const {specifier, kind} of dependencies) {
      if (kind !== 'reference' && !/^\.{1,2}(?:[/\\]|$)/.test(specifier)) continue;
      edges++;
      try {
        const target = resolveLocal(root, file, specifier, kind);
        if (!target) failures.push(`Missing or outside project: ${relative} -> ${specifier}`);
        else pending.push(target);
      } catch (error) { failures.push(`Cannot resolve ${relative} -> ${specifier}: ${error.code ?? 'filesystem error'}`); }
    }
  }
  return { ok: failures.length === 0, files: visited.size, importsChecked: edges, failures };
}

if (require.main === module) {
  const entrypoints = process.argv.slice(2);
  if (!entrypoints.length) {
    console.error('Usage: node index.cjs <entry.js|entry.jsx> [more entry files...]');
    process.exitCode = 2;
  } else {
    const result = check(entrypoints);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}

module.exports = { check, parseImports, resolveLocal };
