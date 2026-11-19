'use strict';
/* Whisker e2e over HTTP with a real (tiny) GGUF model.
   Requires /tmp/stories260K.gguf — download:
   curl -L -o /tmp/stories260K.gguf https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories260K.gguf */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = '/tmp/stories260K.gguf';
if (!existsSync(MODEL)) {
  console.log('SKIP — no test model at ' + MODEL);
  process.exit(0);
}

const server = spawn('python3', ['-m', 'http.server', '8901', '--directory', resolve(ROOT, 'dist')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const fails = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' — ' + (detail || '')));
  if (!ok) fails.push(name);
}

try {
  await page.goto('http://localhost:8901/whisker.html');
  await page.waitForTimeout(500);

  // 1. load the real model through the actual UI
  const fcP = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await page.click('.wh-model-add');
  const fc = await fcP;
  check('gate: add-model picker opens', !!fc);
  await fc.setFiles({ name: 'stories260K.gguf', mimeType: 'application/octet-stream', buffer: readFileSync(MODEL) });
  await page.waitForFunction(() => document.querySelector('#wh-gate').classList.contains('ob-hidden'), null, { timeout: 30000 });
  check('model loads through UI', true);

  // 2. generate a completion
  await page.fill('#wh-input', 'Once upon a time');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.wh-msg-assistant:not(.wh-streaming)', { timeout: 30000 });
  const gen = await page.locator('.wh-msg-assistant').first().textContent();
  check('generation streams and completes', gen && gen.trim().length > 0, 'got: ' + JSON.stringify((gen || '').slice(0, 40)));

  // 3. QoL buttons present
  const buttons = await page.locator('.wh-msg-assistant .wh-msg-actions button').allTextContents();
  check('assistant actions: copy + retry', buttons.includes('copy') && buttons.includes('retry'), JSON.stringify(buttons));
  const userBtns = await page.locator('.wh-msg-user .wh-msg-actions button').allTextContents();
  check('user actions: copy + edit', userBtns.includes('copy') && userBtns.includes('edit'), JSON.stringify(userBtns));

  // 4. stop button: send becomes stop while generating, clicking stops
  await page.fill('#wh-input', 'Tell me a long long long story');
  await page.keyboard.press('Enter');
  const stopShown = await page.waitForFunction(
    () => document.querySelector('#wh-send').classList.contains('busy'),
    null, { timeout: 5000, polling: 25 }
  ).then(() => true).catch(() => false);
  await page.click('#wh-send');
  const stopped = await page.waitForFunction(
    () => !document.querySelector('#wh-send').classList.contains('busy'),
    null, { timeout: 8000, polling: 50 }
  ).then(() => true).catch(() => false);
  check('stop button works', stopShown && stopped, 'stopShown=' + stopShown + ' stopped=' + stopped);

  // 5. retry: regenerate an earlier message
  const retryCount = await page.locator('.wh-msg-assistant .wh-msg-actions button:has-text("retry")').count();
  check('retry buttons on assistant messages', retryCount >= 1, 'count: ' + retryCount);

  // 6. artifact creation
  await page.click('#wh-artifact-new');
  await page.waitForSelector('.wh-artifact-panel', { timeout: 3000 });
  const hasEditor = await page.locator('.wh-artifact-src').count();
  check('artifact editor opens with source', hasEditor === 1);
  await page.fill('.wh-artifact-src', '<!DOCTYPE html><html><body><h1 id="t">made by whisker</h1></body></html>');
  await page.click('.wh-artifact-editor-foot [data-a=done]');
  await page.waitForTimeout(600);
  const frame = page.locator('.wh-artifact-view iframe');
  check('artifact live preview renders', await frame.count() === 1);

  // 7. attachment flow (image)
  const attachChooserP = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
  await page.click('#wh-attach-inline');
  const ac = await attachChooserP;
  if (ac) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await ac.setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(400);
    const chip = await page.locator('#wh-attach-row .wh-attach-chip').count();
    check('attachment chip appears', chip === 1, 'chips: ' + chip);
    await page.fill('#wh-input', 'look at this');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const img = await page.locator('.wh-msg .wh-attach-img').count();
    check('image attachment renders in message', img >= 1, 'imgs: ' + img);
  } else {
    check('attachment picker opens', false);
  }

  // 8. file:// — the whole point: model must load + generate with zero network
  const filePage = await (await browser.newContext()).newPage();
  const fileErrors = [];
  filePage.on('pageerror', (e) => fileErrors.push(e.message));
  await filePage.goto('file://' + resolve(ROOT, 'dist/whisker.html'));
  await filePage.waitForTimeout(400);
  const fileFcP = filePage.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await filePage.click('.wh-model-add');
  const fileFc = await fileFcP;
  check('file:// picker opens', !!fileFc);
  if (fileFc) {
    await fileFc.setFiles({ name: 'stories260K.gguf', mimeType: 'application/octet-stream', buffer: readFileSync(MODEL) });
    const loaded = await filePage.waitForFunction(
      () => document.querySelector('#wh-gate').classList.contains('ob-hidden'),
      null, { timeout: 60000, polling: 100 }
    ).then(() => true).catch(() => false);
    check('file:// model loads (offline engine)', loaded);
    if (loaded) {
      await filePage.fill('#wh-input', 'Once upon a time');
      await filePage.keyboard.press('Enter');
      const done = await filePage.waitForSelector('.wh-msg-assistant:not(.wh-streaming)', { timeout: 60000 }).then(() => true).catch(() => false);
      const text = done ? await filePage.locator('.wh-msg-assistant').first().textContent() : '';
      check('file:// generation completes', done && text && text.trim().length > 0, 'got: ' + JSON.stringify((text || '').slice(0, 40)));
    }
  }
  check('file:// no page errors', fileErrors.length === 0, fileErrors.slice(0, 3).join(' | '));
  await filePage.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

console.log('\n' + (fails.length ? fails.length + ' FAILURES: ' + fails.join(', ') : 'WHISKER E2E ALL PASS'));
process.exit(fails.length ? 1 : 0);
