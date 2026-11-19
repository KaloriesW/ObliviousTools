'use strict';
/* Minimal file:// harness using the runtime extracted from the user's working build. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync('/Users/Kaleb/Projects/Oblivious/dist/whisker.html', 'utf8');
const src = html.match(/const WLLAMA_SRC = ("(?:[^"\\]|\\.)*");/)[1];
const gz = html.match(/const WASM_GZ_B64 = ("(?:[^"\\]|\\.)*");/)[1];
const model = readFileSync('/tmp/stories260K.gguf');

const harness = `<!DOCTYPE html><html><body><script>
const WLLAMA_SRC = ${src};
const WASM_GZ_B64 = ${gz};
let inst = null;
window.loadAndChat = async (modelB64) => {
  const bytes = Uint8Array.from(atob(WASM_GZ_B64), c => c.charCodeAt(0));
  const gz = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const wasmBuf = await new Response(gz).arrayBuffer();
  const wasmUrl = URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' }));
  const mod = await import(URL.createObjectURL(new Blob([WLLAMA_SRC], { type: 'text/javascript' })));
  const noop = () => new Proxy({}, { get: () => async () => { throw new Error('disabled'); } });
  const w = new mod.Wllama({ default: wasmUrl }, { suppressNativeLog: true, cacheManager: noop(), modelManager: noop() });
  w.setCompat(null);
  const bin = Uint8Array.from(atob(modelB64), c => c.charCodeAt(0));
  await w.loadModel([new Blob([bin])], { n_ctx: 512, n_threads: 1, jinja: true, n_gpu_layers: 0 });
  inst = w;
  let out = '';
  await w.createChatCompletion({ messages: [{ role: 'user', content: 'Once upon a time' }], max_tokens: 12, temperature: 0.5, stream: true, onData: (c) => { out += (c.choices?.[0]?.delta?.content || ''); } });
  return 'GENERATED: ' + JSON.stringify(out.slice(0, 50));
};
<\/script></body></html>`;
writeFileSync('/tmp/harness.html', harness);

for (const headless of [true, false]) {
  const browser = await chromium.launch({ headless });
  const page = await (await browser.newContext()).newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text().slice(0, 160)));
  page.on('pageerror', (e) => logs.push('[PAGEERROR] ' + e.message));
  await page.goto('file:///tmp/harness.html');
  await page.waitForTimeout(300);
  const result = await page.evaluate((b64) => window.loadAndChat(b64).catch((e) => 'FAIL: ' + (e && (e.message || e))), model.toString('base64'));
  console.log('headless=' + headless + ' ->', String(result).slice(0, 120));
  logs.slice(0, 5).forEach((l) => console.log('   ', l));
  await browser.close();
}
