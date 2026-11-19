'use strict';
/* Pocketknife Docs editor — Google-Docs-style contenteditable paper + toolbar. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const esc = (s) => OB.ui.esc(s);

  const FONT_MENU = [
    'Arial', 'Calibri', 'Georgia', 'Roboto', 'Orbitron',
    'Roboto Mono', 'Times New Roman', 'Verdana', 'Courier New',
  ];
  const SIZE_MENU = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 48, 72];
  const SPACING_MENU = [1, 1.15, 1.5, 2];
  const ZOOM_MENU = [50, 75, 90, 100, 125, 150, 200];

  /* ---------- markdown <-> html ---------- */

  function mdToHtml(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let inCode = false, listType = null, para = [];
    const flushPara = () => {
      if (para.length) {
        html += '<p>' + inline(para.join(' ')) + '</p>';
        para = [];
      }
    };
    const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
    const inline = (t) =>
      esc(t)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line.startsWith('```')) {
        flushPara(); closeList();
        if (inCode) { html += '</code></pre>'; inCode = false; }
        else { html += '<pre><code>'; inCode = true; }
        continue;
      }
      if (inCode) { html += esc(raw) + '\n'; continue; }
      if (line === '') { flushPara(); closeList(); continue; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara(); closeList();
        const h = m[1].length;
        html += '<h' + h + '>' + inline(m[2]) + '</h' + h + '>';
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara(); closeList();
        html += '<blockquote>' + inline(m[1]) + '</blockquote>';
      } else if (/^(-{3,}|\*{3,})$/.test(line)) {
        flushPara(); closeList();
        html += '<hr>';
      } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
        if (listType !== 'ol') { flushPara(); closeList(); html += '<ol>'; listType = 'ol'; }
        html += '<li>' + inline(m[1]) + '</li>';
      } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
        if (listType !== 'ul') { flushPara(); closeList(); html += '<ul>'; listType = 'ul'; }
        html += '<li>' + inline(m[1]) + '</li>';
      } else {
        para.push(line);
      }
    }
    if (inCode) html += '</code></pre>';
    flushPara(); closeList();
    return html;
  }

  function htmlToMd(rootEl) {
    let out = '';
    const inline = (node) => {
      let s = '';
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { s += ch.textContent; continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.tagName;
        if (tag === 'STRONG' || tag === 'B') s += '**' + inline(ch) + '**';
        else if (tag === 'EM' || tag === 'I') s += '*' + inline(ch) + '*';
        else if (tag === 'CODE') s += '`' + ch.textContent + '`';
        else if (tag === 'A') s += '[' + inline(ch) + '](' + (ch.getAttribute('href') || '') + ')';
        else if (tag === 'BR') s += '\n';
        else s += inline(ch);
      }
      return s;
    };
    for (const el of rootEl.children) {
      const tag = el.tagName;
      const fam = (el.style && el.style.fontFamily) || '';
      if (fam) out += '<!--font:' + fam.replace(/"/g, '') + '-->\n';
      if (tag === 'H1') out += '# ' + inline(el) + '\n\n';
      else if (tag === 'H2') out += '## ' + inline(el) + '\n\n';
      else if (tag === 'H3' || tag === 'H4' || tag === 'H5') out += '### ' + inline(el) + '\n\n';
      else if (tag === 'P') out += inline(el).trim() + '\n\n';
      else if (tag === 'PRE') out += '```\n' + el.textContent.replace(/\n$/, '') + '\n```\n\n';
      else if (tag === 'BLOCKQUOTE') out += '> ' + inline(el).trim() + '\n\n';
      else if (tag === 'HR') out += '---\n\n';
      else if (tag === 'UL' || tag === 'OL') {
        let i = 1;
        for (const li of el.children) {
          if (li.tagName !== 'LI') continue;
          out += (tag === 'OL' ? i++ + '. ' : '- ') + inline(li).trim() + '\n';
        }
        out += '\n';
      } else out += inline(el).trim() + '\n\n';
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const kill = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON']);
    const walk = (el) => {
      for (const child of Array.from(el.children)) {
        if (kill.has(child.tagName)) { child.remove(); continue; }
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) child.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
        }
        walk(child);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }

  /* ---------- editor ---------- */

  const PALETTE = ['#000000', '#5f6368', '#202124', '#ffffff', '#d93025', '#e37400', '#188038', '#1a73e8', '#8430ce', '#ff63b1'];
  const PALETTE_HL = ['#ffffff', '#fff2cc', '#fce8e6', '#e6f4ea', '#e8f0fe', '#f3e8fd', '#ffe7f0', '#transparent'];

  function create({ doc, host, onDirty }) {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pk-docs';
    wrap.innerHTML =
      '<div class="pk-toolbar">' +
      '<button class="pk-tb" data-cmd="undo" title="Undo (Ctrl+Z)">↶</button>' +
      '<button class="pk-tb" data-cmd="redo" title="Redo (Ctrl+Y)">↷</button>' +
      '<span class="pk-tb-sep"></span>' +
      '<select class="pk-tb-sel pk-font-sel" title="Font"></select>' +
      '<select class="pk-tb-sel pk-size-sel" title="Font size"></select>' +
      '<span class="pk-tb-sep"></span>' +
      '<button class="pk-tb" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
      '<button class="pk-tb" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
      '<button class="pk-tb" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>' +
      '<button class="pk-tb" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>' +
      '<button class="pk-tb pk-color-btn" title="Text color"><span class="pk-dot"></span>A</button>' +
      '<button class="pk-tb pk-hl-btn" title="Highlight">🖍</button>' +
      '<button class="pk-tb" data-cmd="removeFormat" title="Clear formatting">⌫</button>' +
      '<span class="pk-tb-sep"></span>' +
      '<select class="pk-tb-sel pk-block-sel" title="Paragraph style"></select>' +
      '<select class="pk-tb-sel pk-spacing-sel" title="Line spacing"></select>' +
      '<span class="pk-tb-sep"></span>' +
      '<button class="pk-tb" data-cmd="justifyLeft" title="Align left">⯇</button>' +
      '<button class="pk-tb" data-cmd="justifyCenter" title="Center">≡</button>' +
      '<button class="pk-tb" data-cmd="justifyRight" title="Align right">⯈</button>' +
      '<button class="pk-tb" data-cmd="justifyFull" title="Justify">☰</button>' +
      '<span class="pk-tb-sep"></span>' +
      '<button class="pk-tb" data-cmd="insertUnorderedList" title="Bullet list">•—</button>' +
      '<button class="pk-tb" data-cmd="insertOrderedList" title="Numbered list">1—</button>' +
      '<button class="pk-tb" data-cmd="outdent" title="Decrease indent">⇤</button>' +
      '<button class="pk-tb" data-cmd="indent" title="Increase indent">⇥</button>' +
      '<span class="pk-tb-sep"></span>' +
      '<button class="pk-tb pk-link-btn" title="Insert link">🔗</button>' +
      '<button class="pk-tb pk-img-btn" title="Insert image">📷</button>' +
      '<button class="pk-tb pk-table-btn" title="Insert table">⊞</button>' +
      '<button class="pk-tb" data-cmd="insertHorizontalRule" title="Horizontal line">―</button>' +
      '<span class="pk-tb-sep"></span>' +
      '<button class="pk-tb pk-find-btn" title="Find and replace (Ctrl+H)">🔍</button>' +
      '</div>' +
      '<div class="pk-findbar ob-hidden">' +
      '<input class="ob-input pk-find-q" placeholder="Find">' +
      '<input class="ob-input pk-find-r" placeholder="Replace with">' +
      '<button class="ob-btn sm pk-find-prev">↑ Prev</button>' +
      '<button class="ob-btn sm pk-find-next">Next ↓</button>' +
      '<button class="ob-btn sm pk-find-rep">Replace</button>' +
      '<button class="ob-btn sm primary pk-find-all">Replace all</button>' +
      '<span class="pk-find-count ob-faint"></span>' +
      '<button class="ob-btn ghost sm pk-find-close">✕</button>' +
      '</div>' +
      '<div class="pk-docs-desk"><div class="pk-paper-scaler"><div class="pk-paper" contenteditable="true" spellcheck="true"></div></div></div>' +
      '<div class="pk-statusbar">' +
      '<span class="pk-counts"></span>' +
      '<span class="pk-zoom-wrap">Zoom <select class="pk-tb-sel pk-zoom-sel" title="Zoom"></select></span>' +
      '</div>';
    host.appendChild(wrap);
    const paper = wrap.querySelector('.pk-paper');
    const bar = wrap.querySelector('.pk-toolbar');
    const desk = wrap.querySelector('.pk-docs-desk');
    const scaler = wrap.querySelector('.pk-paper-scaler');
    const counts = wrap.querySelector('.pk-counts');

    paper.innerHTML = doc.data.html || '<p><br></p>';

    /* ----- selects ----- */

    const fontSel = wrap.querySelector('.pk-font-sel');
    for (const f of FONT_MENU) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      o.style.fontFamily = "'" + f + "'";
      fontSel.appendChild(o);
    }
    fontSel.addEventListener('change', () => {
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      cmd('fontName', fontSel.value);
      fontSel.value = '';
      fontSel.selectedIndex = -1;
    });
    fontSel.selectedIndex = -1;

    const sizeSel = wrap.querySelector('.pk-size-sel');
    for (const s of SIZE_MENU) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sizeSel.appendChild(o);
    }
    sizeSel.addEventListener('change', () => {
      if (sizeSel.value) applyFontSize(+sizeSel.value);
      sizeSel.selectedIndex = -1;
    });
    sizeSel.selectedIndex = -1;

    const blockSel = wrap.querySelector('.pk-block-sel');
    const BLOCKS = [['p', 'Normal text'], ['h1', 'Title'], ['h2', 'Heading 1'], ['h3', 'Heading 2'], ['h3', 'Heading 2'], ['blockquote', 'Quote'], ['pre', 'Code block']];
    const seen = new Set();
    for (const [v, label] of BLOCKS) {
      if (seen.has(v + label)) continue;
      seen.add(v + label);
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      blockSel.appendChild(o);
    }
    blockSel.addEventListener('change', () => {
      if (blockSel.value) cmd('formatBlock', '<' + blockSel.value + '>');
      blockSel.selectedIndex = -1;
    });
    blockSel.selectedIndex = -1;

    const spacingSel = wrap.querySelector('.pk-spacing-sel');
    for (const s of SPACING_MENU) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s + '×';
      spacingSel.appendChild(o);
    }
    spacingSel.addEventListener('change', () => {
      if (spacingSel.value) applyLineSpacing(spacingSel.value);
      spacingSel.selectedIndex = -1;
    });
    spacingSel.selectedIndex = -1;

    const zoomSel = wrap.querySelector('.pk-zoom-sel');
    for (const z of ZOOM_MENU) {
      const o = document.createElement('option');
      o.value = z;
      o.textContent = z + '%';
      if (z === 100) o.selected = true;
      zoomSel.appendChild(o);
    }
    zoomSel.addEventListener('change', () => {
      const z = +zoomSel.value / 100;
      scaler.style.zoom = z;
    });

    /* ----- helpers ----- */

    function cmd(name, val) {
      paper.focus();
      document.execCommand(name, false, val);
      changed();
    }

    /* execCommand fontSize only supports 1-7; use the font[size=7] swap trick. */
    function applyFontSize(px) {
      paper.focus();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('fontSize', false, '7');
      paper.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = px + 'px';
        span.innerHTML = f.innerHTML;
        f.replaceWith(span);
      });
      changed();
    }

    function applyLineSpacing(val) {
      paper.focus();
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) return;
      let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const block = node && node.closest ? node.closest('p,h1,h2,h3,li,blockquote,pre,div') : null;
      if (block && block !== paper) {
        block.style.lineHeight = val;
        changed();
      }
    }

    const btn = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.className = 'ob-btn ghost sm pk-tb' + (cls ? ' ' + cls : '');
      b.innerHTML = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };

    function colorPop(fn) {
      const pop = document.createElement('div');
      pop.className = 'pk-pop';
      for (const c of PALETTE) {
        const sw = document.createElement('button');
        sw.className = 'pk-swatch';
        sw.style.background = c;
        sw.addEventListener('mousedown', (e) => e.preventDefault());
        sw.addEventListener('click', () => { fn(c); pop.remove(); });
        pop.appendChild(sw);
      }
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.addEventListener('input', () => { fn(custom.value); pop.remove(); });
      pop.appendChild(custom);
      return pop;
    }
    function togglePop(anchor, pop) {
      const existing = wrap.querySelector('.pk-pop');
      if (existing) { existing.remove(); return; }
      pop.classList.add('pk-pop');
      anchor.parentElement.appendChild(pop);
      setTimeout(() => {
        const closer = (e) => {
          if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', closer); }
        };
        document.addEventListener('mousedown', closer);
      }, 0);
    }

    const colorBtn = wrap.querySelector('.pk-color-btn');
    colorBtn.addEventListener('click', () => {
      togglePop(colorBtn, colorPop((c) => {
        try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
        cmd('foreColor', c);
      }));
    });
    const hlBtn = wrap.querySelector('.pk-hl-btn');
    hlBtn.addEventListener('click', () => {
      togglePop(hlBtn, colorPop((c) => {
        try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
        cmd('hiliteColor', c);
      }));
    });

    /* ----- find & replace ----- */

    const findbar = wrap.querySelector('.pk-findbar');
    const findQ = wrap.querySelector('.pk-find-q');
    const findR = wrap.querySelector('.pk-find-r');
    const findCount = wrap.querySelector('.pk-find-count');

    function openFindbar(prefill) {
      findbar.classList.remove('ob-hidden');
      findQ.focus();
      if (prefill) findQ.value = prefill;
      updateFindCount();
    }
    wrap.querySelector('.pk-find-btn').addEventListener('click', () => {
      if (findbar.classList.contains('ob-hidden')) {
        const sel = window.getSelection();
        openFindbar(sel && !sel.isCollapsed ? sel.toString() : '');
      } else findbar.classList.add('ob-hidden');
    });
    wrap.querySelector('.pk-find-close').addEventListener('click', () => findbar.classList.add('ob-hidden'));

    function countMatches() {
      const q = findQ.value;
      if (!q) { findCount.textContent = ''; return 0; }
      let n = 0;
      const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent;
        let i = 0;
        while ((i = t.indexOf(q, i)) !== -1) { n++; i += q.length; }
      }
      findCount.textContent = n ? n + ' match' + (n > 1 ? 'es' : '') : 'no matches';
      return n;
    }
    function updateFindCount() { countMatches(); }
    findQ.addEventListener('input', updateFindCount);
    findQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(false); } });

    function findNext(backwards) {
      const q = findQ.value;
      if (!q) return;
      paper.focus();
      let found = false;
      try { found = window.find(q, false, backwards, false, true, false, false); } catch (_) {}
      if (!found) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        try { window.find(q, false, backwards, false, true, false, false); } catch (_) {}
      }
    }
    wrap.querySelector('.pk-find-next').addEventListener('click', () => findNext(false));
    wrap.querySelector('.pk-find-prev').addEventListener('click', () => findNext(true));

    wrap.querySelector('.pk-find-rep').addEventListener('click', () => {
      const q = findQ.value, r = findR.value;
      if (!q) return;
      const sel = window.getSelection();
      if (sel && sel.toString() === q) {
        paper.focus();
        document.execCommand('insertText', false, r);
        changed();
      }
      findNext(false);
      updateFindCount();
    });

    wrap.querySelector('.pk-find-all').addEventListener('click', () => {
      const q = findQ.value, r = findR.value;
      if (!q || !paper.innerText.includes(q)) { updateFindCount(); return; }
      const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!node.textContent.includes(q)) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        const t = node.textContent;
        let i = 0;
        while ((i = t.indexOf(q, i)) !== -1) {
          if (i > last) frag.appendChild(document.createTextNode(t.slice(last, i)));
          frag.appendChild(document.createTextNode(r));
          last = i + q.length;
          i += Math.max(q.length, 1);
        }
        if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
        node.replaceWith(frag);
      }
      changed();
      updateFindCount();
      OB.ui.toast('Replaced all occurrences', 'ok');
    });

    paper.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        openFindbar(window.getSelection().toString());
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // keep lists tidy: default behavior is fine
      }
    });

    /* ----- insert buttons ----- */

    wrap.querySelector('.pk-link-btn').addEventListener('click', async () => {
      const url = await OB.ui.textPrompt({ title: 'Insert link', label: 'URL', placeholder: 'https://…' });
      if (url) cmd('createLink', url);
    });
    wrap.querySelector('.pk-img-btn').addEventListener('click', async () => {
      const files = await OB.ui.pickFiles({ accept: 'image/*' });
      const file = files[0];
      if (!file) return;
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(file);
      });
      cmd('insertImage', dataUrl);
    });
    wrap.querySelector('.pk-table-btn').addEventListener('click', async () => {
      const dims = await OB.ui.textPrompt({ title: 'Insert table', label: 'Rows × columns', value: '3×3', placeholder: '3×3' });
      if (!dims) return;
      const m = dims.match(/(\d+)\s*[x×]\s*(\d+)/i);
      const rows = Math.min(20, Math.max(1, m ? +m[1] : 3));
      const cols = Math.min(10, Math.max(1, m ? +m[2] : 3));
      let t = '<table class="pk-table"><tbody>';
      for (let r = 0; r < rows; r++) {
        t += '<tr>';
        for (let c = 0; c < cols; c++) t += '<td><br></td>';
        t += '</tr>';
      }
      t += '</tbody></table><p><br></p>';
      cmd('insertHTML', t);
    });

    /* ----- command buttons ----- */

    bar.querySelectorAll('[data-cmd]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => cmd(b.dataset.cmd));
    });

    function updateCounts() {
      const text = paper.innerText || '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const mins = Math.max(1, Math.round(words / 200));
      counts.textContent = words.toLocaleString() + ' words · ' + text.length.toLocaleString() + ' characters · ~' + mins + ' min read';
    }

    let dirtyTimer = null;
    function changed() {
      updateCounts();
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(() => {
        doc.data.html = paper.innerHTML;
        doc.updated = Date.now();
        onDirty && onDirty();
      }, 300);
    }
    paper.addEventListener('input', changed);
    updateCounts();

    return {
      destroy() { host.innerHTML = ''; },
      focus() { paper.focus(); },
      getPaper: () => paper,
      importHtml(html) { paper.innerHTML = sanitizeHtml(html); changed(); },
      importText(text) {
        paper.innerHTML = String(text).split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') || '<p><br></p>';
        changed();
      },
      toMarkdown() { return htmlToMd(paper); },
      toPlainText() { return paper.innerText; },
      toStandaloneHtml() {
        return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(doc.name) +
          '</title><style>body{font-family:Calibri,Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 24px;line-height:1.6;color:#111;background:#fff}' +
          'img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px 10px}pre{background:#f4f4f4;padding:12px;overflow:auto}' +
          'blockquote{border-left:3px solid #ccc;margin:0;padding-left:16px;color:#555}</style></head><body>' + paper.innerHTML + '</body></html>';
      },
    };
  }

  OB.docs = { create, mdToHtml, htmlToMd, sanitizeHtml, FONT_MENU };
})();
