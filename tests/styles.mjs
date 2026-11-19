'use strict';
/* Style fidelity assertions: verify each app renders its intended palette/layout. */
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

async function open(file) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('file://' + resolve(ROOT, 'dist', file));
  await page.waitForTimeout(400);
  return page;
}

/* Whisker — Claude cream */
{
  const p = await open('whisker.html');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('whisker: cream background', bg === 'rgb(250, 249, 245)', bg);
  const side = await p.evaluate(() => getComputedStyle(document.querySelector('.wh-sidebar')).backgroundColor);
  check('whisker: sidebar tone', side === 'rgb(240, 238, 230)', side);
  const send = await p.evaluate(() => getComputedStyle(document.querySelector('#wh-send')).backgroundColor);
  check('whisker: terracotta send', send === 'rgb(193, 95, 60)', send);
  const gate = await p.evaluate(() => !!document.querySelector('#wh-gate:not(.ob-hidden)'));
  check('whisker: gate visible', gate);
  await p.close();
}

/* Pocketknife — Google light */
{
  const p = await open('pocketknife.html');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('pk: light desk background', bg === 'rgb(241, 243, 244)', bg);
  const bar = await p.evaluate(() => getComputedStyle(document.querySelector('.pk-topbar')).backgroundColor);
  check('pk: white top bar', bar === 'rgb(255, 255, 255)', bar);
  await p.click('#pk-new');
  await p.waitForSelector('.pk-paper');
  const paper = await p.evaluate(() => getComputedStyle(document.querySelector('.pk-paper')).backgroundColor);
  check('pk: white paper', paper === 'rgb(255, 255, 255)', paper);
  const toolbar = await p.evaluate(() => getComputedStyle(document.querySelector('.pk-toolbar')).backgroundColor);
  check('pk: docs toolbar light', toolbar === 'rgb(249, 251, 253)', toolbar);
  await p.close();
}

/* Wire — Spotify palette */
{
  const p = await open('wire.html');
  const body = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('wire: black shell', body === 'rgb(0, 0, 0)', body);
  const main = await p.evaluate(() => getComputedStyle(document.querySelector('.wr-main')).backgroundColor);
  check('wire: #121212 main', main === 'rgb(18, 18, 18)', main);
  const side = await p.evaluate(() => getComputedStyle(document.querySelector('.wr-sidebar')).backgroundColor);
  check('wire: #121212 sidebar', side === 'rgb(18, 18, 18)', side);
  const play = await p.evaluate(() => getComputedStyle(document.querySelector('#wr-play')).backgroundColor);
  check('wire: white bar play button', play === 'rgb(255, 255, 255)', play);
  await p.close();
}

/* Core — iOS home */
{
  const p = await open('index.html');
  const clock = await p.evaluate(() => {
    const el = document.querySelector('.clock-time');
    const cs = getComputedStyle(el);
    return { weight: cs.fontWeight, size: parseFloat(cs.fontSize) };
  });
  check('core: light clock type', clock.weight === '200' && clock.size >= 50, JSON.stringify(clock));
  const icons = await p.evaluate(() => document.querySelectorAll('.app-icon').length);
  check('core: 4 home icons', icons === 4, String(icons));
  const tile = await p.evaluate(() => {
    const el = document.querySelector('.icon-tile');
    return { radius: getComputedStyle(el).borderRadius, shadow: getComputedStyle(el).boxShadow.includes('inset') };
  });
  check('core: squircle + gloss icons', tile.radius !== '0px' && tile.shadow, JSON.stringify(tile));
  await p.close();
}

await browser.close();
console.log('\n' + (fails.length ? fails.length + ' FAILURES' : 'ALL STYLES PASS'));
process.exit(fails.length ? 1 : 0);
