'use strict';
/* Probe: does blob-URL wasm make wllama work from file:// ? */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WASM_B64 = readFileSync('/tmp/wllama-st.wasm').toString('base64');
const MODEL_B64 = readFileSync('/tmp/stories260K.gguf').toString('base64');

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on('console', (m) => console.log('  [' + m.type() + ']', m.text().slice(0, 160)));
page.on('pageerror', (e) => console.log('  [PAGEERROR]', e.message));

await page.goto('about:blank');
const result = await page.evaluate(async ({ wasmB64, modelB64 }) => {
  try {
    const bin = Uint8Array.from(atob(wasmB64), (c) => c.charCodeAt(0));
    const wasmUrl = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }));
    const BASE = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/esm';
    const { Wllama } = await import(BASE + '/index.js');
    const w = new Wllama({
      'single-thread/wllama.wasm': wasmUrl,
      'multi-thread/wllama.wasm': BASE + '/multi-thread/wllama.wasm',
    });
    const modelBin = Uint8Array.from(atob(modelB64), (c) => c.charCodeAt(0));
    await w.loadModel([new Blob([modelBin])], { n_ctx: 512, n_threads: 1 });
    const out = await w.createCompletion('Once upon a time', { nPredict: 12, sampling: { temp: 0.5 } });
    return 'OK — generated: ' + JSON.stringify(out.slice(0, 60));
  } catch (e) {
    return 'FAIL — ' + e.message;
  }
}, { wasmB64: WASM_B64, modelB64: MODEL_B64 });

console.log('file:// blob-wasm result:', result);
await browser.close();
