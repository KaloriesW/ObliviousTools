'use strict';
/* Wire lyrics — LRCLIB synced lyrics, panel + timeupdate sync. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  const cache = new Map();
  let panel = null;
  let lines = [];        // { t, text }
  let plain = '';
  let activeLine = -1;
  let unbind = null;

  function parseLrc(lrc) {
    const out = [];
    for (const line of String(lrc).split('\n')) {
      const times = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!times.length) continue;
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of times) {
        const t = parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.'));
        out.push({ t, text });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  async function fetchLyrics(track) {
    const key = track.artist + '|' + track.title;
    if (cache.has(key)) return cache.get(key);
    const base = 'https://lrclib.net';
    const q = 'artist_name=' + encodeURIComponent(track.artist) + '&track_name=' + encodeURIComponent(track.title);
    let data = null;
    try {
      const r = await fetch(base + '/api/get?' + q);
      if (r.ok) data = await r.json();
    } catch (_) { /* offline */ }
    if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
      try {
        const r2 = await fetch(base + '/api/search?' + q);
        if (r2.ok) {
          const arr = await r2.json();
          data = Array.isArray(arr) ? arr[0] : null;
        }
      } catch (_) { /* offline */ }
    }
    const result = data ? { synced: data.syncedLyrics || '', plain: data.plainLyrics || '' } : null;
    cache.set(key, result);
    return result;
  }

  function close() {
    if (unbind) { unbind(); unbind = null; }
    if (panel) { panel.remove(); panel = null; }
    lines = [];
    plain = '';
    activeLine = -1;
  }

  function lineEl(i) {
    return panel ? panel.querySelector('[data-l="' + i + '"]') : null;
  }

  async function open(track, audioEl) {
    close();
    OB.ui.toast('Finding lyrics…', 'info', 1400);
    const data = await fetchLyrics(track);
    if (!data || (!data.synced && !data.plain)) {
      OB.ui.toast('No lyrics found', 'err');
      return;
    }
    lines = data.synced ? parseLrc(data.synced) : [];
    plain = data.plain || '';
    activeLine = -1;

    panel = document.createElement('aside');
    panel.className = 'wr-lyrics-panel';
    const head = document.createElement('div');
    head.className = 'wr-lyrics-head';
    head.innerHTML = '<span></span><button class="ob-btn ghost sm" data-x>✕</button>';
    head.querySelector('span').textContent = track.title + ' — ' + track.artist;
    head.querySelector('[data-x]').addEventListener('click', close);
    const body = document.createElement('div');
    body.className = 'wr-lyrics-body';
    if (lines.length) {
      lines.forEach((l, i) => {
        const d = document.createElement('div');
        d.className = 'wr-lyrics-line';
        d.dataset.l = i;
        d.textContent = l.text || '♪';
        body.appendChild(d);
      });
    } else {
      body.classList.add('plain');
      body.textContent = plain;
    }
    panel.append(head, body);
    document.body.appendChild(panel);

    const onTime = () => {
      if (!lines.length || !panel) return;
      const t = audioEl.currentTime;
      let idx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= t) idx = i;
        else break;
      }
      if (idx !== activeLine) {
        activeLine = idx;
        panel.querySelectorAll('.wr-lyrics-line').forEach((el) => el.classList.remove('on'));
        const el = lineEl(idx);
        if (el) {
          el.classList.add('on');
          const bodyRect = body.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          body.scrollTo({ top: body.scrollTop + (elRect.top - bodyRect.top) - bodyRect.height / 2 + elRect.height / 2, behavior: 'smooth' });
        }
      }
    };
    audioEl.addEventListener('timeupdate', onTime);
    unbind = () => audioEl.removeEventListener('timeupdate', onTime);
    onTime();
  }

  OB.lyrics = { open, close };
})();
