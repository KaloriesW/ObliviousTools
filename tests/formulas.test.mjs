'use strict';
/* Tests for the Pocketknife formula engine. Run: node tests/formulas.test.mjs */
import { readFileSync } from 'node:fs';

(0, eval)(readFileSync(new URL('../src/apps/pocketknife/formulas.js', import.meta.url), 'utf8'));
const F = globalThis.OB.formulas;

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const norm = (v) => (v && typeof v === 'object' && v.err ? v.err : typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
  const a = norm(actual), b = norm(expected);
  if (a === b) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.error('  FAIL ' + name + '  got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }
}

const cells = {
  A1: '1', A2: '2', A3: '3',
  B1: 'hello', B2: '=A1+A2', B3: '=SUM(A1:A3)',
  C1: '=IF(A1>2,"big","small")', C2: '="a"&"b"', C3: '=1/0',
  D1: '=FOO(1)', D2: '=A2+', E1: 'plain text', E2: '=AVERAGE(A1:A3)',
  F1: '=UPPER(B1)', F2: '=LEN(B1)', F3: '=IFERROR(D1,"caught")',
  G1: '=MAX(A1:A3)*2', G2: '=ROUND(3.14159,2)', G3: '=MOD(10,3)',
};
const idx = (c, r) => F.indexToCol(c) + (r + 1);
const eng = F.createEngine((c, r) => (cells[idx(c, r)] !== undefined ? cells[idx(c, r)] : null));

console.log('formulas: basics');
eq(eng.compute('=1+2*3').computed ?? eng.compute('=1+2*3'), 7, '=1+2*3');
eq(eng.compute('42'), 42, 'plain number string');
eq(eng.compute('text'), 'text', 'plain text passthrough');

console.log('formulas: refs, ranges, functions');
eq(eng.compute('=B2'), 3, 'cell ref chain (B2 = A1+A2)');
eq(eng.compute('=SUM(A1:A3)'), 6, 'SUM over range');
eq(eng.compute('=AVERAGE(A1:A3)'), 2, 'AVERAGE over range');
eq(eng.compute('=MAX(A1:A3)*2'), 6, 'MAX*2');
eq(eng.compute('=IF(A1>2,"big","small")'), 'small', 'IF false branch');
eq(eng.compute('=IF(A3>2,"big","small")'), 'big', 'IF true branch');
eq(eng.compute('="a"&"b"'), 'ab', 'string concat');
eq(eng.compute('=UPPER(B1)'), 'HELLO', 'UPPER');
eq(eng.compute('=LEN(B1)'), 5, 'LEN');
eq(eng.compute('=ROUND(3.14159,2)'), 3.14, 'ROUND');
eq(eng.compute('=MOD(10,3)'), 1, 'MOD');

console.log('formulas: errors');
eq(eng.compute('=1/0'), { err: '#DIV/0!' }, '1/0 -> #DIV/0!');
eq(eng.compute('=FOO(1)'), { err: '#NAME?' }, 'unknown fn -> #NAME?');
eq(eng.compute('=A2+'), { err: '#ERROR!' }, 'parse error -> #ERROR!');
eq(eng.compute('=IFERROR(D1,"caught")'), 'caught', 'IFERROR catches #NAME?');
eq(eng.compute('=D1'), { err: '#NAME?' }, 'error propagates through refs');

console.log('formulas: cycles');
{
  const cyc = { A1: '=A1+1', B1: '=C1+1', C1: '=B1+1' };
  const e2 = F.createEngine((c, r) => cyc[idx(c, r)] ?? null);
  eq(e2.compute('=A1'), { err: '#ERROR!' }, 'self-cycle -> #ERROR!');
  eq(e2.compute('=B1'), { err: '#ERROR!' }, 'mutual cycle -> #ERROR!');
  const ok = { A1: '5', B1: '=A1*2' };
  const e3 = F.createEngine((c, r) => ok[idx(c, r)] ?? null);
  eq(e3.compute('=B1'), 10, 'non-cyclic chain ok');
}

console.log('formulas: blank cells & comparisons');
{
  const e4 = F.createEngine(() => null);
  eq(e4.compute('=A1+5'), 5, 'blank treated as 0');
  eq(e4.compute('=Z99=0'), true, 'blank equals 0');
  eq(e4.compute('=1=1'), true, 'numeric equal');
  eq(e4.compute('=("x")="x"'), true, 'parenthesized string equal');
}

console.log('');
console.log('formula tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
