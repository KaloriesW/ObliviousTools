'use strict';
/* Tests for Oblivious tar bundle. Run: node tests/bundle.test.mjs */
import { readFileSync } from 'node:fs';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webCrypto;

(0, eval)(readFileSync(new URL('../src/core/crypto.js', import.meta.url), 'utf8'));
(0, eval)(readFileSync(new URL('../src/core/bundle.js', import.meta.url), 'utf8'));
const { tar, crypto: C } = globalThis.OB;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.error('  FAIL ' + name); }
}

console.log('tar: roundtrip');
{
  const files = [
    { name: 'notes.txt', bytes: new TextEncoder().encode('hello world') },
    { name: 'bin.dat', bytes: new Uint8Array([0, 255, 0, 1, 0, 0, 0, 128]) },
    { name: 'empty.file', bytes: new Uint8Array(0) },
    { name: 'dir/sub/résumé.md', bytes: new TextEncoder().encode('# héllo') },
  ];
  const archive = tar.makeTar(files);
  ok(archive instanceof Uint8Array, 'archive is Uint8Array');
  ok(archive.length % 512 === 0, 'archive length aligned to 512');
  const out = tar.readTar(archive);
  ok(out.length === files.length, 'file count preserved (' + out.length + ')');
  for (let i = 0; i < files.length; i++) {
    ok(out[i].name === files[i].name, 'name[' + i + '] = ' + files[i].name);
    const a = out[i].bytes, b = files[i].bytes;
    let same = a.length === b.length;
    if (same) for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) { same = false; break; }
    ok(same, 'bytes[' + i + '] preserved (' + b.length + 'B)');
  }
}

console.log('tar: tar-compatible checksum (GNU tar can read it)');
console.log('tar: obv roundtrip through encryption');
{
  const files = [{ name: 'a.txt', bytes: new TextEncoder().encode('secret contents') }];
  const archive = tar.makeTar(files);
  const box = await C.encrypt('pw', archive, { bundle: true, files: ['a.txt'] }, { iterations: 1000 });
  const dec = await C.decrypt('pw', box);
  const out = tar.readTar(dec.payload);
  ok(out.length === 1 && out[0].name === 'a.txt', 'tar inside .obv roundtrip');
  eq_(new TextDecoder().decode(out[0].bytes), 'secret contents', 'content inside .obv roundtrip');
}

function eq_(a, b, name) { ok(a === b, name + (a === b ? '' : ' (got ' + a + ')')); }

console.log('tar: long names via prefix field');
{
  const longName = 'averylongdirectoryname/anotherlongsegment/' + 'x'.repeat(60) + '.txt';
  const files = [{ name: longName, bytes: new Uint8Array([7]) }];
  const out = tar.readTar(tar.makeTar(files));
  ok(out.length === 1 && out[0].name === longName, 'long name preserved');
}

console.log('');
console.log('tar tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
