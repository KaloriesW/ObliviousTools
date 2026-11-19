'use strict';
/* Wire player engine — one audio element, queue/shuffle/repeat, MediaSession. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  const audio = new Audio();
  audio.preload = 'auto';

  let queue = [];
  let order = [];
  let pos = -1;
  let shuffle = false;
  let repeat = 'off'; // off | all | one
  let hooks = {};

  function buildOrder() {
    order = queue.map((_, i) => i);
    if (shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (pos >= 0) {
        const cur = order.indexOf(pos);
        if (cur > 0) {
          [order[0], order[cur]] = [order[cur], order[0]];
        }
      }
    }
  }

  function current() {
    return pos >= 0 && pos < queue.length ? queue[pos] : null;
  }

  function positionInOrder() {
    return order.indexOf(pos);
  }

  async function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    pos = i;
    const track = queue[pos];
    hooks.onLoading && hooks.onLoading(track);
    try {
      const src = await hooks.resolveSource(track);
      if (pos !== i) return; // changed meanwhile
      audio.src = src;
      await audio.play();
      hooks.onPlayCount && hooks.onPlayCount(track);
      updateMediaSession(track);
      hooks.onTrackChange && hooks.onTrackChange(track);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      hooks.onError && hooks.onError(track, e);
    }
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Wire',
        artwork: track.artwork ? [{ src: track.artwork, sizes: '512x512', type: 'image/png' }] : [],
      });
    } catch (_) { /* best effort */ }
  }

  let lastPosState = 0;
  audio.addEventListener('timeupdate', () => {
    hooks.onTime && hooks.onTime();
    const now = Date.now();
    if (now - lastPosState > 2000) {
      lastPosState = now;
      pushPositionState();
    }
  });
  audio.addEventListener('play', () => { hooks.onState && hooks.onState(true); pushPositionState(); });
  audio.addEventListener('pause', () => { hooks.onState && hooks.onState(false); });
  audio.addEventListener('ended', () => {
    if (repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    next(true);
  });
  audio.addEventListener('error', () => {
    if (audio.src) hooks.onError && hooks.onError(current(), new Error('audio error'));
  });

  function pushPositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try {
      if (isFinite(audio.duration) && audio.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        });
      }
    } catch (_) { /* best effort */ }
  }

  function next(auto) {
    const oi = positionInOrder();
    if (oi < 0) return;
    if (oi + 1 < order.length) playIndex(order[oi + 1]);
    else if (repeat === 'all' || !auto) playIndex(order[0]);
    else hooks.onEndedQueue && hooks.onEndedQueue();
  }
  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const oi = positionInOrder();
    if (oi > 0) playIndex(order[oi - 1]);
    else if (pos > 0) playIndex(pos - 1);
    else audio.currentTime = 0;
  }

  /* MediaSession handlers — the OS/hardware controls (Monochrome-style) */
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try { ms.setActionHandler(action, fn); } catch (_) { /* unsupported action */ }
    };
    set('play', () => audio.play().catch(() => {}));
    set('pause', () => audio.pause());
    set('previoustrack', prev);
    set('nexttrack', () => next(false));
    set('stop', () => { audio.pause(); audio.currentTime = 0; });
    set('seekto', (d) => {
      if (d && typeof d.seekTime === 'number' && isFinite(audio.duration)) {
        audio.currentTime = Math.max(0, Math.min(audio.duration, d.seekTime));
        pushPositionState();
      }
    });
    set('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d && d.seekOffset || 10)); });
    set('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + (d && d.seekOffset || 10)); });
  }

  const player = {
    audio,
    init(h) { hooks = h || hooks; },
    get queue() { return queue; },
    get current() { return current(); },
    get playing() { return !audio.paused && !!audio.src; },
    get shuffle() { return shuffle; },
    get repeat() { return repeat; },
    get position() { return pos; },
    setQueue(tracks, startIndex) {
      queue = tracks.slice();
      pos = startIndex === undefined ? 0 : startIndex;
      buildOrder();
      return playIndex(pos);
    },
    playTrack(track) {
      const i = queue.findIndex((t) => t.id === track.id);
      if (i >= 0) return playIndex(i);
      queue.push(track);
      buildOrder();
      return playIndex(queue.length - 1);
    },
    enqueue(track) {
      queue.push(track);
      order.push(queue.length - 1);
      if (pos < 0) return playIndex(0);
      hooks.onQueueChange && hooks.onQueueChange();
    },
    removeFromQueue(idx) {
      if (idx === pos) return;
      if (idx < pos) pos--;
      queue.splice(idx, 1);
      buildOrder();
      hooks.onQueueChange && hooks.onQueueChange();
    },
    jumpTo(idx) { return playIndex(idx); },
    next, prev,
    toggle() {
      if (!audio.src) return;
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    },
    seek(t) { if (isFinite(t)) audio.currentTime = t; },
    setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); },
    toggleShuffle() {
      shuffle = !shuffle;
      buildOrder();
      hooks.onModeChange && hooks.onModeChange();
    },
    cycleRepeat() {
      repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
      hooks.onModeChange && hooks.onModeChange();
    },
    stop() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      queue = [];
      order = [];
      pos = -1;
    },
  };

  OB.player = player;
})();
