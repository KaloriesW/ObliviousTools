'use strict';
/* Whisker — Claude-style local AI chat. RAM-only sessions, encrypted vault. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = OB.ui.esc;

  /* ================= state ================= */

  let conversations = [];
  let projects = [];
  let settings = { endpoint: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', temperature: 0.7 };
  let apiKey = '';
  let onlineMode = false;

  let activeId = null;
  let vaultPw = null;
  let vaultUnlocked = false;
  let dirty = false;
  let generating = false;
  let abortStream = false;
  let sseController = null;

  const RENDER_CHUNK = 40;
  let renderedCount = 0;

  const convo = () => conversations.find((c) => c.id === activeId);

  function newConversation() {
    const c = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: 'New chat',
      created: Date.now(),
      updated: Date.now(),
      model: OB.engine.loadedName || settings.modelId,
      projectId: null,
      messages: [],
    };
    conversations.unshift(c);
    activeId = c.id;
    renderedCount = 0;
    renderSidebar();
    renderConversation();
    markDirty();
    focusComposer();
    return c;
  }

  /* ================= vault ================= */

  function vaultObj() {
    return { conversations, projects, settings };
  }

  async function encryptVault() {
    return OB.crypto.encrypt(vaultPw, JSON.stringify(vaultObj()), { app: 'whisker', kind: 'vault', chats: conversations.length });
  }

  function markDirty() {
    dirty = true;
    scheduleAutosave();
  }

  let saveTimer = null;
  function scheduleAutosave() {
    if (!vaultUnlocked || !vaultPw) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!dirty) return;
      try {
        const bytes = await encryptVault();
        await OB.epl.save('whisker/vault', bytes, 'Whisker chats');
        dirty = false;
      } catch (_) { /* silent */ }
    }, 4000);
  }

  async function saveVault(firstTime) {
    let pw = vaultPw;
    if (!pw) {
      pw = await OB.ui.passwordDialog({ title: 'Encrypt chat history', confirm: true, okLabel: 'Encrypt' });
      if (!pw) return;
      vaultPw = pw;
    }
    const bytes = await encryptVault();
    const dl = await OB.ui.confirmDialog({ title: 'Save where?', body: (bytes.length / 1024).toFixed(1) + ' KB encrypted. Download .obv or keep on this device?', okLabel: 'Download file' });
    if (dl) OB.ui.download('whisker.obv', bytes);
    else {
      try {
        await OB.epl.save('whisker/vault', bytes, 'Whisker chats');
        OB.ui.toast('Saved on this device (encrypted)', 'ok');
      } catch (e) {
        OB.ui.toast('Device storage unavailable: ' + e.message, 'err');
      }
    }
    vaultUnlocked = true;
    dirty = false;
    updateVaultPill();
  }

  async function importVault() {
    const files = await OB.ui.pickFiles({ accept: '.obv' });
    if (!files[0]) return;
    const pw = await OB.ui.passwordDialog({ title: 'Unlock ' + files[0].name });
    if (!pw) return;
    try {
      const { payload, meta } = await OB.crypto.decrypt(pw, new Uint8Array(await files[0].arrayBuffer()));
      if (meta.app !== 'whisker') { OB.ui.toast('Not a Whisker vault', 'err'); return; }
      const data = JSON.parse(new TextDecoder().decode(payload));
      conversations = data.conversations || [];
      projects = data.projects || [];
      settings = Object.assign(settings, data.settings || {});
      vaultPw = pw;
      vaultUnlocked = true;
      activeId = conversations[0] ? conversations[0].id : null;
      renderedCount = 0;
      renderSidebar();
      renderConversation();
      updateVaultPill();
      OB.ui.toast('Vault loaded — ' + conversations.length + ' chats', 'ok');
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Load failed', 'err');
    }
  }

  function lockVault() {
    conversations = [];
    projects = [];
    activeId = null;
    renderedCount = 0;
    vaultPw = null;
    vaultUnlocked = false;
    dirty = false;
    apiKey = '';
    onlineMode = false;
    OB.rag.clear();
    renderSidebar();
    renderConversation();
    updateVaultPill();
    updateModelPill();
    OB.ui.toast('Locked — memory wiped', 'ok');
  }

  async function unlockDeviceVault() {
    const pw = await OB.ui.passwordDialog({ title: 'Unlock chat history' });
    if (!pw) return;
    try {
      const bytes = await OB.epl.load('whisker/vault');
      const { payload, meta } = await OB.crypto.decrypt(pw, bytes);
      if (meta.app !== 'whisker') throw new Error('NOT_WHISKER');
      const data = JSON.parse(new TextDecoder().decode(payload));
      conversations = data.conversations || [];
      projects = data.projects || [];
      settings = Object.assign(settings, data.settings || {});
      vaultPw = pw;
      vaultUnlocked = true;
      activeId = conversations[0] ? conversations[0].id : null;
      $('#wh-banner').classList.add('ob-hidden');
      renderSidebar();
      renderConversation();
      updateVaultPill();
      OB.ui.toast('Unlocked — autosave on', 'ok');
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Unlock failed', 'err');
    }
  }

  /* ================= model gate ================= */

  async function renderGate() {
    const gate = $('#wh-gate');
    const list = $('#wh-model-list');
    list.innerHTML = '<p class="ob-faint">Loading…</p>';
    gate.classList.remove('ob-hidden');
    const models = await OB.models.list();
    const persistent = await OB.models.storageAvailable();
    if (!persistent) {
      list.innerHTML = '<p class="ob-dim">Model storage (IndexedDB) is unavailable here (file:// in Chrome).<br>' +
        'Models last this session only — the engine itself still runs fully offline.</p>';
    } else if (models.length === 0) {
      list.innerHTML = '<p class="ob-dim">No models yet. Add a <b>.gguf</b> file — it stays on this device.</p>';
    } else {
      list.innerHTML = '';
      for (const m of models) {
        const card = document.createElement('div');
        card.className = 'wh-model-card';
        card.innerHTML =
          '<div class="ob-grow"><div class="wh-model-name">' + esc(m.name) + '</div>' +
          '<div class="wh-model-meta">' + OB.ui.fmtBytes(m.size) + ' · added ' + OB.ui.fmtDate(m.addedAt) +
          (m.parts > 1 ? ' · ' + m.parts + ' parts' : '') + '</div></div>' +
          '<button class="ob-btn primary sm" data-load>Load</button>' +
          '<button class="ob-btn ghost sm" data-del>🗑</button>';
        card.querySelector('[data-load]').addEventListener('click', () => loadFromLibrary(m));
        card.querySelector('[data-del]').addEventListener('click', async () => {
          const yes = await OB.ui.confirmDialog({ title: 'Delete model?', body: esc(m.name) + ' will be removed from this device.', okLabel: 'Delete', danger: true });
          if (!yes) return;
          await OB.models.remove(m.id);
          renderGate();
        });
        list.appendChild(card);
      }
    }
    const addCard = document.createElement('div');
    addCard.className = 'wh-model-card wh-model-add';
    addCard.innerHTML =
      '<div class="ob-grow"><div class="wh-model-name">＋ Add model</div>' +
      '<div class="wh-model-meta">drop a .gguf here or click to browse · split models: select all parts</div></div>';
    addCard.addEventListener('click', () => addModelDialog());
    addCard.addEventListener('dragover', (e) => { e.preventDefault(); addCard.classList.add('drag'); });
    addCard.addEventListener('dragleave', () => addCard.classList.remove('drag'));
    addCard.addEventListener('drop', (e) => {
      e.preventDefault();
      addCard.classList.remove('drag');
      const files = Array.from(e.dataTransfer.files || []).filter((f) => /\.gguf$/i.test(f.name));
      if (files.length) addModelFiles(files);
    });
    list.appendChild(addCard);

    const skip = document.createElement('button');
    skip.className = 'ob-btn ghost wh-gate-skip';
    skip.textContent = 'Skip — continue without a model (online mode / browsing)';
    skip.addEventListener('click', () => {
      gate.classList.add('ob-hidden');
      if (!activeId) newConversation();
      updateModelPill();
    });
    list.appendChild(skip);
  }

  async function addModelDialog() {
    const files = await OB.ui.pickFiles({ accept: '.gguf', multiple: true });
    if (!files.length) return;
    await addModelFiles(files);
  }

  async function addModelFiles(files) {
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const name = files[0].name.replace(/\.gguf$/i, '');
    OB.ui.toast('Storing ' + name + '…');
    try {
      const rec = await OB.models.add(name, files);
      OB.ui.toast('Model stored on this device', 'ok');
      renderGate();
      loadFromLibrary(rec);
    } catch (e) {
      OB.ui.toast('Could not store model: ' + e.message, 'err');
    }
  }

  async function loadFromLibrary(meta) {
    const gate = $('#wh-gate');
    const status = $('#wh-gate-status');
    status.textContent = 'Reading from device storage…';
    const rec = await OB.models.get(meta.id);
    if (!rec) { OB.ui.toast('Model not found', 'err'); renderGate(); return; }
    try {
      await OB.engine.loadModel(rec, (p) => {
        status.textContent = 'Loading ' + rec.name + ' into memory — ' + Math.round(p * 100) + '%';
      });
      gate.classList.add('ob-hidden');
      updateModelPill();
      OB.ui.toast('Model ready — ' + (navigator.gpu ? 'GPU' : 'CPU') + ', jinja templates', 'ok');
      if (!activeId) newConversation();
    } catch (e) {
      status.textContent = '';
      if (e.message === 'TIMEOUT') {
        OB.ui.toast('Model load timed out. Try a smaller model or fewer threads.', 'err', 6000);
      } else {
        OB.ui.toast('Model failed: ' + e.message, 'err', 6000);
      }
    }
  }

  function changeModel() {
    $('#wh-gate-status').textContent = '';
    renderGate();
  }

  /* ================= sidebar ================= */

  function relTime(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h';
    return Math.floor(d / 86400000) + 'd';
  }

  function renderSidebar() {
    const listEl = $('#wh-chat-list');
    listEl.innerHTML = '';
    for (const c of conversations) {
      const row = document.createElement('div');
      row.className = 'wh-chat-row' + (c.id === activeId ? ' on' : '');
      const proj = c.projectId ? projects.find((p) => p.id === c.projectId) : null;
      row.innerHTML =
        '<span class="wh-chat-title">' + esc(c.title) + '</span>' +
        (proj ? '<span class="wh-chat-proj">' + esc(proj.name) + '</span>' : '') +
        '<span class="wh-chat-time">' + relTime(c.updated) + '</span>' +
        '<button class="wh-chat-x" data-ren>✎</button>' +
        '<button class="wh-chat-x" data-del>🗑</button>';
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        activeId = c.id;
        renderedCount = 0;
        renderSidebar();
        renderConversation();
      });
      row.querySelector('[data-ren]').addEventListener('click', async () => {
        const name = await OB.ui.textPrompt({ title: 'Rename chat', label: 'Title', value: c.title });
        if (name) { c.title = name; renderSidebar(); markDirty(); }
      });
      row.querySelector('[data-del]').addEventListener('click', async () => {
        const yes = await OB.ui.confirmDialog({ title: 'Delete chat?', body: '"' + c.title + '" will be wiped from memory.', okLabel: 'Delete', danger: true });
        if (!yes) return;
        conversations = conversations.filter((x) => x !== c);
        if (activeId === c.id) { activeId = conversations[0] ? conversations[0].id : null; renderedCount = 0; renderConversation(); }
        renderSidebar();
        markDirty();
      });
      listEl.appendChild(row);
    }
    const projList = $('#wh-proj-list');
    projList.innerHTML = '';
    for (const p of projects) {
      const row = document.createElement('div');
      row.className = 'wh-chat-row wh-proj-row';
      row.innerHTML = '<span class="wh-chat-title">▸ ' + esc(p.name) + '</span><span class="wh-chat-time">project</span>';
      row.addEventListener('click', () => editProject(p));
      projList.appendChild(row);
    }
  }

  /* ================= conversation ================= */

  function renderConversation() {
    const host = $('#wh-messages');
    const c = convo();
    host.innerHTML = '';
    if (!c || !c.messages.length) {
      host.innerHTML =
        '<div class="wh-empty"><div class="wh-empty-mark">Whisker</div>' +
        '<div class="wh-empty-sub">running locally · nothing leaves this device</div></div>';
      return;
    }
    const start = Math.max(0, c.messages.length - renderedCount - RENDER_CHUNK);
    if (start > 0) {
      const more = document.createElement('button');
      more.className = 'ob-btn ghost sm wh-more';
      more.textContent = '↑ Show earlier messages';
      more.addEventListener('click', () => {
        renderedCount += RENDER_CHUNK;
        const scroll = host.scrollHeight;
        renderConversation();
        host.scrollTop = host.scrollHeight - scroll;
      });
      host.appendChild(more);
    }
    for (const m of c.messages.slice(start)) host.appendChild(messageEl(m));
    renderedCount = Math.max(renderedCount, Math.min(RENDER_CHUNK, c.messages.length));
    host.scrollTop = host.scrollHeight;
  }

  function messageEl(m) {
    const div = document.createElement('div');
    div.className = 'wh-msg wh-msg-' + m.role;
    if (m.role === 'user') {
      let inner = '<div class="wh-user-bubble">' + esc(m.content) + '</div>';
      const atts = m.attachments || [];
      if (atts.length) {
        inner += '<div class="wh-attachments">';
        for (const a of atts) {
          if (a.kind === 'image' && a.dataUrl) {
            inner += '<img class="wh-attach-img" src="' + a.dataUrl + '" alt="' + esc(a.name) + '">';
          } else {
            inner += '<span class="wh-attach-chip">📄 ' + esc(a.name) + '</span>';
          }
        }
        inner += '</div>';
      }
      div.innerHTML = inner;
    } else {
      div.innerHTML = OB.md.render(m.content);
    }
    const actions = document.createElement('div');
    actions.className = 'wh-msg-actions';
    const mk = (label, fn, title) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title || label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
      return b;
    };
    if (m.role === 'assistant') {
      mk('copy', () => OB.ui.copy(m.content, { toastMsg: 'Message copied' }), 'Copy message');
      mk('retry', () => retryFrom(m), 'Regenerate from here');
    } else {
      mk('copy', () => OB.ui.copy(m.content, { toastMsg: 'Message copied' }), 'Copy message');
      mk('edit', () => editMessage(m), 'Edit and resend');
    }
    div.appendChild(actions);
    return div;
  }

  async function retryFrom(m) {
    const c = convo();
    if (!c || generating) return;
    const idx = c.messages.indexOf(m);
    if (idx < 0) return;
    c.messages = c.messages.slice(0, idx);
    markDirty();
    renderConversation();
    if (!c.messages.length || c.messages[c.messages.length - 1].role !== 'user') {
      OB.ui.toast('Nothing to regenerate from', 'err');
      return;
    }
    await generate();
  }

  async function editMessage(m) {
    const c = convo();
    if (!c || generating) return;
    const target = Array.from($$('#wh-messages .wh-msg')).find((el) => el.querySelector('.wh-user-bubble')?.textContent === m.content);
    if (!target) return;
    const ta = document.createElement('textarea');
    ta.className = 'ob-textarea wh-edit-area';
    ta.value = m.content;
    const userDiv = target.querySelector('.wh-user-bubble');
    userDiv.replaceWith(ta);
    ta.focus();
    ta.style.height = ta.scrollHeight + 'px';
    const commit = async () => {
      const val = ta.value.trim();
      if (!val) return;
      const idx = c.messages.indexOf(m);
      c.messages = c.messages.slice(0, idx);
      c.messages.push({ role: 'user', content: val, ts: Date.now() });
      markDirty();
      renderConversation();
      await generate();
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') renderConversation();
    });
  }

  async function regenerate() {
    const c = convo();
    if (!c || generating) return;
    while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
    markDirty();
    renderConversation();
    await generate();
  }

  /* ================= generation ================= */

  function systemPrompt() {
    const c = convo();
    const proj = c && c.projectId ? projects.find((p) => p.id === c.projectId) : null;
    let sys = proj && proj.systemPrompt
      ? proj.systemPrompt
      : 'You are Whisker, a helpful AI assistant. Give short, direct answers.';
    if (proj && proj.files && proj.files.length) {
      sys += '\n\nProject knowledge:\n' + proj.files.map((f) => f.text.slice(0, 4000)).join('\n\n');
    }
    return sys;
  }

  async function withRag(c, userText) {
    let sys = systemPrompt();
    const lastUser = [...c.messages].reverse().find((m) => m.role === 'user');
    if (lastUser && lastUser.attachments) {
      const texts = lastUser.attachments.filter((a) => a.kind === 'text' && a.text).map((a) => '--- ' + a.name + ' ---\n' + a.text.slice(0, 6000));
      if (texts.length) sys += '\n\nAttached documents:\n' + texts.join('\n\n');
    }
    if (!OB.rag.chunks || !OB.engine.isLoaded) return sys;
    try {
      const chunks = await OB.rag.retrieve(userText);
      if (chunks.length) {
        sys += '\n\nRelevant context from document:\n' + chunks.join('\n\n');
      }
    } catch (_) { /* rag best effort */ }
    return sys;
  }

  async function generate() {
    const c = convo();
    if (!c || generating) return;
    const lastUser = [...c.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    generating = true;
    abortStream = false;
    setComposerBusy(true);

    const host = $('#wh-messages');
    Array.from(host.children).forEach((el) => { if (!el.classList.contains('wh-more') && !el.classList.contains('wh-empty')) el.querySelectorAll('.wh-msg-actions button')?.forEach((b) => (b.disabled = true)); });
    const div = document.createElement('div');
    div.className = 'wh-msg wh-msg-assistant wh-streaming';
    host.appendChild(div);
    host.scrollTop = host.scrollHeight;

    let full = '';
    try {
      if (onlineMode) {
        full = await streamOnline(c, (text) => {
          full = text;
          div.textContent = text;
          host.scrollTop = host.scrollHeight;
        });
      } else {
        if (!OB.engine.isLoaded) throw new Error('NO_MODEL');
        const sys = await withRag(c, lastUser.content);
        full = await OB.engine.complete(c.messages, {
          system: sys,
          temperature: settings.temperature,
          onToken: (text) => {
            div.textContent = text;
            host.scrollTop = host.scrollHeight;
          },
        });
      }
      c.messages.push({ role: 'assistant', content: full || '(stopped)', ts: Date.now() });
      c.updated = Date.now();
      c.title = c.title === 'New chat' && c.messages.length >= 2 ? c.messages[0].content.slice(0, 42) : c.title;
      markDirty();
      renderSidebar();
      renderConversation();
      const last = Array.from($$('#wh-messages .wh-msg')).pop();
      if (last) OB.artifacts.scanMessage(last);
    } catch (e) {
      if (e.message === 'NO_MODEL') OB.ui.toast('Load a model first (or enable online mode)', 'err');
      else if (!navigator.onLine && onlineMode) OB.ui.toast('Offline — online mode unreachable', 'err');
      else OB.ui.toast('Generation failed: ' + e.message, 'err');
      if (full) {
        c.messages.push({ role: 'assistant', content: full, ts: Date.now() });
        markDirty();
      }
      renderConversation();
    } finally {
      generating = false;
      setComposerBusy(false);
    }
  }

  async function streamOnline(c, onText) {
    const messages = [{ role: 'system', content: systemPrompt() }]
      .concat(c.messages.slice(-12).map((m) => ({ role: m.role, content: m.content })));
    sseController = new AbortController();
    const res = await fetch(settings.endpoint.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model: settings.modelId, messages, stream: true, temperature: settings.temperature }),
      signal: sseController.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const piece = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (piece) {
            full += piece;
            onText(full);
          }
        } catch (_) { /* partial */ }
      }
    }
    return full;
  }

  /* ================= attachments ================= */

  let pendingAttachments = [];

  function renderAttachmentChips() {
    const host = $('#wh-attach-row');
    host.innerHTML = '';
    pendingAttachments.forEach((a, i) => {
      const chip = document.createElement('span');
      chip.className = 'wh-attach-chip';
      if (a.kind === 'image' && a.dataUrl) {
        const img = document.createElement('img');
        img.src = a.dataUrl;
        img.alt = a.name;
        chip.appendChild(img);
      } else {
        chip.textContent = '📄 ' + a.name;
      }
      const x = document.createElement('button');
      x.className = 'wh-attach-x';
      x.textContent = '✕';
      x.title = 'Remove';
      x.addEventListener('click', () => {
        pendingAttachments.splice(i, 1);
        renderAttachmentChips();
      });
      chip.appendChild(x);
      host.appendChild(chip);
    });
    host.classList.toggle('ob-hidden', pendingAttachments.length === 0);
  }

  async function pickAttachments() {
    const files = await OB.ui.pickFiles({ accept: '.txt,.md,.pdf,image/*', multiple: true });
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        if (f.size > 4 * 1024 * 1024) { OB.ui.toast(f.name + ' too large (max 4 MB)', 'err'); continue; }
        const dataUrl = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(f);
        });
        pendingAttachments.push({ name: f.name, kind: 'image', dataUrl });
      } else {
        try {
          const text = await OB.rag.extractText(f);
          pendingAttachments.push({ name: f.name, kind: 'text', text });
          if (OB.engine.isLoaded) {
            OB.ui.toast('Indexing ' + f.name + '…', 'info', 1500);
            await OB.rag.indexFile(f, null);
          }
        } catch (e) {
          OB.ui.toast(f.name + ': ' + e.message, 'err');
        }
      }
    }
    renderAttachmentChips();
  }

  async function send() {
    const input = $('#wh-input');
    const text = input.value.trim();
    if ((!text && !pendingAttachments.length) || generating) return;
    let c = convo();
    if (!c) c = newConversation();
    input.value = '';
    autoGrow(input);
    const msg = { role: 'user', content: text || '(attachment)', ts: Date.now() };
    if (pendingAttachments.length) msg.attachments = pendingAttachments;
    pendingAttachments = [];
    renderAttachmentChips();
    c.messages.push(msg);
    if (c.title === 'New chat') c.title = (text || msg.attachments[0].name || 'attachment').slice(0, 42);
    markDirty();
    renderSidebar();
    renderConversation();
    if (!onlineMode && !OB.engine.isLoaded) {
      OB.ui.toast('Load a model first — or enable online mode', 'err');
      return;
    }
    await generate();
  }

  /* ================= composer ================= */

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }

  function setComposerBusy(busy) {
    $('#wh-send').textContent = busy ? '■' : '➤';
    $('#wh-send').classList.toggle('busy', busy);
  }

  function focusComposer() { $('#wh-input').focus(); }

  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $('#wh-mic');
    if (!SR) { btn.style.display = 'none'; return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let finalText = '';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('rec')) { rec.stop(); return; }
      finalText = '';
      try { rec.start(); } catch (_) { /* already */ }
    });
    rec.onstart = () => btn.classList.add('rec');
    rec.onend = () => {
      btn.classList.remove('rec');
      if (finalText.trim()) {
        const input = $('#wh-input');
        input.value = finalText.trim();
        send();
      }
    };
    rec.onresult = (e) => {
      let interim = '';
      finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      $('#wh-input').value = finalText || interim;
    };
    rec.onerror = () => btn.classList.remove('rec');
  }

  /* ================= projects ================= */

  async function newProject() {
    editProject(null);
  }

  async function editProject(p) {
    const isNew = !p;
    const modal = await new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ob-backdrop';
      const el = document.createElement('div');
      el.className = 'ob-modal wh-proj-modal';
      el.innerHTML =
        '<h3>' + (isNew ? 'New project' : 'Project') + '</h3>' +
        '<div class="ob-field"><label class="ob-label">Name</label><input class="ob-input" data-name></div>' +
        '<div class="ob-field"><label class="ob-label">System prompt</label><textarea class="ob-textarea" data-sys rows="3" placeholder="e.g. You are a terse coding assistant."></textarea></div>' +
        '<div class="ob-field"><label class="ob-label">Files (attached to chats in this project)</label>' +
        '<div class="wh-proj-files"></div>' +
        '<button class="ob-btn sm" data-addfile>＋ Add .txt / .pdf</button> <span class="ob-faint" data-fstat style="font-size:12px"></span></div>' +
        '<div class="ob-modal-actions">' +
        (isNew ? '' : '<button class="ob-btn danger" data-delproj style="margin-right:auto">Delete</button>') +
        '<button class="ob-btn ghost" data-cancel>Cancel</button>' +
        '<button class="ob-btn primary" data-save>Save</button></div>';
      backdrop.appendChild(el);
      document.body.appendChild(backdrop);
      resolve({ backdrop, el });
    });
    const el = modal.el;
    if (!isNew) {
      el.querySelector('[data-name]').value = p.name;
      el.querySelector('[data-sys]').value = p.systemPrompt || '';
    }
    let files = isNew ? [] : p.files.slice();
    const fileList = el.querySelector('.wh-proj-files');
    const renderFiles = () => {
      fileList.innerHTML = files.map((f, i) =>
        '<div class="file-row"><span class="f-name">' + esc(f.name) + '</span>' +
        '<span class="f-size">' + OB.ui.fmtBytes(f.text.length) + '</span>' +
        '<button class="f-remove" data-i="' + i + '">✕</button></div>').join('');
      fileList.querySelectorAll('.f-remove').forEach((b) => b.addEventListener('click', () => {
        files.splice(+b.dataset.i, 1);
        renderFiles();
      }));
    };
    renderFiles();
    el.querySelector('[data-addfile]').addEventListener('click', async () => {
      const picked = await OB.ui.pickFiles({ accept: '.txt,.pdf', multiple: true });
      const stat = el.querySelector('[data-fstat]');
      for (const f of picked) {
        try {
          const text = await OB.rag.extractText(f);
          files.push({ name: f.name, text });
        } catch (e) {
          OB.ui.toast(f.name + ': ' + e.message, 'err');
        }
      }
      renderFiles();
    });
    const close = () => modal.backdrop.remove();
    el.querySelector('[data-cancel]').addEventListener('click', close);
    el.querySelector('[data-save]').addEventListener('click', () => {
      const name = el.querySelector('[data-name]').value.trim() || 'Project';
      const sys = el.querySelector('[data-sys]').value.trim();
      if (isNew) {
        projects.push({ id: 'p' + Date.now().toString(36), name, systemPrompt: sys, files });
      } else {
        p.name = name;
        p.systemPrompt = sys;
        p.files = files;
      }
      close();
      markDirty();
      renderSidebar();
    });
    const delBtn = el.querySelector('[data-delproj]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        close();
        projects = projects.filter((x) => x !== p);
        conversations.forEach((c) => { if (c.projectId === p.id) c.projectId = null; });
        markDirty();
        renderSidebar();
      });
    }
  }

  /* ================= settings popovers ================= */

  function updateModelPill() {
    const pill = $('#wh-model-pill');
    if (onlineMode) pill.textContent = 'online · ' + settings.modelId;
    else pill.textContent = OB.engine.loadedName ? OB.engine.loadedName : 'no model';
  }

  function updateVaultPill() {
    const pill = $('#wh-vault-pill');
    pill.textContent = vaultUnlocked ? '🔓 vault' : '🔒 vault';
  }

  function openModelSettings() {
    const pop = document.createElement('div');
    pop.className = 'wh-pop';
    pop.innerHTML =
      '<div class="wh-pop-row"><label>Temperature</label><input class="ob-input" type="number" step="0.1" min="0" max="2" data-temp value="' + settings.temperature + '"></div>' +
      '<div class="wh-pop-row"><label>Online mode</label><input type="checkbox" data-online' + (onlineMode ? ' checked' : '') + '></div>' +
      '<div class="wh-pop-row"><button class="ob-btn sm" data-endpoint>Online settings…</button>' +
      '<button class="ob-btn sm" data-change>Change model</button></div>';
    const pill = $('#wh-model-pill');
    const rect = pill.getBoundingClientRect();
    pop.style.top = rect.bottom + 8 + 'px';
    pop.style.right = (innerWidth - rect.right) + 'px';
    document.body.appendChild(pop);
    setTimeout(() => {
      const closer = (e) => {
        if (!pop.contains(e.target) && e.target !== pill) {
          pop.remove();
          document.removeEventListener('mousedown', closer);
        }
      };
      document.addEventListener('mousedown', closer);
    }, 0);
    pop.querySelector('[data-temp]').addEventListener('change', (e) => {
      settings.temperature = Math.max(0, Math.min(2, +e.target.value || 0.7));
      markDirty();
    });
    pop.querySelector('[data-online]').addEventListener('change', (e) => {
      onlineMode = e.target.checked;
      if (onlineMode && !apiKey) openOnlineSettings();
      updateModelPill();
    });
    pop.querySelector('[data-endpoint]').addEventListener('click', () => { pop.remove(); openOnlineSettings(); });
    pop.querySelector('[data-change]').addEventListener('click', () => { pop.remove(); changeModel(); });
  }

  async function openOnlineSettings() {
    const values = await new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ob-backdrop';
      const el = document.createElement('div');
      el.className = 'ob-modal';
      el.innerHTML =
        '<h3>Online mode</h3>' +
        '<p class="ob-modal-sub">Bring-your-own-endpoint, OpenAI-compatible. The API key lives in memory only — it is wiped on lock and never saved.</p>' +
        '<div class="ob-field"><label class="ob-label">Endpoint</label><input class="ob-input" data-end value="' + esc(settings.endpoint) + '"></div>' +
        '<div class="ob-field"><label class="ob-label">API key (memory only)</label><input class="ob-input ob-mono" type="password" data-key value="' + esc(apiKey) + '"></div>' +
        '<div class="ob-field"><label class="ob-label">Model ID</label><input class="ob-input" data-model value="' + esc(settings.modelId) + '"></div>' +
        '<div class="ob-modal-actions"><button class="ob-btn ghost" data-test>Test</button><span class="ob-spacer"></span>' +
        '<button class="ob-btn ghost" data-cancel>Cancel</button><button class="ob-btn primary" data-ok>Save</button></div>';
      backdrop.appendChild(el);
      document.body.appendChild(backdrop);
      const rd = () => ({
        endpoint: el.querySelector('[data-end]').value.trim(),
        key: el.querySelector('[data-key]').value,
        model: el.querySelector('[data-model]').value.trim(),
      });
      el.querySelector('[data-test]').addEventListener('click', async () => {
        const v = rd();
        try {
          const r = await fetch(v.endpoint.replace(/\/$/, '') + '/models', { headers: { Authorization: 'Bearer ' + v.key } });
          OB.ui.toast(r.ok ? 'Endpoint OK' : 'HTTP ' + r.status, r.ok ? 'ok' : 'err');
        } catch (e) {
          OB.ui.toast('Unreachable: ' + e.message, 'err');
        }
      });
      el.querySelector('[data-cancel]').addEventListener('click', () => { backdrop.remove(); resolve(null); });
      el.querySelector('[data-ok]').addEventListener('click', () => { backdrop.remove(); resolve(rd()); });
      backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
    });
    if (values) {
      settings.endpoint = values.endpoint || settings.endpoint;
      settings.modelId = values.model || settings.modelId;
      apiKey = values.key;
      onlineMode = !!apiKey;
      updateModelPill();
      markDirty();
      OB.ui.toast(onlineMode ? 'Online mode armed' : 'No key — online mode off', 'ok');
    }
  }

  /* ================= wiring ================= */

  $('#wh-new').addEventListener('click', () => newConversation());
  $('#wh-send').addEventListener('click', () => {
    if (generating) {
      abortStream = true;
      OB.engine.abort();
      if (sseController) sseController.abort();
    } else send();
  });
  $('#wh-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#wh-input').addEventListener('input', (e) => autoGrow(e.target));
  $('#wh-attach').addEventListener('click', pickAttachments);
  $('#wh-attach-inline').addEventListener('click', pickAttachments);
  $('#wh-artifact-new').addEventListener('click', () => OB.artifacts.create());
  $('#wh-rag-clear').addEventListener('click', () => {
    OB.rag.clear();
    OB.ui.toast('Document index cleared', 'ok');
  });
  $('#wh-model-pill').addEventListener('click', openModelSettings);
  $('#wh-save').addEventListener('click', () => saveVault());
  $('#wh-import').addEventListener('click', importVault);
  $('#wh-lock').addEventListener('click', lockVault);
  $('#wh-newproj').addEventListener('click', newProject);
  $('#wh-sidebar-toggle').addEventListener('click', () => document.body.classList.toggle('wh-sidebar-closed'));
  $('#wh-banner-unlock').addEventListener('click', unlockDeviceVault);
  $('#wh-banner-ignore').addEventListener('click', () => $('#wh-banner').classList.add('ob-hidden'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      lockVault();
    }
  });

  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.md-copy');
    if (!copyBtn) return;
    const code = copyBtn.closest('.md-codeblock')?.querySelector('code');
    if (code) OB.ui.copy(code.textContent, { toastMsg: 'Code copied' });
  });

  window.addEventListener('beforeunload', (e) => {
    apiKey = '';
    if (dirty && conversations.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => { apiKey = ''; });

  /* boot */
  updateVaultPill();
  updateModelPill();
  renderGate();
  initVoice();
  (async () => {
    try {
      const entries = await OB.epl.list();
      if (entries.some((x) => x.appId === 'whisker/vault')) $('#wh-banner').classList.remove('ob-hidden');
    } catch (_) { /* no IDB */ }
  })();
})();
