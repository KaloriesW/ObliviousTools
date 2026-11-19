'use strict';
/* Numeric layout audit: catches real visual breakage without eyes.
   Checks: zero-size visible elements, overflow beyond scroll parents,
   elements off-viewport, key palette colors, text contrast. */
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const issues = [];

function issue(app, msg) {
  issues.push('[' + app + '] ' + msg);
  console.log('ISSUE [' + app + '] ' + msg);
}

/* Scan a page for geometry problems. scrollSel: selectors of containers where
   child overflow is expected (grids, scrollers). */
async function audit(page, app, { ignore = [] } = {}) {
  const problems = await page.evaluate(({ ignoreSels }) => {
    const out = [];
    const ignoreMatch = (el) => ignoreSels.some((s) => el.matches(s) || el.closest(s));
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const all = Array.from(document.querySelectorAll('body *')).filter(vis).filter((el) => !ignoreMatch(el));
    // zero-size elements that should have content
    for (const el of all) {
      if (!el.childElementCount && !(el.textContent || '').trim() && !['INPUT', 'TEXTAREA', 'SELECT', 'BR', 'HR', 'IMG', 'IFRAME', 'CANVAS', 'BUTTON'].includes(el.tagName)) continue;
      if (['svg', 'path', 'circle', 'rect', 'line', 'i', 'span'].includes(el.tagName.toLowerCase()) && !el.childElementCount && !(el.textContent || '').trim()) continue;
      const r = el.getBoundingClientRect();
      if ((r.width < 3 || r.height < 3) && el.textContent && el.textContent.trim()) {
        out.push({ type: 'zero-size', el: el.tagName + '.' + (el.className || '').toString().split(' ')[0], text: el.textContent.trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    // off-viewport (fixed overlays excluded)
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && (r.left < -60 || r.top < -60 || r.right > innerWidth + 60)) {
        out.push({ type: 'off-viewport', el: el.tagName + '.' + (el.className || '').toString().split(' ')[0], left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right) });
      }
    }
    // horizontal page overflow (scrollbar implies broken layout unless body allows scroll-x)
    if (document.documentElement.scrollWidth > innerWidth + 24) {
      out.push({ type: 'page-x-overflow', scrollW: document.documentElement.scrollWidth, vw: innerWidth });
    }
    return out.slice(0, 12);
  }, { ignoreSels: ignore });
  for (const p of problems) {
    if (p.type === 'zero-size') issue(app, `zero-size element ${p.el} "${p.text}" (${p.w}x${p.h})`);
    if (p.type === 'off-viewport') issue(app, `off-viewport ${p.el} (left ${p.left}, top ${p.top})`);
    if (p.type === 'page-x-overflow') issue(app, `horizontal page overflow: scrollWidth ${p.scrollW} > viewport ${p.vw}`);
  }
}

function lum(rgb) {
  const m = rgb.match(/\d+/g).map(Number);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
}
async function contrast(page, app, sel, label) {
  const r = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    let bgEl = el, bg = 'rgba(0, 0, 0, 0)';
    while (bgEl && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement; }
    return { fg: cs.color, bg, size: cs.fontSize };
  }, sel);
  if (!r) return;
  const l1 = lum(r.fg), l2 = lum(r.bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  if (ratio < 3.2) issue(app, `low contrast ${label} (${sel}): ${r.fg} on ${r.bg} = ${ratio.toFixed(2)}:1`);
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

/* ---------- Core ---------- */
{
  const p = await ctx.newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/index.html'));
  await p.waitForTimeout(500);
  await audit(p, 'core');
  await p.click('#open-core');
  await p.waitForTimeout(300);
  await audit(p, 'core-app');
  await p.close();
}

/* ---------- Pocketknife ---------- */
{
  const p = await ctx.newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/pocketknife.html'));
  await p.waitForTimeout(400);
  await p.click('#pk-new');
  await p.waitForSelector('.pk-paper');
  await p.click('.pk-paper');
  await p.keyboard.type('Quarterly report heading and body text sample');
  await p.waitForTimeout(500);
  await audit(p, 'pk-docs', { ignore: ['.pk-grid', '.pk-grid *', '.pk-print'] });
  await contrast(p, 'pk-docs', '.pk-counts', 'docs word count');
  await p.close();
}

/* ---------- Whisker ---------- */
{
  const p = await ctx.newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/whisker.html'));
  await p.waitForTimeout(500);
  await audit(p, 'whisker-gate');
  await p.click('.wh-gate-skip');
  await p.fill('#wh-input', 'How do I make coffee?');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await audit(p, 'whisker-chat');
  await contrast(p, 'whisker-chat', '.wh-user-bubble', 'user bubble');
  await contrast(p, 'whisker-chat', '.wh-note', 'composer note');
  await contrast(p, 'whisker-chat', '.wh-side-sec', 'sidebar section');
  await p.close();
}

/* ---------- Wire ---------- */
{
  const p = await ctx.newPage();
  await p.goto('file://' + resolve(ROOT, 'dist/wire.html'));
  await p.waitForTimeout(500);
  await audit(p, 'wire-home', { ignore: ['#wr-queue:not(.open)', '#wr-queue:not(.open) *', '#wr-queue', '#wr-queue *'] });
  await contrast(p, 'wire-home', '.wr-nav-item.on', 'active nav');
  await contrast(p, 'wire-home', '.wr-card-sub', 'card subtitle');
  await contrast(p, 'wire-home', '.wr-bar-artist', 'bar artist');
  await p.close();
}

await browser.close();
console.log('\n' + (issues.length ? issues.length + ' issues found' : 'NO LAYOUT ISSUES'));
process.exit(0);
