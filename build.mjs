#!/usr/bin/env node
'use strict';
/*
 * Oblivious build — inlines theme CSS, core scripts and vendor libs into
 * single-file apps in dist/. Zero dependencies.
 *
 * Usage:
 *   node build.mjs                build all apps
 *   node build.mjs --only core    build one app
 *   node build.mjs --watch        rebuild on change
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const APPS = {
  core: { dir: 'core', out: 'index.html', title: 'Oblivious' },
  pocketknife: { dir: 'pocketknife', out: 'pocketknife.html', title: 'Pocketknife' },
  whisker: { dir: 'whisker', out: 'whisker.html', title: 'Whisker' },
  wire: { dir: 'wire', out: 'wire.html', title: 'Wire' },
};

function isExternal(url) {
  return /^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#');
}

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/* Inline url(...) asset references inside CSS as base64 data URIs. */
function inlineCssUrls(css, cssDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, url) => {
    if (isExternal(url)) return m;
    const abs = resolve(cssDir, url);
    const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
    if (!MIME[ext]) return m;
    const b64 = readFileSync(abs).toString('base64');
    return 'url(data:' + MIME[ext] + ';base64,' + b64 + ')';
  });
}

function inlineHtml(appSrcPath, outPath, appName) {
  let html = readFileSync(appSrcPath, 'utf8');
  const dir = dirname(appSrcPath);

  // Inline local stylesheets: <link rel="stylesheet" href="...">
  html = html.replace(/<link\b([^>]*)>/gi, (tag, attrs) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(attrs)) return tag;
    const m = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m || isExternal(m[1])) return tag;
    const css = inlineCssUrls(readFileSync(resolve(dir, m[1]), 'utf8'), resolve(dir, dirname(m[1])));
    return '<style>\n' + css + '\n</style>';
  });

  // Inline local scripts: <script src="..."></script> (classic scripts only)
  html = html.replace(/<script\b([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*?)>\s*<\/script>/gi, (tag, pre, src, post) => {
    if (isExternal(src)) return tag;
    if (/\btype\s*=\s*["']?module/i.test(pre + post)) {
      throw new Error(appName + ': ES-module scripts cannot be inlined (' + src + '). Use classic scripts.');
    }
    const js = readFileSync(resolve(dir, src), 'utf8');
    return '<script>\n' + js + '\n</script>';
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  return Buffer.byteLength(html);
}

function buildApp(name) {
  const app = APPS[name];
  const srcPath = join(ROOT, 'src/apps', app.dir, 'index.html');
  if (!existsSync(srcPath)) {
    console.error('  ? ' + name + ': no index.html in src/apps/' + app.dir + ', skipped');
    return null;
  }
  const outPath = join(ROOT, 'dist', app.out);
  const size = inlineHtml(srcPath, outPath, name);
  console.log('  ✓ ' + name.padEnd(12) + ' -> dist/' + app.out.padEnd(20) + (size / 1024).toFixed(1) + ' KB');
  return size;
}

function buildAll(only) {
  console.log('Building Oblivious' + (only ? ' (' + only + ')' : '') + '…');
  const names = only ? [only] : Object.keys(APPS);
  if (only && !APPS[only]) {
    console.error('Unknown app: ' + only + '. Valid: ' + Object.keys(APPS).join(', '));
    process.exit(1);
  }
  let failed = false;
  for (const n of names) {
    try {
      buildApp(n);
    } catch (e) {
      console.error('  ✗ ' + n + ': ' + e.message);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

buildAll(only);

if (args.includes('--watch')) {
  console.log('Watching src/ for changes…');
  let timer = null;
  const watchDir = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) watchDir(p);
    }
  };
  watchDir(join(ROOT, 'src'));
  import('node:fs').then((fs) => {
    fs.watch(join(ROOT, 'src'), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log('\nRebuilding…');
        try {
          buildAll(only);
        } catch (e) {
          console.error('  build error: ' + e.message);
        }
      }, 120);
    });
  });
}
