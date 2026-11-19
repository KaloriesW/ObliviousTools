'use strict';
/* Whisker model library — GGUF models persisted in IndexedDB where available,
   with a RAM fallback (session-only) for contexts where IDB is blocked
   (e.g. file:// in Chrome). Public binaries, not secrets. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const DB_NAME = 'oblivious-models';
  const STORE = 'models';
  const TX_TIMEOUT = 5000;

  const mem = new Map(); // id → full record (with parts), session cache
  let dbp = null;
  let dbBroken = false;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('model db failed'));
      req.onblocked = () => reject(new Error('model db blocked'));
      setTimeout(() => reject(new Error('model db open timeout')), TX_TIMEOUT);
    });
    dbp.catch(() => { dbBroken = true; });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(STORE, mode);
      } catch (e) {
        reject(e);
        return;
      }
      const req = fn(t.objectStore(STORE));
      let result;
      if (req) {
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
      setTimeout(() => reject(new Error('idb timeout')), TX_TIMEOUT);
    }));
  }

  function summary(rec) {
    return { id: rec.id, name: rec.name, size: rec.size, parts: rec.parts.length, addedAt: rec.addedAt };
  }

  async function list() {
    const out = new Map();
    for (const [id, rec] of mem) out.set(id, summary(rec));
    try {
      const rows = (await tx('readonly', (os) => os.getAll())) || [];
      for (const r of rows || []) {
        if (!out.has(r.appId) && r && r.id && Array.isArray(r.parts)) out.set(r.id, summary(r));
      }
    } catch (_) { /* idb unavailable — memory only */ }
    return Array.from(out.values()).sort((a, b) => b.addedAt - a.addedAt);
  }

  async function add(name, files) {
    const parts = files.slice();
    const size = parts.reduce((s, f) => s + f.size, 0);
    const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = { id, name, size, parts, addedAt: Date.now() };
    mem.set(id, rec);
    try {
      await tx('readwrite', (os) => os.put(rec));
    } catch (_) { /* session-only on this device */ }
    return summary(rec);
  }

  async function get(id) {
    if (mem.has(id)) return mem.get(id);
    try {
      const rec = await tx('readonly', (os) => os.get(id));
      return rec || null;
    } catch (_) {
      return null;
    }
  }

  async function remove(id) {
    mem.delete(id);
    try {
      await tx('readwrite', (os) => os.delete(id));
    } catch (_) { /* session-only */ }
  }

  async function storageAvailable() {
    if (dbBroken) return false;
    try {
      await open();
      return true;
    } catch (_) {
      return false;
    }
  }

  OB.models = { list, add, get, remove, storageAvailable };
})();
