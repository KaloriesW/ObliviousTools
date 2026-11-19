'use strict';
/* Pocketknife formula engine: tokenizer, recursive-descent parser, evaluator
   with cell/range refs, ~40 functions, error values, cycle detection. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  const ERR = {
    DIV0: '#DIV/0!',
    NAME: '#NAME?',
    VALUE: '#VALUE!',
    REF: '#REF!',
    ERROR: '#ERROR!',
  };
  function isErr(v) { return v && typeof v === 'object' && v.err; }

  function colToIndex(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function indexToCol(i) {
    let s = '';
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /* ---------------- tokenizer ---------------- */

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (/[eE]/.test(src[j] || '') && /[0-9+\-]/.test(src[j + 1] || '')) {
          j += 2;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
        i = j;
        continue;
      }
      if (ch === '"') {
        let j = i + 1, s = '';
        while (j < n) {
          if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
          if (src[j] === '"') break;
          s += src[j]; j++;
        }
        if (src[j] !== '"') return { error: ERR.ERROR };
        toks.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$.]/.test(src[j])) j++;
        const word = src.slice(i, j);
        if ((word === 'TRUE' || word === 'FALSE')) {
          toks.push({ t: 'bool', v: word === 'TRUE' });
          i = j;
          continue;
        }
        const refM = word.match(/^([A-Za-z]{1,3})(\d+)$/);
        if (refM) { toks.push({ t: 'ref', col: colToIndex(refM[1]), row: parseInt(refM[2], 10) - 1 }); i = j; continue; }
        toks.push({ t: 'id', v: word.toUpperCase() });
        i = j;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>%(),:'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
      return { error: ERR.NAME };
    }
    return { toks };
  }

  /* ---------------- parser ---------------- */

  function parse(toks) {
    let p = 0;
    const peek = () => toks[p];
    const eat = (t, v) => {
      const tk = toks[p];
      if (!tk || tk.t !== t || (v !== undefined && tk.v !== v)) return null;
      p++;
      return tk;
    };

    function parseExpr() { return parseCompare(); }

    function parseCompare() {
      let left = parseConcat();
      while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = toks[p++].v;
        const right = parseConcat();
        if (!right) return null;
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parseConcat() {
      let left = parseAdd();
      while (eat('op', '&')) {
        const right = parseAdd();
        if (!right) return null;
        left = { k: 'bin', op: '&', left, right };
      }
      return left;
    }
    function parseAdd() {
      let left = parseMul();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = toks[p++].v;
        const right = parseMul();
        if (!right) return null;
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parseMul() {
      let left = parsePow();
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = toks[p++].v;
        const right = parsePow();
        if (!right) return null;
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parsePow() {
      let left = parseUnary();
      while (eat('op', '^')) {
        const right = parseUnary();
        if (!right) return null;
        left = { k: 'bin', op: '^', left, right };
      }
      return left;
    }
    function parseUnary() {
      if (eat('op', '-')) { const e = parseUnary(); return e ? { k: 'neg', e } : null; }
      if (eat('op', '+')) return parseUnary();
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parseAtom();
      while (e && eat('op', '%')) e = { k: 'pct', e };
      return e;
    }
    function parseAtom() {
      const tk = peek();
      if (!tk) return null;
      if (tk.t === 'num') { p++; return { k: 'lit', v: tk.v }; }
      if (tk.t === 'str') { p++; return { k: 'lit', v: tk.v }; }
      if (tk.t === 'bool') { p++; return { k: 'lit', v: tk.v }; }
      if (tk.t === 'ref') {
        p++;
        if (eat('op', ':')) {
          const r2 = eat('ref');
          if (!r2) return null;
          return {
            k: 'range',
            c1: Math.min(tk.col, r2.col), r1: Math.min(tk.row, r2.row),
            c2: Math.max(tk.col, r2.col), r2: Math.max(tk.row, r2.row),
          };
        }
        return { k: 'ref', col: tk.col, row: tk.row };
      }
      if (tk.t === 'id') {
        p++;
        if (eat('op', '(')) {
          const args = [];
          if (eat('op', ')')) return { k: 'call', fn: tk.v, args };
          for (;;) {
            const a = parseExpr();
            if (!a) return null;
            args.push(a);
            if (eat('op', ',')) continue;
            if (eat('op', ')')) break;
            return null;
          }
          return { k: 'call', fn: tk.v, args };
        }
        return null;
      }
      if (eat('op', '(')) {
        const e = parseExpr();
        if (e && eat('op', ')')) return e;
        return null;
      }
      return null;
    }

    const ast = parseExpr();
    if (!ast || p !== toks.length) return null;
    return ast;
  }

  /* ---------------- values ---------------- */

  function toNum(v) {
    if (isErr(v)) return v;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'string') {
      const t = v.trim().replace(/%$/, '');
      const n = parseFloat(t);
      if (isNaN(n)) return { err: ERR.VALUE };
      return v.trim().endsWith('%') ? n / 100 : n;
    }
    return { err: ERR.VALUE };
  }
  function toStr(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
    return String(v);
  }
  function toBool(v) {
    if (isErr(v)) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase();
      if (u === 'TRUE') return true;
      if (u === 'FALSE') return false;
      if (u === '') return false;
      const n = parseFloat(u);
      if (!isNaN(n)) return n !== 0;
      return true;
    }
    return false;
  }
  function flat(args) {
    const out = [];
    for (const a of args) {
      if (Array.isArray(a)) {
        for (const x of a) if (x !== null && x !== undefined && x !== '') out.push(x);
      } else out.push(a);
    }
    return out;
  }
  function nums(args) {
    const out = [];
    for (const a of flat(args)) {
      if (isErr(a)) return a;
      if (typeof a === 'number') out.push(a);
      else if (typeof a === 'boolean') out.push(a ? 1 : 0);
      else if (typeof a === 'string' && a.trim() !== '' && !isNaN(parseFloat(a))) out.push(parseFloat(a));
    }
    return out;
  }

  const FNS = {
    SUM: (a) => { const n = nums(a); return isErr(n) ? n : n.reduce((s, x) => s + x, 0); },
    AVERAGE: (a) => { const n = nums(a); if (isErr(n)) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : { err: ERR.DIV0 }; },
    MIN: (a) => { const n = nums(a); return isErr(n) ? n : (n.length ? Math.min(...n) : 0); },
    MAX: (a) => { const n = nums(a); return isErr(n) ? n : (n.length ? Math.max(...n) : 0); },
    COUNT: (a) => nums(a).length,
    COUNTA: (a) => flat(a).length,
    COUNTBLANK: (a) => { const f = flat(a); return (Array.isArray(a[0]) ? a[0].length : 1) - f.length; },
    AND: (a) => { const f = flat(a); for (const x of f) { const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; },
    OR: (a) => { const f = flat(a); for (const x of f) { const b = toBool(x); if (isErr(b)) return b; if (b) return true; } return false; },
    NOT: (a) => { const b = toBool(a[0]); return isErr(b) ? b : !b; },
    ABS: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.abs(n); },
    ROUND: (a) => { const n = toNum(a[0]); const d = a.length > 1 ? toNum(a[1]) : 0; if (isErr(n)) return n; if (isErr(d)) return d; const f = Math.pow(10, d); return Math.round((n + Number.EPSILON) * f) / f; },
    ROUNDUP: (a) => { const n = toNum(a[0]); const d = a.length > 1 ? toNum(a[1]) : 0; if (isErr(n)) return n; if (isErr(d)) return d; const f = Math.pow(10, d); return Math.ceil(Math.abs(n) * f) / f * Math.sign(n); },
    ROUNDDOWN: (a) => { const n = toNum(a[0]); const d = a.length > 1 ? toNum(a[1]) : 0; if (isErr(n)) return n; if (isErr(d)) return d; const f = Math.pow(10, d); return Math.floor(Math.abs(n) * f) / f * Math.sign(n); },
    INT: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.floor(n); },
    MOD: (a) => { const x = toNum(a[0]); const y = toNum(a[1]); if (isErr(x)) return x; if (isErr(y)) return y; if (y === 0) return { err: ERR.DIV0 }; return x - y * Math.floor(x / y); },
    SQRT: (a) => { const n = toNum(a[0]); if (isErr(n)) return n; return n < 0 ? { err: ERR.VALUE } : Math.sqrt(n); },
    POWER: (a) => { const x = toNum(a[0]); const y = toNum(a[1]); if (isErr(x)) return x; if (isErr(y)) return y; return Math.pow(x, y); },
    EXP: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.exp(n); },
    LN: (a) => { const n = toNum(a[0]); if (isErr(n)) return n; return n <= 0 ? { err: ERR.VALUE } : Math.log(n); },
    LOG: (a) => { const n = toNum(a[0]); if (isErr(n)) return n; return n <= 0 ? { err: ERR.VALUE } : Math.log(n) / Math.LN10; },
    LEN: (a) => { const s = toStr(a[0]); return isErr(s) ? s : s.length; },
    LEFT: (a) => { const s = toStr(a[0]); const n = a.length > 1 ? toNum(a[1]) : 1; if (isErr(s)) return s; if (isErr(n)) return n; return s.slice(0, Math.max(0, n)); },
    RIGHT: (a) => { const s = toStr(a[0]); const n = a.length > 1 ? toNum(a[1]) : 1; if (isErr(s)) return s; if (isErr(n)) return n; const k = Math.max(0, n); return k === 0 ? '' : s.slice(-k); },
    MID: (a) => { const s = toStr(a[0]); const st = toNum(a[1]); const ln = toNum(a[2]); if (isErr(s)) return s; if (isErr(st)) return st; if (isErr(ln)) return ln; return s.substr(Math.max(0, st - 1), Math.max(0, ln)); },
    UPPER: (a) => { const s = toStr(a[0]); return isErr(s) ? s : s.toUpperCase(); },
    LOWER: (a) => { const s = toStr(a[0]); return isErr(s) ? s : s.toLowerCase(); },
    TRIM: (a) => { const s = toStr(a[0]); return isErr(s) ? s : s.trim().replace(/\s+/g, ' '); },
    CONCATENATE: (a) => { let s = ''; for (const x of flat(a)) { const t = toStr(x); if (isErr(t)) return t; s += t; } return s; },
    TODAY: () => { const d = new Date(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); },
    NOW: () => { const d = new Date(); const e = new Date(d.getFullYear(), 0, 0); return (e - e) / 86400000 + (d - new Date(d.getFullYear(), 0, 0)) / 86400000; },
    RAND: () => Math.random(),
    SIN: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.sin(n); },
    COS: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.cos(n); },
    TAN: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.tan(n); },
    ASIN: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.asin(n); },
    ACOS: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.acos(n); },
    ATAN: (a) => { const n = toNum(a[0]); return isErr(n) ? n : Math.atan(n); },
    PI: () => Math.PI,
    ISBLANK: (a) => a[0] === null || a[0] === undefined || a[0] === '',
  };

  /* ---------------- evaluator ---------------- */

  function createEngine(getRawCell) {
    const cache = new Map();
    const visiting = new Set();

    function cellValue(col, row) {
      const key = col + ',' + row;
      if (cache.has(key)) return cache.get(key);
      if (visiting.has(key)) return { err: ERR.ERROR };
      const raw = getRawCell(col, row);
      if (raw === null || raw === undefined) return null;
      visiting.add(key);
      let v;
      try {
        v = computeValue(raw);
      } catch (_) {
        v = { err: ERR.ERROR };
      }
      visiting.delete(key);
      cache.set(key, v);
      return v;
    }

    function evalNode(node) {
      switch (node.k) {
        case 'lit': return node.v;
        case 'ref': return cellValue(node.col, node.row);
        case 'range': {
          const out = [];
          for (let r = node.r1; r <= node.r2; r++)
            for (let c = node.c1; c <= node.c2; c++) out.push(cellValue(c, r));
          return out;
        }
        case 'neg': { const n = toNum(evalNode(node.e)); return isErr(n) ? n : -n; }
        case 'pct': { const n = toNum(evalNode(node.e)); return isErr(n) ? n : n / 100; }
        case 'bin': {
          const a = evalNode(node.left);
          const b = evalNode(node.right);
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          switch (node.op) {
            case '&': return toStr(a) + toStr(b);
            case '+': case '-': case '*': case '/': case '^': {
              const x = toNum(a), y = toNum(b);
              if (isErr(x)) return x;
              if (isErr(y)) return y;
              if (node.op === '+') return x + y;
              if (node.op === '-') return x - y;
              if (node.op === '*') return x * y;
              if (node.op === '/') return y === 0 ? { err: ERR.DIV0 } : x / y;
              return Math.pow(x, y);
            }
            default: {
              const op = node.op;
              let x = a, y = b;
              const blank = (v) => v === null || v === undefined || v === '';
              if (typeof x === 'number' && blank(y)) y = 0;
              if (typeof y === 'number' && blank(x)) x = 0;
              const bothNum = typeof x === 'number' && typeof y === 'number';
              if (bothNum || typeof x === 'boolean' || typeof y === 'boolean') {
                if (typeof x === 'boolean') x = x ? 1 : 0;
                if (typeof y === 'boolean') y = y ? 1 : 0;
                if (op === '=') return x === y;
                if (op === '<>') return x !== y;
                if (op === '<') return x < y;
                if (op === '>') return x > y;
                if (op === '<=') return x <= y;
                return x >= y;
              }
              const s1 = toStr(x), s2 = toStr(y);
              if (op === '=') return s1 === s2;
              if (op === '<>') return s1 !== s2;
              if (op === '<') return s1 < s2;
              if (op === '>') return s1 > s2;
              if (op === '<=') return s1 <= s2;
              return s1 >= s2;
            }
          }
        }
        case 'call': {
          const fn = node.fn;
          if (fn === 'IF') {
            if (node.args.length < 2) return { err: ERR.ERROR };
            const c = toBool(evalNode(node.args[0]));
            if (isErr(c)) return c;
            if (c) return evalNode(node.args[1]);
            return node.args[2] ? evalNode(node.args[2]) : false;
          }
          if (fn === 'IFERROR') {
            const v = evalNode(node.args[0]);
            if (isErr(v)) return node.args[1] ? evalNode(node.args[1]) : '';
            return v;
          }
          if (fn === 'IFS') {
            for (let i = 0; i + 1 < node.args.length; i += 2) {
              const c = toBool(evalNode(node.args[i]));
              if (isErr(c)) return c;
              if (c) return evalNode(node.args[i + 1]);
            }
            return { err: ERR.VALUE };
          }
          if (!FNS[fn]) return { err: ERR.NAME };
          const args = node.args.map(evalNode);
          for (const a of args) if (isErr(a)) return a;
          try {
            return FNS[fn](args);
          } catch (_) {
            return { err: ERR.ERROR };
          }
        }
      }
      return { err: ERR.ERROR };
    }

    function computeValue(raw) {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === 'number') return raw;
      const s = String(raw);
      if (s === '') return null;
      if (s.startsWith('=')) {
        const { toks, error } = tokenize(s.slice(1));
        if (error) return error;
        const ast = parse(toks || []);
        if (!ast) return { err: ERR.ERROR };
        return evalNode(ast);
      }
      const t = s.trim();
      if (t !== '' && !isNaN(t) && /[0-9]/.test(t)) return parseFloat(t);
      return s;
    }

    return {
      compute: (raw) => {
        try { return computeValue(raw); } catch (_) { return { err: ERR.ERROR }; }
      },
      cell: cellValue,
      invalidate: () => cache.clear(),
    };
  }

  OB.formulas = { createEngine, colToIndex, indexToCol, ERR, isErr };
})();
