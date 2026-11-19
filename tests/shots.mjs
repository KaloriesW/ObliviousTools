'use strict';
/* Capture rich UI-state screenshots for visual review. */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

function makeWav() {
  const sr = 8000, n = 8000;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(i / 12)), 44 + i * 2);
  return buf;
}

const browser = await chromium.launch();

/* ---------- Core ---------- */
{
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/index.html'));
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/1-core-home.png' });
  await p.click('#open-core');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/2-core-encrypt.png' });
  await p.close();
}

/* ---------- Pocketknife ---------- */
{
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/pocketknife.html'));
  await p.waitForTimeout(400);
  await p.click('#pk-new');
  await p.waitForSelector('.pk-paper');
  await p.click('.pk-paper');
  await p.keyboard.type('Quarterly Report', { delay: 10 });
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.keyboard.type('This document covers the highlights of the quarter, including revenue growth, product milestones and hiring.');
  await p.evaluate(() => { document.execCommand('formatBlock', false, 'h1'); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/3-pk-docs.png' });

  await p.click('#pk-tabs button[data-kind="sheet"]');
  await p.click('#pk-new');
  await p.waitForSelector('.pk-grid');
  for (const [cell, val] of [['A1', 'Item'], ['B1', 'Qty'], ['C1', 'Price'], ['D1', 'Total'],
    ['A2', 'Widgets'], ['B2', '4'], ['C2', '2.50'], ['D2', '=B2*C2'],
    ['A3', 'Gadgets'], ['B3', '10'], ['C3', '1.25'], ['D3', '=B3*C3'],
    ['A4', 'Total'], ['D4', '=SUM(D2:D3)']]) {
    const m = cell.match(/^([A-Z]+)(\d+)$/);
    await p.click(`.pk-grid td[data-r="${+m[2] - 1}"][data-c="${m[1].charCodeAt(0) - 65}"]`);
    await p.keyboard.type(val, { delay: 5 });
    await p.keyboard.press('Enter');
  }
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/4-pk-sheets.png' });

  await p.click('#pk-tabs button[data-kind="deck"]');
  await p.click('#pk-new');
  await p.waitForSelector('.pk-slide');
  await p.click('.pk-format .ob-btn:has-text("Text box")');
  await p.waitForTimeout(300);
  await p.dispatchEvent('.pk-slide', 'mousedown'); // deselect
  await p.waitForTimeout(300);
  await p.click('.pk-format .ob-btn:has-text("Rectangle")');
  await p.waitForTimeout(300);
  await p.dispatchEvent('.pk-slide', 'mousedown'); // deselect
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/5-pk-slides.png' });
  await p.close();
}

/* ---------- Whisker ---------- */
{
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/whisker.html'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/6-whisker-gate.png' });
  await p.click('.wh-gate-skip');
  await p.fill('#wh-input', 'How do I make a good cup of coffee?');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/7-whisker-chat.png' });
  await p.click('#wh-artifact-new');
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/8-whisker-artifact.png' });
  await p.close();
}

/* ---------- Wire ---------- */
{
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/wire.html'));
  await p.waitForTimeout(400);
  const fcP = p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
  await p.click('#wr-add-music');
  const fc = await fcP;
  if (fc) {
    await fc.setFiles([
      { name: 'Aurora Drive - Neon Rain.wav', mimeType: 'audio/wav', buffer: makeWav() },
      { name: 'The Midnight Collective - Static Bloom.wav', mimeType: 'audio/wav', buffer: makeWav() },
      { name: 'Harbor Lights - Drift.wav', mimeType: 'audio/wav', buffer: makeWav() },
    ]);
    await p.waitForTimeout(600);
  }
  await p.screenshot({ path: OUT + '/9-wire-home.png' });
  if (fc) {
    await p.click('.wr-card-play');
    await p.waitForTimeout(800);
  }
  await p.screenshot({ path: OUT + '/10-wire-playing.png' });
  await p.click('.wr-nav-item[data-view="search"]');
  await p.fill('#wr-search-input', 'neon');
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/11-wire-search.png' });
  await p.close();
}

await browser.close();
console.log('shots written to ' + OUT);
