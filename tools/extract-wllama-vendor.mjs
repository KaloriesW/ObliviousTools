'use strict';
/* Extract the proven wllama 3.13.0 runtime bundle (ESM source string + gz'd wasm)
   from the reference build into src/vendor/wllama-vendor.js.
   Usage: node tools/extract-wllama-vendor.mjs /path/to/reference/whisker.html */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const refPath = process.argv[2];
if (!refPath) {
  console.error('usage: node tools/extract-wllama-vendor.mjs <reference whisker.html>');
  process.exit(1);
}
const html = readFileSync(refPath, 'utf8');
const srcM = html.match(/const WLLAMA_SRC = ("(?:[^"\\]|\\.)*");/);
const gzM = html.match(/const WASM_GZ_B64 = ("(?:[^"\\]|\\.)*");/);
if (!srcM || !gzM) {
  console.error('runtime strings not found in reference file');
  process.exit(1);
}
const out = `'use strict';\n/* wllama 3.13.0 runtime bundle, vendored from a proven single-file build.\n   Regenerate: node tools/extract-wllama-vendor.mjs <reference whisker.html> */\nwindow.__WLLAMA_SRC = ${srcM[1]};\nwindow.__WLLAMA_WASM_GZ = ${gzM[1]};\n`;
writeFileSync(resolve(ROOT, 'src/vendor/wllama-vendor.js'), out);
console.log('wrote src/vendor/wllama-vendor.js —', (out.length / 1e6).toFixed(1), 'MB');
