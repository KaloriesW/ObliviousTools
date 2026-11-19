'use strict';
/* Wire — Spotify-style UI, audio-only, encrypted vault, MediaSession. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = OB.ui.esc;

  /* ================= state ================= */

  let tracks = {};       // id → track
  let playlists = [];    // {id,name,trackIds,created}
  let likedIds = [];
  let playCounts = {};
  let settings = { online: false, instance: OB.piped.getInstance() };

  let vaultPw = null;
  let vaultUnlocked = false;
  let dirty = false;
  let view = 'home';
  let viewArg = null;

  const fileMap = new Map(); // id → {file, objectURL}
  const artCache = new Map();

  function markDirty() {
    dirty = true;
    scheduleAutosave();
  }

  /* ================= art ================= */

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function trackArt(track) {
    if (track.source === 'piped') return track.thumb || '';
    if (track.artwork) return track.artwork;
    if (artCache.has(track.id)) return artCache.get(track.id);
    const key = track.title + '|' + track.artist;
    const h = hashStr(key);
    const hue1 = h % 360;
    const hue2 = (h >> 8) % 360;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 512, 512);
    g.addColorStop(0, 'hsl(' + hue1 + ', 55%, 42%)');
    g.addColorStop(1, 'hsl(' + hue2 + ', 60%, 22%)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '700 250px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((track.title || '?')[0].toUpperCase(), 256, 280);
    const url = canvas.toDataURL('image/png');
    artCache.set(track.id, url);
    track.artwork = url;
    return url;
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec == null) return '–:––';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  /* ================= source resolution ================= */

  async function resolveSource(track) {
    if (track.source === 'local') {
      const entry = fileMap.get(track.id);
      if (entry) return entry.objectURL;
      throw new Error('File not loaded this session — re-add your music folder');
    }
    if (!settings.online) throw new Error('Online streaming is off (settings)');
    return OB.piped.getStreamUrl(track.videoId);
  }

  function initPlayer() {
    OB.player.init({
      resolveSource,
      onTrackChange: () => { renderPlayerBar(); renderMain(); },
      onState: () => renderPlayerBar(),
      onTime: () => updateSeek(),
      onLoading: () => { $('#wr-play').textContent = '…'; },
      onError: (t, e) => {
        OB.ui.toast((t ? t.title : 'Track') + ': ' + e.message, 'err');
        if (OB.player.queue.length > 1) setTimeout(() => OB.player.next(true), 400);
      },
      onPlayCount: (t) => { playCounts[t.id] = (playCounts[t.id] || 0) + 1; markDirty(); },
      onModeChange: () => renderPlayerBar(),
      onEndedQueue: () => renderPlayerBar(),
    });
  }

  /* ================= import local music ================= */

  async function addMusic(directory) {
    const files = await OB.ui.pickFiles({ accept: 'audio/*', multiple: true, directory });
    if (!files.length) return;
    let added = 0, relinked = 0;
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '');
      let artist = '', title = base;
      const m = base.match(/^(.+?)\s*-\s*(.+)$/);
      if (m) { artist = m[1].trim(); title = m[2].trim(); }
      const key = file.name + '|' + file.size;
      const existing = Object.values(tracks).find((t) => t.source === 'local' && t.linkKey === key);
      if (existing) {
        if (!fileMap.has(existing.id)) {
          fileMap.set(existing.id, { file, objectURL: URL.createObjectURL(file) });
          relinked++;
        }
        continue;
      }
      const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      tracks[id] = {
        id, source: 'local', title, artist, album: '',
        durationSec: null, size: file.size, linkKey: key, addedAt: Date.now(),
      };
      fileMap.set(id, { file, objectURL: URL.createObjectURL(file) });
      added++;
    }
    markDirty();
    OB.ui.toast('Added ' + added + (relinked ? ' · re-linked ' + relinked : ''), 'ok');
    renderSidebar();
    renderMain();
  }

  /* ================= playlists ================= */

  const LIKED = 'liked';

  function playlistById(id) {
    if (id === LIKED) {
      return { id: LIKED, name: 'Liked Songs', trackIds: likedIds.slice(), created: 0 };
    }
    return playlists.find((p) => p.id === id);
  }

  async function newPlaylist() {
    const name = await OB.ui.textPrompt({ title: 'New playlist', label: 'Name', placeholder: 'Road trip' });
    if (!name) return;
    playlists.push({ id: 'pl' + Date.now().toString(36), name, trackIds: [], created: Date.now() });
    markDirty();
    renderSidebar();
    view = 'playlist';
    viewArg = playlists[playlists.length - 1].id;
    renderMain();
  }

  async function deletePlaylist(id) {
    const p = playlistById(id);
    if (!p || id === LIKED) return;
    const yes = await OB.ui.confirmDialog({
      title: 'Delete "' + p.name + '"?',
      body: 'The playlist goes — tracks stay in your library.',
      okLabel: 'Delete', danger: true,
    });
    if (!yes) return;
    playlists = playlists.filter((x) => x.id !== id);
    markDirty();
    if (view === 'playlist' && viewArg === id) { view = 'home'; viewArg = null; }
    renderSidebar();
    renderMain();
  }

  function toggleLike(id) {
    const i = likedIds.indexOf(id);
    if (i >= 0) likedIds.splice(i, 1);
    else likedIds.push(id);
    markDirty();
    renderMain();
    renderPlayerBar();
  }

  function addToPlaylistMenu(track, anchorEl) {
    const menu = document.createElement('div');
    menu.className = 'wr-menu';
    for (const p of playlists) {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.addEventListener('click', () => {
        if (!p.trackIds.includes(track.id)) { p.trackIds.push(track.id); markDirty(); OB.ui.toast('Added to ' + p.name, 'ok'); }
        menu.remove();
      });
      menu.appendChild(b);
    }
    const nb = document.createElement('button');
    nb.textContent = '＋ New playlist…';
    nb.addEventListener('click', async () => {
      menu.remove();
      const name = await OB.ui.textPrompt({ title: 'New playlist', label: 'Name' });
      if (!name || !tracks[track.id]) return;
      playlists.push({ id: 'pl' + Date.now().toString(36), name, trackIds: [track.id], created: Date.now() });
      markDirty();
      renderSidebar();
      OB.ui.toast('Added to ' + name, 'ok');
    });
    menu.appendChild(nb);
    document.body.appendChild(menu);
    const r = anchorEl.getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px';
    menu.style.right = (innerWidth - r.right) + 'px';
    setTimeout(() => {
      const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', closer); } };
      document.addEventListener('mousedown', closer);
    }, 0);
  }

  /* ================= vault ================= */

  function vaultObj() {
    const slim = {};
    for (const [id, t] of Object.entries(tracks)) {
      const copy = Object.assign({}, t);
      delete copy.artwork; // regenerate locally; keeps vault small
      slim[id] = copy;
    }
    return { tracks: slim, playlists, likedIds, playCounts, settings: { online: settings.online, instance: settings.instance } };
  }

  let saveTimer = null;
  function scheduleAutosave() {
    if (!vaultUnlocked || !vaultPw) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!dirty) return;
      try {
        const bytes = await OB.crypto.encrypt(vaultPw, JSON.stringify(vaultObj()), { app: 'wire', kind: 'vault' });
        await OB.epl.save('wire/vault', bytes, 'Wire library');
        dirty = false;
      } catch (_) { /* silent */ }
    }, 4000);
  }

  async function saveVault() {
    let pw = vaultPw;
    if (!pw) {
      pw = await OB.ui.passwordDialog({ title: 'Encrypt your library', confirm: true, okLabel: 'Encrypt' });
      if (!pw) return;
      vaultPw = pw;
    }
    const bytes = await OB.crypto.encrypt(pw, JSON.stringify(vaultObj()), { app: 'wire', kind: 'vault' });
    const dl = await OB.ui.confirmDialog({ title: 'Save where?', body: (bytes.length / 1024).toFixed(1) + ' KB encrypted. Download .obv or keep on this device?', okLabel: 'Download file' });
    if (dl) OB.ui.download('wire.obv', bytes);
    else {
      try {
        await OB.epl.save('wire/vault', bytes, 'Wire library');
        OB.ui.toast('Saved on this device (encrypted)', 'ok');
      } catch (e) {
        OB.ui.toast('Device storage unavailable: ' + e.message, 'err');
      }
    }
    vaultUnlocked = true;
    dirty = false;
  }

  async function importVault() {
    const files = await OB.ui.pickFiles({ accept: '.obv' });
    if (!files[0]) return;
    const pw = await OB.ui.passwordDialog({ title: 'Unlock ' + files[0].name });
    if (!pw) return;
    try {
      const { payload, meta } = await OB.crypto.decrypt(pw, new Uint8Array(await files[0].arrayBuffer()));
      if (meta.app !== 'wire') { OB.ui.toast('Not a Wire vault', 'err'); return; }
      const data = JSON.parse(new TextDecoder().decode(payload));
      tracks = data.tracks || {};
      playlists = data.playlists || [];
      likedIds = data.likedIds || [];
      playCounts = data.playCounts || {};
      settings = Object.assign(settings, data.settings || {});
      OB.piped.setInstance(settings.instance);
      vaultPw = pw;
      vaultUnlocked = true;
      markDirty();
      renderSidebar();
      renderMain();
      OB.ui.toast('Library loaded', 'ok');
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Load failed', 'err');
    }
  }

  async function unlockDeviceVault() {
    const pw = await OB.ui.passwordDialog({ title: 'Unlock your library' });
    if (!pw) return;
    try {
      const bytes = await OB.epl.load('wire/vault');
      const { payload, meta } = await OB.crypto.decrypt(pw, bytes);
      if (meta.app !== 'wire') throw new Error('NOT_WIRE');
      const data = JSON.parse(new TextDecoder().decode(payload));
      tracks = data.tracks || {};
      playlists = data.playlists || [];
      likedIds = data.likedIds || [];
      playCounts = data.playCounts || {};
      settings = Object.assign(settings, data.settings || {});
      OB.piped.setInstance(settings.instance);
      vaultPw = pw;
      vaultUnlocked = true;
      dirty = false;
      $('#wr-banner').classList.add('ob-hidden');
      renderSidebar();
      renderMain();
      OB.ui.toast('Unlocked — autosave on', 'ok');
    } catch (e) {
      OB.ui.toast(e.message === 'BAD_PASSWORD' ? 'Wrong password' : 'Unlock failed', 'err');
    }
  }

  function lockVault() {
    OB.player.stop();
    for (const [, v] of fileMap) { try { URL.revokeObjectURL(v.objectURL); } catch (_) {} }
    fileMap.clear();
    tracks = {}; playlists = []; likedIds = []; playCounts = {};
    vaultPw = null;
    vaultUnlocked = false;
    dirty = false;
    view = 'home';
    renderSidebar();
    renderMain();
    renderPlayerBar();
    OB.ui.toast('Locked — memory wiped', 'ok');
  }

  /* ================= rendering ================= */

  function renderSidebar() {
    const pl = $('#wr-playlists');
    pl.innerHTML = '';
    const liked = document.createElement('div');
    liked.className = 'wr-nav-item' + (view === 'playlist' && viewArg === LIKED ? ' on' : '');
    liked.innerHTML = '<span class="wr-nav-ico">♥</span> Liked Songs <span class="wr-nav-count">' + likedIds.length + '</span>';
    liked.addEventListener('click', () => { view = 'playlist'; viewArg = LIKED; renderMain(); renderSidebar(); });
    pl.appendChild(liked);
    for (const p of playlists) {
      const row = document.createElement('div');
      row.className = 'wr-nav-item' + (view === 'playlist' && viewArg === p.id ? ' on' : '');
      row.innerHTML = '<span class="wr-nav-ico">♫</span> <span class="wr-nav-name">' + esc(p.name) + '</span> <span class="wr-nav-count">' + p.trackIds.length + '</span>';
      row.addEventListener('click', () => { view = 'playlist'; viewArg = p.id; renderMain(); renderSidebar(); });
      pl.appendChild(row);
    }
  }

  function card(trackOrPlaylist, isPlaylist) {
    const cardEl = document.createElement('div');
    cardEl.className = 'wr-card';
    const art = isPlaylist ? null : trackArt(trackOrPlaylist);
    cardEl.innerHTML =
      '<div class="wr-card-art">' + (isPlaylist ? '<span>♫</span>' : '<img alt="" src="' + (art || '') + '">') +
      '<button class="wr-card-play" title="Play">▶</button></div>' +
      '<div class="wr-card-title">' + esc(isPlaylist ? trackOrPlaylist.name : trackOrPlaylist.title) + '</div>' +
      '<div class="wr-card-sub">' + esc(isPlaylist ? trackOrPlaylist.trackIds.length + ' tracks' : trackOrPlaylist.artist || '—') + '</div>';
    cardEl.querySelector('.wr-card-play').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPlaylist) playPlaylist(trackOrPlaylist);
      else playTracks([trackOrPlaylist]);
    });
    cardEl.addEventListener('click', () => {
      if (isPlaylist) { view = 'playlist'; viewArg = trackOrPlaylist.id; renderMain(); renderSidebar(); }
    });
    return cardEl;
  }

  function playPlaylist(p) {
    const list = p.trackIds.map((id) => tracks[id]).filter(Boolean);
    if (!list.length) { OB.ui.toast('Playlist is empty', 'err'); return; }
    playTracks(list);
  }

  function playTracks(list) {
    OB.player.setQueue(list, 0);
  }

  function trackTable(list, opts) {
    opts = opts || {};
    const table = document.createElement('div');
    table.className = 'wr-tracks';
    table.innerHTML =
      '<div class="wr-tracks-head"><span>#</span><span>Title</span><span class="wr-col-album">Album</span><span>⏱</span></div>';
    list.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'wr-track-row' + (OB.player.current && OB.player.current.id === t.id ? ' playing' : '');
      const art = trackArt(t);
      row.innerHTML =
        '<span class="wr-track-num"><span class="wr-num">' + (i + 1) + '</span><span class="wr-eq"><i></i><i></i><i></i></span><span class="wr-playglyph">▶</span></span>' +
        '<span class="wr-track-title"><img class="wr-track-art" alt="" src="' + (t.source === 'piped' && t.thumb ? t.thumb : art) + '">' +
        '<span class="wr-track-name"><span class="wr-t">' + esc(t.title) + '</span>' +
        '<span class="wr-a">' + esc(t.artist || 'Unknown') + (t.source === 'local' ? ' <span class="wr-offline" title="local file">●</span>' : '') + '</span></span></span>' +
        '<span class="wr-col-album wr-track-album">' + esc(t.album || '—') + '</span>' +
        '<span class="wr-track-dur">' + (t.durationSec ? fmtTime(t.durationSec) : '–:––') + '</span>';
      const actions = document.createElement('span');
      actions.className = 'wr-track-actions';
      const like = document.createElement('button');
      like.className = 'wr-act' + (likedIds.includes(t.id) ? ' on' : '');
      like.textContent = '♥';
      like.title = 'Like';
      like.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(t.id); });
      const add = document.createElement('button');
      add.className = 'wr-act';
      add.textContent = '＋';
      add.title = 'Add to playlist';
      add.addEventListener('click', (e) => { e.stopPropagation(); addToPlaylistMenu(t, add); });
      const rem = document.createElement('button');
      rem.className = 'wr-act';
      rem.textContent = '✕';
      rem.title = 'Remove from playlist';
      rem.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (opts.onRemove) opts.onRemove(t, i);
      });
      actions.append(like, add);
      if (opts.onRemove) actions.append(rem);
      row.appendChild(actions);
      row.addEventListener('click', () => playTracks(list.slice(i)));
      table.appendChild(row);
    });
    return table;
  }

  function renderMain() {
    const main = $('#wr-main');
    main.innerHTML = '';
    const allLocal = Object.values(tracks);
    if (view === 'home') {
      const recent = allLocal.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 6);
      const top = Object.entries(playCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => tracks[id]).filter(Boolean);
      const section = (title, items, isPlaylist, more) => {
        if (!items.length) return null;
        const sec = document.createElement('section');
        sec.innerHTML = '<h2>' + title + '</h2>';
        const grid = document.createElement('div');
        grid.className = 'wr-grid';
        for (const it of items) grid.appendChild(card(it, isPlaylist));
        sec.appendChild(grid);
        return sec;
      };
      const s1 = section('Recently added', recent);
      const s2 = section('Made for you', top);
      const s3 = section('Your playlists', playlists, true);
      if (s1) main.appendChild(s1);
      if (s2) main.appendChild(s2);
      if (s3) main.appendChild(s3);
      if (!allLocal.length && !playlists.length) {
        main.innerHTML = '<div class="wr-welcome"><h1>Wire</h1><p class="ob-dim">Audio lives on your device. Add your music, or turn on online streaming in settings.</p>' +
          '<button class="ob-btn primary" id="wr-add-big">＋ Add music</button></div>';
        $('#wr-add-big').addEventListener('click', () => addMusic(false));
        return;
      }
    } else if (view === 'search') {
      // rendered by search handler
    } else if (view === 'playlist') {
      const p = playlistById(viewArg);
      if (!p) { view = 'home'; renderMain(); return; }
      const head = document.createElement('div');
      head.className = 'wr-pl-head';
      const grad = p.trackIds[0] && tracks[p.trackIds[0]] ? trackArt(tracks[p.trackIds[0]]) : '';
      head.innerHTML =
        '<div class="wr-pl-art">' + (grad ? '<img alt="" src="' + grad + '">' : '<span>♫</span>') + '</div>' +
        '<div class="wr-pl-meta"><div class="wr-pl-kind">' + (p.id === LIKED ? 'Playlist' : 'Playlist') + '</div>' +
        '<h1>' + esc(p.name) + '</h1>' +
        '<div class="ob-dim">' + p.trackIds.length + ' tracks</div>' +
        '<div class="wr-pl-actions"><button class="wr-bigplay" id="wr-pl-play">▶</button>' +
        (p.id !== LIKED ? '<button class="ob-btn ghost sm" id="wr-pl-del">🗑</button>' : '') + '</div></div>';
      main.appendChild(head);
      head.querySelector('#wr-pl-play').addEventListener('click', () => playPlaylist(p));
      const delBtn = head.querySelector('#wr-pl-del');
      if (delBtn) delBtn.addEventListener('click', () => deletePlaylist(p.id));
      const list = p.trackIds.map((id) => tracks[id]).filter(Boolean);
      main.appendChild(trackTable(list, {
        onRemove: (t) => {
          if (p.id === LIKED) toggleLike(t.id);
          else {
            p.trackIds = p.trackIds.filter((id) => id !== t.id);
            markDirty();
            renderMain();
          }
        },
      }));
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'ob-faint';
        empty.textContent = 'Nothing here yet. Use ＋ on a track to add it.';
        main.appendChild(empty);
      }
    }
    renderPlayerBar();
  }

  /* ================= search ================= */

  let searchTimer = null;
  async function onSearch() {
    const q = $('#wr-search-input').value.trim();
    const resultsEl = $('#wr-search-results');
    resultsEl.innerHTML = '';
    if (!q) return;
    const ql = q.toLowerCase();
    const local = Object.values(tracks).filter((t) =>
      t.title.toLowerCase().includes(ql) || (t.artist || '').toLowerCase().includes(ql) || (t.album || '').toLowerCase().includes(ql));
    if (local.length) {
      const h = document.createElement('h2');
      h.textContent = 'Your library';
      resultsEl.appendChild(h);
      resultsEl.appendChild(trackTable(local.slice(0, 50)));
    }
    if (settings.online && navigator.onLine) {
      const oh = document.createElement('h2');
      oh.textContent = 'Online results';
      resultsEl.appendChild(oh);
      const loading = document.createElement('p');
      loading.className = 'ob-faint';
      loading.textContent = 'Searching…';
      resultsEl.appendChild(loading);
      try {
        const remote = await OB.piped.search(q);
        loading.remove();
        if (remote.length) {
          const enriched = remote.map((t) => {
            if (!tracks[t.id]) tracks[t.id] = t;
            return tracks[t.id];
          });
          markDirty();
          resultsEl.appendChild(trackTable(enriched.slice(0, 30)));
        } else {
          loading.textContent = 'Nothing found';
        }
      } catch (e) {
        loading.textContent = 'Instance unavailable — try another in settings';
      }
    }
  }

  /* ================= player bar / seek / queue ================= */

  function renderPlayerBar() {
    const t = OB.player.current;
    $('#wr-bar-art').innerHTML = t
      ? '<img alt="" src="' + (t.source === 'piped' && t.thumb ? t.thumb : trackArt(t)) + '">'
      : '';
    $('#wr-bar-title').textContent = t ? t.title : 'Nothing playing';
    $('#wr-bar-artist').textContent = t ? t.artist : '';
    $('#wr-play').textContent = OB.player.playing ? '⏸' : '▶';
    $('#wr-shuffle').classList.toggle('on', OB.player.shuffle);
    $('#wr-repeat').classList.toggle('on', OB.player.repeat !== 'off');
    $('#wr-repeat').textContent = OB.player.repeat === 'one' ? '🔁¹' : '🔁';
    updateSeek();
    renderQueue();
  }

  function updateSeek() {
    const a = OB.player.audio;
    $('#wr-seek').max = isFinite(a.duration) ? a.duration : 100;
    $('#wr-seek').value = a.currentTime || 0;
    $('#wr-time-cur').textContent = fmtTime(a.currentTime);
    $('#wr-time-total').textContent = fmtTime(a.duration);
  }

  function renderQueue() {
    const host = $('#wr-queue-list');
    if (!host) return;
    host.innerHTML = '';
    OB.player.queue.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'wr-q-row' + (OB.player.position === i ? ' on' : '');
      row.innerHTML = '<span class="wr-q-title">' + esc(t.title) + '</span><span class="wr-q-artist">' + esc(t.artist || '') + '</span><button class="wr-q-x">✕</button>';
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        OB.player.jumpTo(i);
      });
      row.querySelector('.wr-q-x').addEventListener('click', () => OB.player.removeFromQueue(i));
      host.appendChild(row);
    });
  }

  /* ================= settings ================= */

  async function openSettings() {
    const values = await new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ob-backdrop';
      const el = document.createElement('div');
      el.className = 'ob-modal';
      el.innerHTML =
        '<h3>Wire settings</h3>' +
        '<div class="ob-field"><label class="ob-label" style="display:flex;gap:8px;align-items:center">' +
        '<input type="checkbox" data-online style="width:auto"' + (settings.online ? ' checked' : '') + '> Online streaming (audio-only via Piped)</label></div>' +
        '<div class="ob-field"><label class="ob-label">Piped instance</label><input class="ob-input" data-inst value="' + esc(settings.instance) + '"></div>' +
        '<p class="ob-modal-sub">Streaming is audio-only — no video is ever loaded. The instance you choose can see search and stream requests.</p>' +
        '<div class="ob-modal-actions"><button class="ob-btn ghost" data-test>Test</button><span class="ob-spacer"></span>' +
        '<button class="ob-btn ghost" data-cancel>Cancel</button><button class="ob-btn primary" data-ok>Save</button></div>';
      backdrop.appendChild(el);
      document.body.appendChild(backdrop);
      const rd = () => ({
        online: el.querySelector('[data-online]').checked,
        instance: el.querySelector('[data-inst]').value.trim() || settings.instance,
      });
      el.querySelector('[data-test]').addEventListener('click', async () => {
        OB.ui.toast('Testing…', 'info', 1500);
        try {
          const ok = await OB.piped.testInstance(el.querySelector('[data-inst]').value.trim());
          OB.ui.toast(ok ? 'Instance OK' : 'Instance failed', ok ? 'ok' : 'err');
        } catch (e) {
          OB.ui.toast('Unreachable', 'err');
        }
      });
      el.querySelector('[data-cancel]').addEventListener('click', () => { backdrop.remove(); resolve(null); });
      el.querySelector('[data-ok]').addEventListener('click', () => { backdrop.remove(); resolve(rd()); });
      backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
    });
    if (values) {
      settings.online = values.online;
      settings.instance = values.instance;
      OB.piped.setInstance(settings.instance);
      markDirty();
      OB.ui.toast('Settings saved', 'ok');
    }
  }

  /* ================= wiring ================= */

  $$('.wr-nav-item[data-view]').forEach((el) => el.addEventListener('click', () => {
    view = el.dataset.view;
    viewArg = null;
    $$('.wr-nav-item').forEach((x) => x.classList.toggle('on', x === el));
    $('#wr-search-view').classList.toggle('ob-hidden', view !== 'search');
    if (view !== 'search') { renderMain(); $('#wr-main').classList.remove('ob-hidden'); }
    else { $('#wr-main').classList.add('ob-hidden'); $('#wr-search-input').focus(); }
  }));

  $('#wr-search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(onSearch, 400);
  });
  $('#wr-add-music').addEventListener('click', () => addMusic(false));
  $('#wr-add-folder').addEventListener('click', () => addMusic(true));
  $('#wr-new-pl').addEventListener('click', newPlaylist);
  $('#wr-settings').addEventListener('click', openSettings);
  $('#wr-save').addEventListener('click', saveVault);
  $('#wr-import').addEventListener('click', importVault);
  $('#wr-lock').addEventListener('click', lockVault);
  $('#wr-banner-unlock').addEventListener('click', unlockDeviceVault);
  $('#wr-banner-ignore').addEventListener('click', () => $('#wr-banner').classList.add('ob-hidden'));
  $('#wr-sidebar-toggle').addEventListener('click', () => document.body.classList.toggle('wr-sidebar-closed'));

  $('#wr-play').addEventListener('click', () => OB.player.toggle());
  $('#wr-next').addEventListener('click', () => OB.player.next(false));
  $('#wr-prev').addEventListener('click', () => OB.player.prev());
  $('#wr-shuffle').addEventListener('click', () => OB.player.toggleShuffle());
  $('#wr-repeat').addEventListener('click', () => OB.player.cycleRepeat());
  $('#wr-seek').addEventListener('input', (e) => OB.player.seek(+e.target.value));
  $('#wr-vol').addEventListener('input', (e) => OB.player.setVolume(+e.target.value));
  $('#wr-queue-btn').addEventListener('click', () => $('#wr-queue').classList.toggle('open'));
  $('#wr-queue-close').addEventListener('click', () => $('#wr-queue').classList.remove('open'));
  $('#wr-lyrics-btn').addEventListener('click', async () => {
    const t = OB.player.current;
    if (!t) { OB.ui.toast('Nothing playing', 'err'); return; }
    if (!navigator.onLine) { OB.ui.toast('Lyrics need internet', 'err'); return; }
    OB.lyrics.open(t, OB.player.audio);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); OB.player.toggle(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty && Object.keys(tracks).length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* boot */
  initPlayer();
  OB.player.setVolume(0.9);
  $('#wr-vol').value = 0.9;
  renderSidebar();
  renderMain();
  renderPlayerBar();
  (async () => {
    try {
      const entries = await OB.epl.list();
      if (entries.some((x) => x.appId === 'wire/vault')) $('#wr-banner').classList.remove('ob-hidden');
    } catch (_) { /* no IDB */ }
  })();
})();
