'use strict';
/* Oblivious — Core app: encrypt/decrypt tool + device vault manager. */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = OB.ui.esc;
  const fmtBytes = OB.ui.fmtBytes;

  /* ==================== home screen ==================== */

  function tickClock() {
    const now = new Date();
    $('.clock-time').textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    $('.clock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tickClock();
  setInterval(tickClock, 15000);

  function openCoreApp() {
    $('#core-app').classList.add('open');
    switchTab('encrypt');
  }
  $('#open-core').addEventListener('click', openCoreApp);
  $('#back-home').addEventListener('click', () => {
    clearEncryptState();
    clearDecryptState();
    $('#core-app').classList.remove('open');
  });

  /* ==================== tabs ==================== */

  function switchTab(name) {
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    ['encrypt', 'decrypt', 'device'].forEach((t) => {
      $('#tab-' + t).classList.toggle('ob-hidden', t !== name);
    });
    if (name === 'device') refreshDeviceList();
  }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ==================== shared helpers ==================== */

  let busy = false;
  function setBusy(on, noteEl) {
    busy = on;
    if (noteEl) noteEl.classList.toggle('ob-hidden', !on);
    $$('#tab-encrypt button, #tab-decrypt button').forEach((b) => (b.disabled = on && b.id !== 'back-home'));
  }

  function wireDropzone(zone, handler) {
    zone.addEventListener('click', () => handler());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) handler(files);
    });
  }

  function safeName(name) {
    return String(name).replace(/[\/\\\u0000-\u001f]/g, '_').slice(0, 96) || 'file';
  }

  /* ==================== ENCRYPT ==================== */

  let pendingFiles = [];

  function clearEncryptState() {
    pendingFiles = [];
    renderEncryptFiles();
    $('#enc-pw').value = '';
    $('#enc-pw2').value = '';
    $('#enc-label').value = '';
    $('#enc-result').innerHTML = '';
  }

  async function addFiles(files) {
    for (const f of files) {
      if (pendingFiles.some((p) => p.name === f.name && p.size === f.size)) continue;
      pendingFiles.push({ file: f, name: safeName(f.name), size: f.size, type: f.type });
    }
    renderEncryptFiles();
  }

  function renderEncryptFiles() {
    const host = $('#enc-files');
    host.innerHTML = '';
    $('#enc-form').classList.toggle('ob-hidden', pendingFiles.length === 0);
    for (const p of pendingFiles) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML =
        '<span class="f-name">' + esc(p.name) + '</span>' +
        '<span class="f-size">' + fmtBytes(p.size) + '</span>' +
        '<button class="f-remove" title="Remove">✕</button>';
      row.querySelector('.f-remove').addEventListener('click', () => {
        pendingFiles = pendingFiles.filter((x) => x !== p);
        renderEncryptFiles();
      });
      host.appendChild(row);
    }
  }

  wireDropzone($('#enc-drop'), async (dropped) => {
    const files = dropped || (await OB.ui.pickFiles({ multiple: true }));
    if (files.length) await addFiles(files);
  });

  $('#enc-go').addEventListener('click', async () => {
    if (busy) return;
    if (pendingFiles.length === 0) return;
    const pw = $('#enc-pw').value;
    const pw2 = $('#enc-pw2').value;
    if (!pw) { $('#enc-pw').focus(); return; }
    if (pw !== pw2) { OB.ui.toast('Passwords do not match', 'err'); return; }
    if (pw.length < 4) { OB.ui.toast('Password must be at least 4 characters', 'err'); return; }

    setBusy(true, $('#enc-busy'));
    $('#enc-result').innerHTML = '';
    await new Promise((r) => setTimeout(r, 30)); // let UI paint before the KDF blocks

    let payload = null;
    try {
      let meta;
      if (pendingFiles.length === 1) {
        const p = pendingFiles[0];
        payload = new Uint8Array(await p.file.arrayBuffer());
        meta = { kind: 'file', name: p.name, type: p.type || 'application/octet-stream', size: payload.length };
      } else {
        const tarFiles = [];
        for (const p of pendingFiles) {
          tarFiles.push({ name: p.name, bytes: new Uint8Array(await p.file.arrayBuffer()) });
        }
        payload = OB.tar.makeTar(tarFiles);
        meta = {
          kind: 'bundle',
          files: tarFiles.map((f) => ({ name: f.name, size: f.bytes.length })),
          size: payload.length,
        };
      }
      meta.app = 'core';
      meta.created = Date.now();

      const box = await OB.crypto.encrypt(pw, payload, meta);
      OB.crypto.wipe(payload);
      const base = ($('#enc-label').value.trim() || (meta.kind === 'file' ? meta.name : 'bundle')).replace(/\.obv$/i, '');
      const fileName = safeName(base) + '.obv';
      renderEncryptResult(box, fileName, meta);
      OB.ui.toast('Encrypted', 'ok');
    } catch (e) {
      console.error(e);
      OB.ui.toast('Encryption failed: ' + e.message, 'err');
    } finally {
      $('#enc-pw').value = '';
      $('#enc-pw2').value = '';
      setBusy(false, $('#enc-busy'));
    }
  });

  function renderEncryptResult(box, fileName, meta) {
    const host = $('#enc-result');
    const fileCount = meta.kind === 'bundle' ? meta.files.length : 1;
    host.innerHTML =
      '<div class="result-card">' +
      '<div style="font-weight:650;margin-bottom:6px">' + esc(fileName) + '</div>' +
      '<div class="meta-line">' + fmtBytes(box.length) + ' · ' + fileCount + ' file' + (fileCount > 1 ? 's' : '') + ' inside · AES-256-GCM</div>' +
      '<div class="ob-row" style="margin-top:12px">' +
      '<button class="ob-btn primary" data-dl>Download .obv</button>' +
      '<button class="ob-btn" data-device>Save on this device</button>' +
      '</div></div>';

    host.querySelector('[data-dl]').addEventListener('click', () => {
      OB.ui.download(fileName, box);
    });
    host.querySelector('[data-device]').addEventListener('click', async () => {
      try {
        const appId = 'core/' + fileName.replace(/\.obv$/i, '');
        await OB.epl.save(appId, box, fileName);
        OB.ui.toast('Saved on this device (encrypted)', 'ok');
      } catch (e) {
        OB.ui.toast('Device storage unavailable here: ' + e.message, 'err');
      }
    });
  }

  /* ==================== DECRYPT ==================== */

  let decBytes = null; // ciphertext currently staged

  function clearDecryptState() {
    decBytes = null;
    $('#dec-stage').innerHTML = '';
  }

  wireDropzone($('#dec-drop'), async (dropped) => {
    const files = dropped || (await OB.ui.pickFiles({ accept: '.obv,application/octet-stream' }));
    const file = files[0];
    if (!file) return;
    await stageObv(new Uint8Array(await file.arrayBuffer()), file.name);
  });

  async function stageObv(bytes, displayName) {
    clearDecryptState();
    let header;
    try {
      header = OB.crypto.parseHeader(bytes);
    } catch (e) {
      OB.ui.toast('Not an Oblivious file (bad magic)', 'err');
      return;
    }
    decBytes = bytes;
    const stage = $('#dec-stage');
    stage.innerHTML =
      '<div class="result-card" style="margin-top:16px">' +
      '<div style="font-weight:650">' + esc(displayName || 'encrypted file') + '</div>' +
      '<div class="meta-line">' + fmtBytes(bytes.length) + ' · ' + header.iterations.toLocaleString() + ' iterations · v' + header.version + '</div>' +
      '<div class="ob-row" style="margin-top:12px">' +
      '<input class="ob-input ob-mono ob-grow" id="dec-pw" type="password" placeholder="Password" autocomplete="off">' +
      '<button class="ob-btn primary" id="dec-go">Unlock</button>' +
      '</div>' +
      '<div class="busy-note ob-hidden" id="dec-busy">Deriving key…</div>' +
      '<div id="dec-result"></div>' +
      '</div>';
    const pwEl = $('#dec-pw');
    pwEl.focus();
    const go = async () => {
      if (busy || !decBytes) return;
      const pw = pwEl.value;
      if (!pw) { pwEl.focus(); return; }
      setBusy(true, $('#dec-busy'));
      await new Promise((r) => setTimeout(r, 30));
      try {
        const { payload, meta } = await OB.crypto.decrypt(pw, decBytes);
        renderDecryptResult(payload, meta);
        OB.ui.toast('Unlocked', 'ok');
      } catch (e) {
        if (e.message === 'BAD_PASSWORD') OB.ui.toast('Wrong password', 'err');
        else OB.ui.toast('Decrypt failed: ' + e.message, 'err');
      } finally {
        pwEl.value = '';
        setBusy(false, $('#dec-busy'));
      }
    };
    $('#dec-go').addEventListener('click', go);
    pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function fileRow(name, bytes, extra) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML =
      '<span class="f-name">' + esc(name) + '</span>' +
      '<span class="f-size">' + fmtBytes(bytes.length) + '</span>' +
      '<button class="ob-btn sm">Download</button>' + (extra || '');
    row.querySelector('button').addEventListener('click', () => OB.ui.download(name, bytes));
    return row;
  }

  function renderDecryptResult(payload, meta) {
    const host = $('#dec-result');
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.marginTop = '14px';

    if (meta && meta.kind === 'bundle') {
      let entries;
      try {
        entries = OB.tar.readTar(payload);
      } catch (e) {
        OB.ui.toast('Could not read bundle: ' + e.message, 'err');
        return;
      }
      const all = document.createElement('button');
      all.className = 'ob-btn sm';
      all.textContent = 'Download all (' + entries.length + ')';
      all.style.margin = '0 0 10px';
      all.addEventListener('click', async () => {
        for (const en of entries) {
          OB.ui.download(en.name, en.bytes);
          await new Promise((r) => setTimeout(r, 350));
        }
      });
      wrap.appendChild(all);
      for (const en of entries) wrap.appendChild(fileRow(en.name, en.bytes));
    } else {
      const name = (meta && meta.name) || 'decrypted.bin';
      wrap.appendChild(fileRow(name, payload));
    }
    host.appendChild(wrap);
  }

  /* ==================== DEVICE (EPL) ==================== */

  async function refreshDeviceList() {
    const host = $('#device-list');
    host.innerHTML = '<p class="ob-dim">Loading…</p>';
    let entries;
    try {
      entries = await OB.epl.list();
    } catch (e) {
      host.innerHTML =
        '<div class="result-card err">Device storage is unavailable in this context (opened via <span class="ob-mono">file://</span> in Chrome, or IndexedDB blocked).<br>' +
        'Download .obv files instead — they work everywhere.</div>';
      return;
    }
    if (entries.length === 0) {
      host.innerHTML =
        '<div class="ob-panel ob-dim" style="text-align:center">Nothing saved on this device yet.<br>' +
        'Encrypt something, then choose “Save on this device”.</div>';
      return;
    }
    host.innerHTML = '';
    for (const en of entries) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML =
        '<span class="f-name">' + esc(en.label || en.appId) + '</span>' +
        '<span class="f-size">' + fmtBytes(en.size) + ' · ' + esc(OB.ui.fmtDate(en.updatedAt)) + '</span>' +
        '<button class="ob-btn sm primary" data-open>Open</button>' +
        '<button class="ob-btn sm" data-save>Save file</button>' +
        '<button class="ob-btn sm danger" data-del>✕</button>';
      row.querySelector('[data-open]').addEventListener('click', async () => {
        try {
          const bytes = await OB.epl.load(en.appId);
          if (!bytes) return;
          switchTab('decrypt');
          await stageObv(bytes, en.label || en.appId);
        } catch (e) {
          OB.ui.toast('Load failed: ' + e.message, 'err');
        }
      });
      row.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          const bytes = await OB.epl.load(en.appId);
          if (bytes) OB.ui.download((en.label || en.appId).replace(/[\/]/g, '_') + '.obv', bytes);
        } catch (e) {
          OB.ui.toast('Load failed: ' + e.message, 'err');
        }
      });
      row.querySelector('[data-del]').addEventListener('click', async () => {
        const yes = await OB.ui.confirmDialog({
          title: 'Delete from this device?',
          body: 'The encrypted entry “' + (en.label || en.appId) + '” will be removed. If you have no .obv copy, its contents are gone forever.',
          okLabel: 'Delete',
          danger: true,
        });
        if (!yes) return;
        try {
          await OB.epl.remove(en.appId);
          refreshDeviceList();
        } catch (e) {
          OB.ui.toast('Delete failed: ' + e.message, 'err');
        }
      });
      host.appendChild(row);
    }
  }
})();
