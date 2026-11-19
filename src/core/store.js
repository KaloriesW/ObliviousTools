'use strict';
/*
 * Oblivious session store + Encrypted Persistence Layer (EPL).
 *
 * SecureStore: per-app, RAM-only state holder. lock() best-effort wipes
 * contents and notifies listeners. Auto-locks on pagehide.
 *
 * EPL: stores opaque .obv ciphertext blobs in IndexedDB, keyed by app id.
 * Only ciphertext ever touches disk — apps encrypt via OB.crypto first.
 */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  /* ---------------- SecureStore ---------------- */

  function createStore(appId) {
    let state = null;
    let locked = true;
    const listeners = new Set();

    function emit() {
      for (const cb of Array.from(listeners)) {
        try { cb(state, locked); } catch (e) { console.error(e); }
      }
    }

    const store = {
      appId,
      get isLocked() { return locked; },
      get state() { return state; },
      unlock(initial) {
        locked = false;
        state = initial === undefined ? {} : initial;
        emit();
      },
      setState(next) {
        state = next;
        locked = false;
        emit();
      },
      patch(partial) {
        state = Object.assign({}, state || {}, partial);
        locked = false;
        emit();
      },
      /* Best-effort wipe: zero typed-array props, null everything else. */
      lock() {
        if (state && typeof state === 'object') {
          for (const k of Object.keys(state)) {
            const v = state[k];
            if (v instanceof Uint8Array || (v && ArrayBuffer.isView(v))) {
              try { v.fill(0); } catch (_) {}
            }
            state[k] = null;
          }
        }
        state = null;
        locked = true;
        emit();
      },
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };

    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('pagehide', () => store.lock());
    }
    return store;
  }

  /* ---------------- EPL (IndexedDB) ---------------- */

  const DB_NAME = 'oblivious';
  const STORE = 'vaults';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'appId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      let result;
      const req = fn(os);
      if (req) {
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
  }

  /**
   * Save an encrypted .obv blob for an app.
   * @param {string} appId  e.g. 'core', 'whisker', 'wire/playlist/mixtape'
   * @param {Uint8Array} obvBytes  ciphertext container from OB.crypto.encrypt
   */
  async function eplSave(appId, obvBytes, label) {
    obvBytes = OB.crypto.toU8(obvBytes);
    const copy = obvBytes.slice(); // detach from caller-owned buffer
    await tx('readwrite', (os) =>
      os.put({ appId, label: label || appId, data: copy, size: copy.length, updatedAt: Date.now() })
    );
  }

  /** @returns {Promise<Uint8Array|null>} */
  async function eplLoad(appId) {
    const rec = await tx('readonly', (os) => os.get(appId));
    return rec ? rec.data.slice() : null;
  }

  async function eplRemove(appId) {
    await tx('readwrite', (os) => os.delete(appId));
  }

  /** @returns {Promise<{appId:string,label:string,size:number,updatedAt:number}[]>} */
  async function eplList() {
    const rows = (await tx('readonly', (os) => os.getAll())) || [];
    return rows
      .map((r) => ({ appId: r.appId, label: r.label, size: r.size, updatedAt: r.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function eplClear() {
    await tx('readwrite', (os) => os.clear());
  }

  OB.store = { createStore };
  OB.epl = { save: eplSave, load: eplLoad, remove: eplRemove, list: eplList, clear: eplClear };
})();
