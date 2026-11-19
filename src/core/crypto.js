'use strict';
/*
 * Oblivious core crypto — the .obv encrypted container format.
 *
 * Format (version 1):
 *   offset  size  field
 *   0       4     magic "OBLV" (0x4F 0x42 0x4C 0x56)
 *   4       1     container version (= 1)
 *   5       1     kdf id (1 = PBKDF2-SHA256)
 *   6       1     cipher id (1 = AES-256-GCM)
 *   7       4     kdf iterations, unsigned big-endian
 *   11      16    salt
 *   27      12    AES-GCM IV (nonce)
 *   39      4     metadata JSON length, unsigned big-endian
 *   43      ...   ciphertext = AES-256-GCM(key, IV, AAD = bytes[0..43), plaintext = metaJSON || payload)
 *
 * The entire 43-byte header is GCM additional data: any tampering with
 * version/iterations/salt/IV/metaLen fails authentication.
 * Wrong password => GCM auth failure => Error('BAD_PASSWORD').
 *
 * Zero dependencies. Uses WebCrypto only (works on https:// and file://).
 */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  const MAGIC = new Uint8Array([0x4f, 0x42, 0x4c, 0x56]); // "OBLV"
  const VERSION = 1;
  const KDF_PBKDF2_SHA256 = 1;
  const CIPHER_AES256_GCM = 1;
  const DEFAULT_ITERATIONS = 600000;
  const SALT_LEN = 16;
  const IV_LEN = 12;
  const HEADER_LEN = 4 + 1 + 1 + 1 + 4 + SALT_LEN + IV_LEN + 4; // 43

  const TE = new TextEncoder();
  const TD = new TextDecoder();

  function subtle() {
    const c = globalThis.crypto;
    if (!c || !c.subtle) {
      throw new Error('WebCrypto unavailable. Open over https://, file:// or localhost.');
    }
    return c.subtle;
  }

  function randomBytes(n) {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
  }

  /* Best-effort memory wipe for typed arrays. JS strings are immutable —
     we can't truly wipe them; this is a practical mitigation, not a guarantee. */
  function wipe(...arrays) {
    for (const a of arrays) {
      if (!a) continue;
      try {
        if (a instanceof Uint8Array) a.fill(0);
        else if (ArrayBuffer.isView(a)) a.fill(0);
      } catch (_) { /* ignore */ }
    }
  }

  function concatBytes(...arrays) {
    let len = 0;
    for (const a of arrays) len += a.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const a of arrays) {
      if (a.length === 0) continue;
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  function toU8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new Error('Expected binary data');
  }

  async function deriveKey(password, salt, iterations) {
    const baseKey = await subtle().importKey('raw', TE.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function buildHeader(salt, iv, iterations, metaLen) {
    const h = new Uint8Array(HEADER_LEN);
    const dv = new DataView(h.buffer);
    h.set(MAGIC, 0);
    h[4] = VERSION;
    h[5] = KDF_PBKDF2_SHA256;
    h[6] = CIPHER_AES256_GCM;
    dv.setUint32(7, iterations);
    h.set(salt, 11);
    h.set(iv, 27);
    dv.setUint32(39, metaLen);
    return h;
  }

  function parseHeader(bytes) {
    bytes = toU8(bytes);
    if (bytes.length < HEADER_LEN) throw new Error('NOT_OBV');
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Error('NOT_OBV');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[4];
    if (version !== VERSION) throw new Error('UNSUPPORTED_VERSION:' + version);
    return {
      version,
      kdf: bytes[5],
      cipher: bytes[6],
      iterations: dv.getUint32(7),
      salt: bytes.slice(11, 27),
      iv: bytes.slice(27, 39),
      metaLen: dv.getUint32(39),
      headerLen: HEADER_LEN,
    };
  }

  /**
   * Encrypt a payload into a .obv container.
   * @param {string} password
   * @param {Uint8Array|string} payload  raw bytes (strings are UTF-8 encoded)
   * @param {object|null} meta  arbitrary JSON-serializable metadata (filenames, app hints…). Stored ENCRYPTED.
   * @param {{iterations?: number}} [opts]
   * @returns {Promise<Uint8Array>} container bytes
   */
  async function encrypt(password, payload, meta = null, opts = {}) {
    payload = typeof payload === 'string' ? TE.encode(payload) : toU8(payload);
    const iterations = opts.iterations || DEFAULT_ITERATIONS;
    const metaJson = TE.encode(JSON.stringify(meta === undefined ? null : meta));
    if (metaJson.length > 0xffffffff) throw new Error('Metadata too large');

    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const header = buildHeader(salt, iv, iterations, metaJson.length);
    const key = await deriveKey(password, salt, iterations);
    const plaintext = concatBytes(metaJson, payload);
    const ct = new Uint8Array(
      await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, plaintext)
    );
    return concatBytes(header, ct);
  }

  /**
   * Decrypt a .obv container.
   * @returns {Promise<{payload: Uint8Array, meta: (object|null)}>}
   * @throws Error('NOT_OBV') | Error('UNSUPPORTED_VERSION:x') | Error('BAD_PASSWORD')
   */
  async function decrypt(password, obv) {
    obv = toU8(obv);
    const h = parseHeader(obv);
    const key = await deriveKey(password, h.salt, h.iterations);
    let ptBuf;
    try {
      ptBuf = await subtle().decrypt(
        { name: 'AES-GCM', iv: h.iv, additionalData: obv.slice(0, h.headerLen), tagLength: 128 },
        key,
        obv.slice(h.headerLen)
      );
    } catch (_) {
      throw new Error('BAD_PASSWORD');
    }
    const pt = new Uint8Array(ptBuf);
    const payload = pt.slice(h.metaLen);
    let meta = null;
    try {
      meta = JSON.parse(TD.decode(pt.subarray(0, h.metaLen)));
    } catch (_) { /* metadata is best-effort */ }
    return { payload, meta };
  }

  OB.crypto = {
    MAGIC,
    VERSION,
    DEFAULT_ITERATIONS,
    HEADER_LEN,
    randomBytes,
    wipe,
    concatBytes,
    toU8,
    deriveKey,
    encrypt,
    decrypt,
    parseHeader,
  };
})();
