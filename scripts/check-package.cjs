#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

try {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length
    || manifest.files.some(file => typeof file !== 'string' || !file || /[*?]/.test(file))) {
    throw new Error('package.json files must be an explicit file allowlist');
  }
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const packed = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], {cwd:root, encoding:'utf8', timeout:20000})
    : spawnSync('npm', args, {cwd:root, encoding:'utf8', timeout:20000, shell:process.platform === 'win32'});
  if (packed.error || packed.status !== 0) throw new Error('npm package preview failed');
  const preview = JSON.parse(packed.stdout);
  if (!Array.isArray(preview) || preview.length !== 1 || !Array.isArray(preview[0].files)) {
    throw new Error('Invalid npm package preview');
  }
  const actual = preview[0].files.map(file => file.path).sort();
  const expected = [...new Set(['package.json', ...manifest.files])].sort();
  const extra = actual.filter(file => !expected.includes(file));
  const missing = expected.filter(file => !actual.includes(file));
  if (extra.length || missing.length) {
    throw new Error(`Package file mismatch; unexpected: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`);
  }
  if (process.env.npm_lifecycle_event !== 'prepack') {
    console.log(JSON.stringify({ok:true, files:actual.length, version:manifest.version}));
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid JSON in package manifest or npm preview' : error.message);
  process.exitCode = 1;
}
