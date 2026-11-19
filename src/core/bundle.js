'use strict';
/*
 * Oblivious tar bundle — minimal ustar reader/writer for grouping multiple
 * files into one payload before .obv encryption. Pure JS, no dependencies.
 */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  function field(str, len) {
    const b = new Uint8Array(len);
    const s = ENC.encode(str);
    b.set(s.subarray(0, len));
    return b;
  }

  function octal(n, len, term) {
    // len bytes total: (len-1) octal digits + terminator
    return field(n.toString(8).padStart(len - 1, '0') + term, len);
  }

  function tarHeader(name, size, mtime) {
    const h = new Uint8Array(512);
    let prefix = '';
    let n = name;
    if (n.length > 100) {
      const idx = n.lastIndexOf('/', 154);
      if (idx <= 0 || n.length - idx - 1 > 100) throw new Error('NAME_TOO_LONG:' + name);
      prefix = n.slice(0, idx);
      n = n.slice(idx + 1);
      if (n.length > 100) throw new Error('NAME_TOO_LONG:' + name);
    }
    h.set(field(n, 100), 0);
    h.set(octal(0o644, 8, '\0'), 100);        // mode
    h.set(octal(0, 8, '\0'), 108);            // uid
    h.set(octal(0, 8, '\0'), 116);            // gid
    h.set(octal(size, 12, ' '), 124);         // size
    h.set(octal(mtime, 12, ' '), 136);        // mtime
    h.set(field('        ', 8), 148);         // checksum placeholder (spaces)
    h[156] = 0x30;                            // typeflag '0' = regular file
    h.set(field('ustar', 5), 257); h[262] = 0; // magic + NUL
    h.set(field('00', 2), 263);               // version
    h.set(field('oblivious', 32), 265);       // uname
    if (prefix) h.set(field(prefix, 155), 345);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.set(field(sum.toString(8).padStart(6, '0') + '\0 ', 8), 148);
    return h;
  }

  /**
   * @param {{name: string, bytes: Uint8Array}[]} files
   * @returns {Uint8Array} tar archive
   */
  function makeTar(files, mtime) {
    mtime = mtime || Math.floor(Date.now() / 1000);
    const parts = [];
    for (const f of files) {
      const bytes = OB.crypto.toU8(f.bytes);
      parts.push(tarHeader(f.name, bytes.length, mtime));
      parts.push(bytes);
      const pad = (512 - (bytes.length % 512)) % 512;
      if (pad) parts.push(new Uint8Array(pad));
    }
    parts.push(new Uint8Array(1024)); // end-of-archive
    return OB.crypto.concatBytes(...parts);
  }

  /** @returns {{name: string, bytes: Uint8Array, size: number}[]} */
  function readTar(bytes) {
    bytes = OB.crypto.toU8(bytes);
    const files = [];
    let off = 0;
    const cstr = (start, len) => {
      let end = start;
      const max = Math.min(start + len, bytes.length);
      while (end < max && bytes[end] !== 0) end++;
      return DEC.decode(bytes.subarray(start, end));
    };
    while (off + 512 <= bytes.length) {
      let allZero = true;
      for (let i = off; i < off + 512; i++) {
        if (bytes[i] !== 0) { allZero = false; break; }
      }
      if (allZero) break;
      const name = cstr(off, 100);
      const size = parseInt(cstr(off + 124, 12).trim(), 8) || 0;
      const type = String.fromCharCode(bytes[off + 156]);
      const prefix = cstr(off + 345, 155);
      const full = prefix ? prefix + '/' + name : name;
      const dataStart = off + 512;
      if (type === '0' || type === '\0' || type === '') {
        files.push({ name: full, bytes: bytes.slice(dataStart, dataStart + size), size });
      }
      off = dataStart + Math.ceil(size / 512) * 512;
    }
    return files;
  }

  OB.tar = { makeTar, readTar };
})();
