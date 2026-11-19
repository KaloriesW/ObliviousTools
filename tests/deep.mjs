'use strict';
/* Deep interaction tests: real flows in each app via headless Chromium. */
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const fails = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' — ' + (detail || '')));
  if (!ok) fails.push(name);
}

/* tiny valid WAV (0.1s silence) */
function makeWav() {
  const sr = 8000, n = 800;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(0, 44 + i * 2);
  return buf;
}

/* ---------- Core: full encrypt/decrypt roundtrip in page ---------- */
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + resolve(ROOT, 'dist/index.html'));
  const ok = await page.evaluate(async () => {
    const box = await OB.crypto.encrypt('roundtrip-pw', 'secret payload 123', { name: 'x.bin' });
    const { payload, meta } = await OB.crypto.decrypt('roundtrip-pw', box);
    return new TextDecoder().decode(payload) === 'secret payload 123' && meta.name === 'x.bin';
  });
  check('core: in-page crypto roundtrip', ok && errors.length === 0, errors.join('; '));
  await page.close();
}

/* ---------- Pocketknife: sheets formula, docs toolbar, slides insert ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + resolve(ROOT, 'dist/pocketknife.html'));
  await page.click('#pk-new'); // doc editor
  await page.waitForSelector('.pk-paper');
  await page.type('.pk-paper', 'one two three');
  await page.waitForTimeout(400);
  const counts = await page.textContent('.pk-counts');
  check('pk: docs word count', /3 words/.test(counts), 'got: ' + counts);

  await page.click('#pk-tabs button[data-kind="sheet"]');
  await page.click('#pk-new');
  await page.waitForSelector('.pk-grid td');
  // click cell A1 (first td), type formula, Enter
  await page.click('.pk-grid td[data-r="0"][data-c="0"]');
  await page.keyboard.type('=1+2*3');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const a1 = await page.textContent('.pk-grid td[data-r="0"][data-c="0"]');
  check('pk: formula evaluates =1+2*3 -> 7', a1.trim() === '7', 'got: ' + a1);
  // formula bar shows raw
  await page.click('.pk-grid td[data-r="0"][data-c="0"]');
  const fx = await page.inputValue('.pk-fx-input');
  check('pk: formula bar shows raw', fx === '=1+2*3', 'got: ' + fx);

  await page.click('#pk-tabs button[data-kind="deck"]');
  await page.click('#pk-new');
  await page.waitForSelector('.pk-slide');
  await page.click('.pk-format .ob-btn:has-text("Text box")');
  await page.waitForTimeout(300);
  const els = await page.locator('.pk-slide .pk-el').count();
  check('pk: slides insert text box', els === 1, 'got ' + els + ' elements');
  check('pk: no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
}

/* ---------- Whisker: message render + markdown ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + resolve(ROOT, 'dist/whisker.html'));
  await page.waitForTimeout(400);
  await page.click('.wh-gate-skip');
  await page.fill('#wh-input', 'hello **markdown** world');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const userText = await page.locator('.wh-user-bubble').first().textContent().catch(() => null);
  check('whisker: user message renders', userText === 'hello **markdown** world', 'got: ' + userText);
  const md = await page.evaluate(() => {
    const html = OB.md.render('# Title\n\n**bold** and `code`\n\n- a\n- b\n\n```js\nlet x = 1;\n```');
    return { h1: html.includes('<h1>Title</h1>'), bold: html.includes('<strong>bold</strong>'), code: html.includes('<pre><code>'), li: html.includes('<li>a</li>') };
  });
  check('whisker: markdown renderer', md.h1 && md.bold && md.code && md.li, JSON.stringify(md));
  check('whisker: no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
}

/* ---------- Wire: add track, play, MediaSession metadata ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + resolve(ROOT, 'dist/wire.html'));
  await page.waitForTimeout(400);
  const chooserP = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
  await page.click('#wr-add-music');
  const chooser = await chooserP;
  check('wire: file picker opens', !!chooser);
  if (chooser) {
    await chooser.setFiles({ name: 'Test Artist - Test Song.wav', mimeType: 'audio/wav', buffer: makeWav() });
    await page.waitForTimeout(600);
    const cards = await page.locator('.wr-card').count();
    check('wire: track card appears on Home', cards >= 1, 'cards: ' + cards);
    if (cards) {
      await page.click('.wr-card-play');
      await page.waitForTimeout(1200);
      const title = await page.textContent('#wr-bar-title');
      check('wire: playback starts + bar updates', title.includes('Test Song'), 'title: ' + title);
      const meta = await page.evaluate(() => (navigator.mediaSession && navigator.mediaSession.metadata) ? navigator.mediaSession.metadata.title : null);
      check('wire: MediaSession metadata set', meta === 'Test Song', 'meta: ' + meta);
    }
  }
  check('wire: no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
}

await browser.close();
console.log('\n' + (fails.length ? fails.length + ' FAILURES: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
