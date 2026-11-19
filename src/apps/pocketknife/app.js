'use strict';
/* Pocketknife app controller: library, tabs, editors, encrypted save/load. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = OB.ui.esc;

  const store = OB.store.createStore('pocketknife');
  const library = { docs: [] };
  let activeKind = 'doc';
  let openDocId = null;
  let editor = null;
  let dirty = false;
  let vaultPw = null;
  let vaultUnlocked = false;

  const main = $('#pk-main');
  const titleInput = $('.pk-title-input');

  const KIND_LABEL = { doc: 'Document', sheet: 'Spreadsheet', deck: 'Presentation' };
  const KIND_ICON = { doc: '📝', sheet: '▦', deck: '▤' };

  function newDoc(kind) {
    const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = kind === 'doc' ? { html: '' }
      : kind === 'sheet' ? { cells: {}, rows: 60, cols: 20 }
      : { slides: [{ elements: [] }] };
    const doc = { id, kind, name: 'Untitled ' + KIND_LABEL[kind], created: Date.now(), updated: Date.now(), data };
    library.docs.unshift(doc);
    openDoc(doc.id);
  }

  function openDoc(id) {
    const doc = library.docs.find((d) => d.id === id);
    if (!doc) return;
    openDocId = id;
    titleInput.disabled = false;
    titleInput.value = doc.name;
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0';
    main.innerHTML = '';
    main.appendChild(host);
    const opts = { doc, host, onDirty: markDirty };
    editor = doc.kind === 'doc' ? OB.docs.create(opts) : doc.kind === 'sheet' ? OB.sheets.create(opts) : OB.slides.create(opts);
    setTimeout(() => editor.focus(), 50);
  }

  function closeToLibrary() {
    if (dirty) {
      const lose = confirmDiscard();
      if (!lose) return;
    }
    openDocId = null;
    editor = null;
    titleInput.disabled = true;
    titleInput.value = 'Library';
    renderLibrary();
  }

  function confirmDiscard() { return true; }

  function markDirty() {
    if (!dirty) {
      dirty = true;
      scheduleAutosave();
    }
  }

  /* ---------- library view ---------- */

  function renderLibrary() {
    main.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pk-library';
    const docs = library.docs.filter((d) => d.kind === activeKind);
    const head = document.createElement('div');
    head.className = 'pk-lib-head';
    head.innerHTML = '<h2>' + KIND_LABEL[activeKind] + 's</h2><span class="ob-faint" style="font-size:13px">' +
      docs.length + ' in RAM' + (vaultUnlocked ? ' · vault unlocked' : '') + '</span>';
    wrap.appendChild(head);
    if (!docs.length) {
      const empty = document.createElement('div');
      empty.className = 'ob-panel';
      empty.style.textAlign = 'center';
      empty.innerHTML = '<div class="ob-dim">Nothing here yet. Documents live in RAM this session —<br>' +
        'use <b>Save</b> to encrypt them to a file or this device.</div>';
      wrap.appendChild(empty);
    }
    for (const doc of docs) {
      const row = document.createElement('div');
      row.className = 'pk-doc-row';
      row.innerHTML =
        '<div class="pk-doc-kind pk-k-' + doc.kind + '">' + KIND_ICON[doc.kind] + '</div>' +
        '<div class="ob-grow"><div class="pk-doc-name">' + esc(doc.name) + '</div>' +
        '<div class="pk-doc-meta">edited ' + OB.ui.fmtDate(doc.updated) + '</div></div>' +
        '<button class="ob-btn sm ghost" data-rename>✎</button>' +
        '<button class="ob-btn sm ghost" data-dup>⧉</button>' +
        '<button class="ob-btn sm ghost" data-export>🔒 .obv</button>' +
        '<button class="ob-btn sm ghost" data-del>🗑</button>';
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openDoc(doc.id);
      });
      row.querySelector('[data-rename]').addEventListener('click', async () => {
        const name = await OB.ui.textPrompt({ title: 'Rename', label: 'Name', value: doc.name });
        if (name) { doc.name = name; doc.updated = Date.now(); renderLibrary(); }
      });
      row.querySelector('[data-dup]').addEventListener('click', () => {
        const copy = JSON.parse(JSON.stringify(doc));
        copy.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        copy.name = doc.name + ' copy';
        copy.created = copy.updated = Date.now();
        library.docs.unshift(copy);
        renderLibrary();
      });
      row.querySelector('[data-export]').addEventListener('click', () => exportDoc(doc));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        const yes = await OB.ui.confirmDialog({ title: 'Delete "' + doc.name + '"?', body: 'Removed from RAM. Saved .obv copies are unaffected.', okLabel: 'Delete', danger: true });
        if (!yes) return;
        library.docs = library.docs.filter((d) => d !== doc);
        renderLibrary();
      });
      wrap.appendChild(row);
    }
    main.appendChild(wrap);
  }

  /* ---------- save / load ---------- */

  function libBytes(pw) {
    const json = JSON.stringify(library);
    return OB.crypto.encrypt(pw, json, { app: 'pocketknife', kind: 'library', docs: library.docs.length });
  }

  async function saveLibrary() {
    let pw = vaultPw;
    if (!pw) {
      pw = await OB.ui.passwordDialog({ title: 'Encrypt library', confirm: true, note: 'AES-256-GCM · password is never stored', okLabel: 'Encrypt' });
      if (!pw) return;
    }
    OB.ui.toast('Encrypting…');
    const bytes = await libBytes(pw);
    vaultPw = pw;
    vaultUnlocked = true;
    const dl = await OB.ui.confirmDialog({ title: 'Save where?', body: 'Download ' + (bytes.length / 1024).toFixed(1) + ' KB .obv file, or keep it on this device (encrypted)?', okLabel: 'Download file' });
    if (dl) {
      OB.ui.download('pocketknife.obv', bytes);
      dirty = false;
    } else {
      try {
        await OB.epl.save('pocketknife/library', bytes, 'Pocketknife library');
        OB.ui.toast('Saved on this device (encrypted)', 'ok');
        dirty = false;
      } catch (e) {
        OB.ui.toast('Device storage unavailable: ' + e.message, 'err');
      }
    }
  }

  async function exportDoc(doc) {
    const pw = await OB.ui.passwordDialog({ title: 'Encrypt "' + doc.name + '"', confirm: true, okLabel: 'Encrypt' });
    if (!pw) return;
    const bytes = await OB.crypto.encrypt(pw, JSON.stringify(doc), { app: 'pocketknife', kind: doc.kind, name: doc.name });
    OB.ui.download(doc.name.replace(/[^\w\- ]+/g, '_') + '.obv', bytes);
  }

  async function importObv() {
    const files = await OB.ui.pickFiles({ accept: '.obv' });
    const file = files[0];
    if (!file) return;
    const pw = await OB.ui.passwordDialog({ title: 'Unlock ' + file.name });
    if (!pw) return;
    try {
      const { payload, meta } = await OB.crypto.decrypt(pw, new Uint8Array(await file.arrayBuffer()));
      const json = JSON.parse(new TextDecoder().decode(payload));
      if (meta && meta.app === 'pocketknife' && meta.kind === 'library') {
        if (library.docs.length) {
          const replace = await OB.ui.confirmDialog({ title: 'Replace current library?', body: 'Found ' + json.docs.length + ' documents inside. Replace the ' + library.docs.length + ' currently in RAM?', okLabel: 'Replace', danger: true });
          if (!replace) return;
        }
        library.docs = json.docs || [];
        vaultPw = pw;
        vaultUnlocked = true;
        dirty = false;
        closeToLibrary();
        renderLibrary();
        OB.ui.toast('Library loaded (' + library.docs.length + ' docs)', 'ok');
      } else if (meta && meta.app === 'pocketknife') {
        library.docs.unshift(json);
        markDirty();
        renderLibrary();
        OB.ui.toast('"' + (meta.name || 'document') + '" added', 'ok');
      } else {
        OB.ui.toast('Not a Pocketknife file', 'err');
      }
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Load failed: ' + e.message, 'err');
    }
  }

  async function importPlain() {
    if (!openDocId) { OB.ui.toast('Open a document first', 'err'); return; }
    const doc = library.docs.find((d) => d.id === openDocId);
    if (!doc) return;
    if (doc.kind === 'deck') { OB.ui.toast('Decks import via .obv files', 'err'); return; }
    const accept = doc.kind === 'doc' ? '.txt,.md,.html,.htm' : '.csv,.xlsx';
    const files = await OB.ui.pickFiles({ accept });
    const file = files[0];
    if (!file) return;
    if (doc.kind === 'doc') {
      const text = await file.text();
      if (/\.md$/i.test(file.name)) editor.importHtml(OB.docs.mdToHtml(text));
      else if (/\.html?$/i.test(file.name)) editor.importHtml(text);
      else editor.importText(text);
      doc.name = file.name.replace(/\.[^.]+$/, '');
      titleInput.value = doc.name;
      OB.ui.toast('Imported ' + file.name, 'ok');
    } else {
      if (/\.csv$/i.test(file.name)) {
        editor.importCsv(await file.text());
      } else {
        editor.importXlsx(new Uint8Array(await file.arrayBuffer()));
      }
      doc.name = file.name.replace(/\.[^.]+$/, '');
      titleInput.value = doc.name;
      OB.ui.toast('Imported ' + file.name, 'ok');
    }
    markDirty();
  }

  async function exportPlain() {
    if (!openDocId) return;
    const doc = library.docs.find((d) => d.id === openDocId);
    if (!doc) return;
    const base = doc.name.replace(/[^\w\- ]+/g, '_');
    if (doc.kind === 'doc') {
      const which = await OB.ui.confirmDialog({ title: 'Export format', body: 'Yes = Markdown (.md) · No = HTML (.html)', okLabel: 'Markdown' });
      if (which) OB.ui.download(base + '.md', editor.toMarkdown(), 'text/markdown');
      else OB.ui.download(base + '.html', editor.toStandaloneHtml(), 'text/html');
    } else if (doc.kind === 'sheet') {
      const which = await OB.ui.confirmDialog({ title: 'Export format', body: 'Yes = .xlsx (with formulas) · No = .csv', okLabel: 'XLSX' });
      if (which) editor.exportXlsx();
      else editor.exportCsv();
    } else {
      editor.printDeck();
    }
  }

  /* ---------- autosave ---------- */

  let saveTimer = null;
  function scheduleAutosave() {
    if (!vaultUnlocked) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!dirty || !vaultPw) return;
      try {
        const bytes = await libBytes(vaultPw);
        await OB.epl.save('pocketknife/library', bytes, 'Pocketknife library');
        dirty = false;
      } catch (_) { /* silent */ }
    }, 4000);
  }

  /* ---------- EPL banner ---------- */

  async function initBanner() {
    try {
      const entries = await OB.epl.list();
      if (entries.some((e) => e.appId === 'pocketknife/library')) {
        $('#pk-epl-banner').classList.remove('ob-hidden');
      }
    } catch (_) { /* no IDB */ }
  }

  $('#pk-epl-unlock').addEventListener('click', async () => {
    const pw = await OB.ui.passwordDialog({ title: 'Unlock library' });
    if (!pw) return;
    try {
      const bytes = await OB.epl.load('pocketknife/library');
      const { payload, meta } = await OB.crypto.decrypt(pw, bytes);
      const json = JSON.parse(new TextDecoder().decode(payload));
      if (meta.app !== 'pocketknife') throw new Error('NOT_OBV pocketknife');
      if (library.docs.length) {
        const replace = await OB.ui.confirmDialog({ title: 'Replace current library?', body: json.docs.length + ' documents inside.', okLabel: 'Replace', danger: true });
        if (!replace) { $('#pk-epl-banner').classList.add('ob-hidden'); return; }
      }
      library.docs = json.docs || [];
      vaultPw = pw;
      vaultUnlocked = true;
      dirty = false;
      $('#pk-epl-banner').classList.add('ob-hidden');
      renderLibrary();
      OB.ui.toast('Library unlocked — autosave on', 'ok');
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Unlock failed', 'err');
    }
  });
  $('#pk-epl-ignore').addEventListener('click', () => $('#pk-epl-banner').classList.add('ob-hidden'));

  /* ---------- wiring ---------- */

  $$('#pk-tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#pk-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    activeKind = b.dataset.kind;
    if (openDocId) closeToLibrary();
    else renderLibrary();
  }));

  $('#pk-new').addEventListener('click', () => newDoc(activeKind));
  $('#pk-import').addEventListener('click', async () => {
    const obv = await OB.ui.confirmDialog({ title: 'Import what?', body: 'Yes = encrypted .obv file · No = plain file into the open document', okLabel: '.obv file' });
    if (obv) importObv();
    else importPlain();
  });
  $('#pk-save').addEventListener('click', async () => {
    const what = await OB.ui.confirmDialog({ title: 'Save what?', body: 'Yes = whole library (encrypted) · No = export open document as plain file', okLabel: 'Library (.obv)' });
    if (what) saveLibrary();
    else exportPlain();
  });

  titleInput.addEventListener('input', () => {
    const doc = library.docs.find((d) => d.id === openDocId);
    if (doc) { doc.name = titleInput.value; markDirty(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty && library.docs.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveLibrary();
    }
  });

  renderLibrary();
  initBanner();
})();
