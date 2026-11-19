'use strict';
/* Headless smoke test: loads each dist app, captures console/page errors and screenshots. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

async function newPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  return { ctx, page, errors, name };
}

async function report(r, label) {
  results.push({ app: r.name, step: label, errors: r.errors.slice() });
  console.log('--- ' + r.name + ' / ' + label + ': ' + (r.errors.length ? r.errors.length + ' errors' : 'clean'));
  r.errors.forEach((e) => console.log('    ' + e.split('\n')[0]));
  r.errors.length = 0;
}

/* ---------- Core ---------- */
{
  const r = await newPage('core');
  await r.page.goto('file://' + resolve(ROOT, 'dist/index.html'));
  await r.page.waitForTimeout(400);
  await r.page.screenshot({ path: OUT + '/core-home.png' });
  await report(r, 'home');

  await r.page.click('#open-core');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: OUT + '/core-app.png' });

  // encrypt flow via drop
  await r.page.setInputFiles('#enc-drop input', { name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from('top secret contents') })
    .catch(async () => {
      // dropzone uses pickFiles on click -> hidden input appended; fallback: dispatch drop
      const dt = await r.page.evaluateHandle(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['top secret contents'], 'secret.txt', { type: 'text/plain' }));
        return dt;
      });
      await r.page.dispatchEvent('#enc-drop', 'drop', { dataTransfer: dt });
    });
  await r.page.waitForTimeout(300);
  await r.page.fill('#enc-pw', 'test1234');
  await r.page.fill('#enc-pw2', 'test1234');
  await r.page.click('#enc-go');
  await r.page.waitForTimeout(2500);
  await r.page.screenshot({ path: OUT + '/core-encrypted.png' });
  const hasResult = await r.page.locator('#enc-result .result-card').count();
  results.push({ app: 'core', step: 'encrypt-result-card', errors: hasResult ? [] : ['no result card after encrypt'] });
  await report(r, 'encrypt flow');
  await r.ctx.close();
}

/* ---------- Pocketknife ---------- */
{
  const r = await newPage('pocketknife');
  await r.page.goto('file://' + resolve(ROOT, 'dist/pocketknife.html'));
  await r.page.waitForTimeout(400);
  await r.page.screenshot({ path: OUT + '/pk-library.png' });
  await report(r, 'library');

  await r.page.click('#pk-new');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: OUT + '/pk-doc.png' });
  await r.page.type('.pk-paper', 'Hello Pocketknife doc');
  await report(r, 'docs editor');

  await r.page.click('#pk-tabs button[data-kind="sheet"]');
  await r.page.waitForTimeout(300);
  await r.page.click('#pk-new');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: OUT + '/pk-sheet.png' });
  const td = await r.page.locator('.pk-grid td').count();
  results.push({ app: 'pocketknife', step: 'sheet-grid', errors: td > 100 ? [] : ['grid cells missing: ' + td] });
  await report(r, 'sheets editor');

  await r.page.click('#pk-tabs button[data-kind="deck"]');
  await r.page.waitForTimeout(200);
  await r.page.click('#pk-new');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: OUT + '/pk-slides.png' });
  await report(r, 'slides editor');
  await r.ctx.close();
}

/* ---------- Whisker ---------- */
{
  const r = await newPage('whisker');
  await r.page.goto('file://' + resolve(ROOT, 'dist/whisker.html'));
  await r.page.waitForTimeout(500);
  await r.page.screenshot({ path: OUT + '/whisker-gate.png' });
  const gateVisible = await r.page.locator('#wh-gate:not(.ob-hidden)').count();
  results.push({ app: 'whisker', step: 'gate-visible', errors: gateVisible ? [] : ['gate not visible'] });
  await report(r, 'gate');

  await r.page.click('.wh-gate-skip');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: OUT + '/whisker-chat.png' });
  await r.page.fill('#wh-input', 'hello whisker');
  await r.page.keyboard.press('Enter');
  await r.page.waitForTimeout(800);
  await r.page.screenshot({ path: OUT + '/whisker-sent.png' });
  const userMsg = await r.page.locator('.wh-msg-user').count();
  results.push({ app: 'whisker', step: 'user-message-rendered', errors: userMsg ? [] : ['user message not rendered'] });
  await report(r, 'chat send (no model)');
  await r.ctx.close();
}

/* ---------- Wire ---------- */
{
  const r = await newPage('wire');
  await r.page.goto('file://' + resolve(ROOT, 'dist/wire.html'));
  await r.page.waitForTimeout(500);
  await r.page.screenshot({ path: OUT + '/wire-home.png' });
  await report(r, 'welcome');

  // inject local track via evaluate + play
  await r.page.evaluate(async () => {
    const ctx = new AudioContext();
    return ctx.state;
  }).catch(() => {});
  await r.page.click('.wr-nav-item[data-view="search"]');
  await r.page.waitForTimeout(200);
  await r.page.screenshot({ path: OUT + '/wire-search.png' });
  await report(r, 'search view');
  await r.ctx.close();
}

await browser.close();

let bad = 0;
console.log('\n========== SUMMARY ==========');
for (const res of results) {
  if (res.errors.length) {
    bad++;
    console.log('FAIL ' + res.app + '/' + res.step);
    res.errors.forEach((e) => console.log('   ' + e));
  } else {
    console.log('PASS ' + res.app + '/' + res.step);
  }
}
process.exit(bad ? 1 : 0);
