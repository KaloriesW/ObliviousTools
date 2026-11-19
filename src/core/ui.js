'use strict';
/*
 * Oblivious shared UI helpers — modals, toasts, file pickers, clipboard,
 * downloads. Styles live in src/styles/theme.css (.ob-* classes).
 */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const ui = {};

  /* ---------------- toasts ---------------- */

  function toastHost() {
    let host = document.querySelector('.ob-toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'ob-toasts';
      document.body.appendChild(host);
    }
    return host;
  }

  ui.toast = function (message, kind = 'info', ms = 3200) {
    const host = toastHost();
    const t = document.createElement('div');
    t.className = 'ob-toast' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
    t.textContent = message;
    host.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 260);
    }, ms);
  };

  /* ---------------- modal base ---------------- */

  function modal(build) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ob-backdrop';
      const modalEl = document.createElement('div');
      modalEl.className = 'ob-modal';
      backdrop.appendChild(modalEl);

      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        } else if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') {
          const btn = modalEl.querySelector('[data-ok]');
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('pointerdown', (e) => {
        if (e.target === backdrop) close(null);
      });

      build(modalEl, close);
      document.body.appendChild(backdrop);
      const focusEl = modalEl.querySelector('input:not([type=hidden]),textarea,select,button,[tabindex]');
      if (focusEl) setTimeout(() => focusEl.focus(), 30);
    });
  }

  ui.passwordDialog = function (opts = {}) {
    const { title = 'Enter password', confirm = false, note = '', okLabel = 'Unlock', minLen = 4 } = opts;
    return modal((el, close) => {
      el.innerHTML =
        '<h3></h3>' +
        (note ? '<p class="ob-modal-sub"></p>' : '') +
        '<div class="ob-field"><label class="ob-label">Password</label>' +
        '<input class="ob-input ob-mono" type="password" autocomplete="off" data-p1></div>' +
        (confirm
          ? '<div class="ob-field"><label class="ob-label">Confirm password</label>' +
            '<input class="ob-input ob-mono" type="password" autocomplete="off" data-p2></div>'
          : '') +
        '<div class="ob-modal-actions">' +
        '<button class="ob-btn ghost" data-cancel>Cancel</button>' +
        '<button class="ob-btn primary" data-ok></button></div>';
      el.querySelector('h3').textContent = title;
      if (note) el.querySelector('.ob-modal-sub').textContent = note;
      el.querySelector('[data-ok]').textContent = okLabel;
      const p1 = el.querySelector('[data-p1]');
      const p2 = el.querySelector('[data-p2]');
      el.querySelector('[data-ok]').addEventListener('click', () => {
        if (!p1.value) { p1.focus(); return; }
        if (confirm && p1.value.length < minLen) {
          ui.toast('Password must be at least ' + minLen + ' characters', 'err');
          return;
        }
        if (confirm && p1.value !== p2.value) {
          ui.toast('Passwords do not match', 'err');
          p2.focus();
          return;
        }
        const v = p1.value;
        p1.value = '';
        if (p2) p2.value = '';
        close(v);
      });
      el.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    });
  };

  ui.textPrompt = function ({ title = 'Name it', label = 'Name', value = '', okLabel = 'Save', placeholder = '' } = {}) {
    return modal((el, close) => {
      el.innerHTML =
        '<h3></h3>' +
        '<div class="ob-field"><label class="ob-label"></label>' +
        '<input class="ob-input" data-in></div>' +
        '<div class="ob-modal-actions">' +
        '<button class="ob-btn ghost" data-cancel>Cancel</button>' +
        '<button class="ob-btn primary" data-ok></button></div>';
      el.querySelector('h3').textContent = title;
      el.querySelector('.ob-label').textContent = label;
      const inp = el.querySelector('[data-in]');
      inp.value = value;
      if (placeholder) inp.placeholder = placeholder;
      el.querySelector('[data-ok]').textContent = okLabel;
      el.querySelector('[data-ok]').addEventListener('click', () => close(inp.value.trim() || null));
      el.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    });
  };

  ui.confirmDialog = function ({ title = 'Are you sure?', body = '', okLabel = 'Confirm', danger = false } = {}) {
    return modal((el, close) => {
      el.innerHTML =
        '<h3></h3>' +
        (body ? '<p class="ob-modal-sub"></p>' : '') +
        '<div class="ob-modal-actions">' +
        '<button class="ob-btn ghost" data-cancel>Cancel</button>' +
        '<button class="ob-btn ' + (danger ? 'danger' : 'primary') + '" data-ok></button></div>';
      el.querySelector('h3').textContent = title;
      if (body) el.querySelector('.ob-modal-sub').textContent = body;
      el.querySelector('[data-ok]').textContent = okLabel;
      el.querySelector('[data-ok]').addEventListener('click', () => close(true));
      el.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    });
  };

  /* ---------------- files ---------------- */

  ui.pickFiles = function ({ accept = '', multiple = false, directory = false } = {}) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.style.display = 'none';
      if (accept) inp.accept = accept;
      if (multiple) inp.multiple = true;
      if (directory) {
        inp.setAttribute('webkitdirectory', '');
        inp.setAttribute('directory', '');
      }
      inp.addEventListener('change', () => {
        const files = Array.from(inp.files || []);
        inp.remove();
        resolve(files);
      });
      inp.addEventListener('cancel', () => {
        inp.remove();
        resolve([]);
      });
      document.body.appendChild(inp);
      inp.click();
    });
  };

  ui.download = function (filename, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  /* ---------------- clipboard with auto-clear ---------------- */

  let clipboardTimer = null;

  ui.copy = async function (text, { clearAfter = 30, toastMsg = 'Copied' } = {}) {
    try {
      await navigator.clipboard.writeText(text);
      if (toastMsg) {
        ui.toast(toastMsg + (clearAfter > 0 ? ' · clears in ' + clearAfter + 's' : ''), 'ok', 2600);
      }
      if (clearAfter > 0) {
        clearTimeout(clipboardTimer);
        clipboardTimer = setTimeout(async () => {
          try {
            const cur = await navigator.clipboard.readText().catch(() => null);
            if (cur === text) await navigator.clipboard.writeText('');
          } catch (_) { /* clipboard may be locked; best effort */ }
        }, clearAfter * 1000);
      }
      return true;
    } catch (_) {
      ui.toast('Clipboard unavailable in this context', 'err');
      return false;
    }
  };

  /* ---------------- formatting ---------------- */

  ui.esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  ui.fmtBytes = (n) => {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return n.toFixed(n >= 100 ? 0 : 1) + ' ' + units[i];
  };

  ui.fmtDate = (ts) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  OB.ui = ui;
})();
