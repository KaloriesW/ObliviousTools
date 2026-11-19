'use strict';
/* Tests for Oblivious core crypto (.obv container). Run: node tests/crypto.test.mjs */
import { readFileSync } from 'node:fs';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webCrypto;

const src = readFileSync(new URL('../src/core/crypto.js', import.meta.url), 'utf8');
(0, eval)(src); // defines globalThis.OB
const { crypto: C } = globalThis.OB;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log('  PASS ' + name);
  } else {
    failed++;
    console.error('  FAIL ' + name);
  }
}
function eq(a, b, name) {
  const pass = a === b;
  if (!pass) console.error('       got: ' + JSON.stringify(a) + ' want: ' + JSON.stringify(b));
  ok(pass, name);
}
function bytesEq(a, b, name) {
  if (a.length !== b.length) return ok(false, name + ' (length ' + a.length + ' != ' + b.length + ')');
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return ok(false, name + ' (differs @' + i + ')');
  ok(true, name);
}
async function throws(fn, code, name) {
  try {
    await fn();
    ok(false, name + ' (did not throw)');
  } catch (e) {
    eq(e.message, code, name);
  }
}

const FAST = { iterations: 1000 }; // fast KDF for tests

console.log('crypto: basic roundtrip');
{
  const payload = new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0, 128, 44, 0, 99, 200]);
  const meta = { name: 'résumé final.pdf', type: 'application/pdf', size: 13 };
  const box = await C.encrypt('hunter2', payload, meta, FAST);
  ok(box instanceof Uint8Array, 'returns Uint8Array');
  eq(box[0], 0x4f, 'magic[0] O');
  eq(box[1], 0x42, 'magic[1] B');
  eq(box[2], 0x4c, 'magic[2] L');
  eq(box[3], 0x56, 'magic[3] V');
  eq(box[4], 1, 'version 1');
  const out = await C.decrypt('hunter2', box);
  bytesEq(out.payload, payload, 'payload survives roundtrip');
  eq(out.meta.name, meta.name, 'meta.name roundtrip');
  eq(out.meta.size, meta.size, 'meta.size roundtrip');
}

console.log('crypto: wrong password & tampering');
{
  const box = await C.encrypt('correct horse', new Uint8Array([1, 2, 3]), { a: 1 }, FAST);
  await throws(() => C.decrypt('wrong battery', box), 'BAD_PASSWORD', 'wrong password -> BAD_PASSWORD');

  const tamperedCt = box.slice();
  tamperedCt[tamperedCt.length - 1] ^= 0xff;
  await throws(() => C.decrypt('correct horse', tamperedCt), 'BAD_PASSWORD', 'tampered ciphertext rejected');

  const tamperedMeta = box.slice();
  tamperedMeta[40] ^= 0x01; // metaLen byte (header = AAD)
  await throws(() => C.decrypt('correct horse', tamperedMeta), 'BAD_PASSWORD', 'tampered header (AAD) rejected');

  const tamperedIters = box.slice();
  tamperedIters[10] ^= 0x01; // iterations LSB (header = AAD) -> 1000 becomes 1001
  await throws(() => C.decrypt('correct horse', tamperedIters), 'BAD_PASSWORD', 'tampered iterations rejected');
}

console.log('crypto: format guards');
{
  await throws(() => C.decrypt('x', new Uint8Array(10)), 'NOT_OBV', 'too short -> NOT_OBV');
  await throws(() => C.decrypt('x', new TextEncoder().encode('GARBAGE!')), 'NOT_OBV', 'bad magic -> NOT_OBV');
  const notTar = new TextEncoder().encode('OBLV' + String.fromCharCode(9, 1, 1) + '\0'.repeat(50));
  await throws(() => C.decrypt('x', notTar), 'UNSUPPORTED_VERSION:9', 'future version -> UNSUPPORTED_VERSION');
}

console.log('crypto: randomness');
{
  const a = await C.encrypt('pw', new Uint8Array([1]), null, FAST);
  const b = await C.encrypt('pw', new Uint8Array([1]), null, FAST);
  bytesEq(a.subarray(0, 4), b.subarray(0, 4), 'magic identical');
  let saltSame = true;
  for (let i = 11; i < 27; i++) if (a[i] !== b[i]) saltSame = false;
  ok(!saltSame, 'salts unique per encryption');
  let ivSame = true;
  for (let i = 27; i < 39; i++) if (a[i] !== b[i]) ivSame = false;
  ok(!ivSame, 'IVs unique per encryption');
}

console.log('crypto: header fields');
{
  const box = await C.encrypt('pw', new Uint8Array([5]), { k: 'v' }, FAST);
  const h = C.parseHeader(box);
  eq(h.iterations, 1000, 'custom iterations recorded');
  eq(h.kdf, 1, 'kdf id = PBKDF2-SHA256');
  eq(h.cipher, 1, 'cipher id = AES-256-GCM');
  eq(h.headerLen, 43, 'header length 43');
  const box2 = await C.encrypt('pw', new Uint8Array([5]), null); // default opts
  eq(C.parseHeader(box2).iterations, 600000, 'default iterations = 600000');
}

console.log('crypto: string payload & null meta');
{
  const box = await C.encrypt('pw', 'hello oblivious éè', null, FAST);
  const out = await C.decrypt('pw', box);
  eq(new TextDecoder().decode(out.payload), 'hello oblivious éè', 'string payload roundtrip');
  eq(out.meta, null, 'null meta roundtrip');
}

console.log('crypto: wipe');
{
  const b = new Uint8Array([1, 2, 3, 4]);
  C.wipe(b);
  bytesEq(b, new Uint8Array(4), 'wipe zeroes bytes');
}

console.log('');
console.log('crypto tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
