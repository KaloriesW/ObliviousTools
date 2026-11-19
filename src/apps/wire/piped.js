'use strict';
/* Wire online streaming — audio-only via Piped API, with instance failover. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  const DEFAULT_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
  ];

  let instance = DEFAULT_INSTANCES[0];
  function setInstance(url) {
    instance = url.replace(/\/$/, '');
  }
  function getInstance() { return instance; }

  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  /* Try primary instance, then failovers (search only — streams stick to resolved host). */
  async function withFailover(fn) {
    const list = [instance, ...DEFAULT_INSTANCES.filter((i) => i !== instance)];
    let lastErr;
    for (const inst of list) {
      try {
        return { data: await fn(inst), used: inst };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('all instances failed');
  }

  async function search(q) {
    const { data, used } = await withFailover((inst) =>
      fetchJson(inst + '/search?q=' + encodeURIComponent(q) + '&filter=music_songs', 8000)
    );
    instance = used;
    const items = (data && data.items) || [];
    return items
      .filter((it) => it && it.url && it.title)
      .map((it) => ({
        id: 'p:' + (it.url.replace('/watch?v=', '') || it.url),
        source: 'piped',
        videoId: it.url.replace('/watch?v=', ''),
        title: String(it.title),
        artist: String(it.uploaderName || it.uploader || 'Unknown'),
        album: '',
        durationSec: it.duration > 0 ? it.duration : null,
        thumb: it.thumbnail || '',
      }));
  }

  async function getStreamUrl(videoId) {
    const data = await fetchJson(instance + '/streams/' + encodeURIComponent(videoId), 10000);
    const streams = (data && data.audioStreams) || [];
    if (!streams.length) throw new Error('no audio streams');
    const score = (s) => {
      const br = parseInt(s.bitrate, 10) || 0;
      const opus = (s.mimeType || '').includes('webm') ? 1.15 : 1;
      return br * opus;
    };
    streams.sort((a, b) => score(b) - score(a));
    return streams[0].url;
  }

  async function testInstance(url) {
    const data = await fetchJson(url.replace(/\/$/, '') + '/search?q=test&filter=music_songs', 6000);
    return !!(data && data.items);
  }

  OB.piped = { search, getStreamUrl, testInstance, setInstance, getInstance, DEFAULT_INSTANCES };
})();
