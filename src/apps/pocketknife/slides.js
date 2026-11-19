'use strict';
/* Pocketknife Slides editor — filmstrip, canvas, format panel, present mode. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const W = 960, H = 540;

  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }

  function defaultText() {
    return { id: uid(), type: 'text', x: 80, y: 200, w: 400, h: 90, z: 0, props: { html: 'Double-click to edit', fontSize: 32, color: '#1a1a1a', bold: false, align: 'left' } };
  }

  function renderSlideEl(el) {
    const d = document.createElement('div');
    d.className = 'pk-el';
    d.style.left = el.x + 'px';
    d.style.top = el.y + 'px';
    d.style.width = el.w + 'px';
    d.style.height = el.h + 'px';
    d.style.zIndex = el.z || 0;
    if (el.type === 'text') {
      d.classList.add('pk-el-text');
      const t = document.createElement('div');
      t.className = 'pk-el-text-inner';
      t.contentEditable = 'false';
      t.style.fontSize = (el.props.fontSize || 28) + 'px';
      t.style.color = el.props.color || '#1a1a1a';
      t.style.fontWeight = el.props.bold ? '700' : '400';
      t.style.textAlign = el.props.align || 'left';
      t.innerHTML = el.props.html || '';
      d.appendChild(t);
    } else if (el.type === 'rect' || el.type === 'ellipse') {
      if (el.type === 'ellipse') d.style.borderRadius = '50%';
      d.style.background = el.props.fill || '#4f8cff';
      if (el.props.border && el.props.borderWidth) {
        d.style.border = el.props.borderWidth + 'px solid ' + el.props.border;
      }
    } else if (el.type === 'image') {
      const img = document.createElement('img');
      img.src = el.props.src || '';
      img.draggable = false;
      d.appendChild(img);
    }
    d.dataset.id = el.id;
    return d;
  }

  function renderSlideInto(container, slide) {
    container.innerHTML = '';
    const sorted = (slide.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const el of sorted) container.appendChild(renderSlideEl(el));
  }

  function thumbHtml(slide) {
    return '<div class="pk-thumb-slide">' +
      (slide.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0)).map((el) => {
        let st = 'left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px;z-index:' + (el.z || 0) + ';';
        if (el.type === 'text') {
          st += 'font-size:' + (el.props.fontSize || 28) + 'px;color:' + (el.props.color || '#1a1a1a') + ';';
          st += 'font-weight:' + (el.props.bold ? 700 : 400) + ';text-align:' + (el.props.align || 'left') + ';';
          return '<div class="pk-el pk-thumb-text" style="' + st + '">' + el.props.html + '</div>';
        }
        if (el.type === 'ellipse') st += 'border-radius:50%;';
        st += 'background:' + (el.type === 'image' ? 'transparent' : el.props.fill || '#4f8cff') + ';';
        if (el.type === 'image') st += 'background-size:cover;background-image:url(' + el.props.src + ');';
        return '<div class="pk-el" style="' + st + '"></div>';
      }).join('') + '</div>';
  }

  function create({ doc, host, onDirty }) {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pk-slides';
    wrap.innerHTML =
      '<div class="pk-slides-bar">' +
      '<button class="ob-btn ghost sm" data-add>+ Slide</button>' +
      '<button class="ob-btn ghost sm" data-dup>Duplicate</button>' +
      '<button class="ob-btn ghost sm" data-up>▲</button>' +
      '<button class="ob-btn ghost sm" data-down>▼</button>' +
      '<button class="ob-btn ghost sm danger" data-del>🗑 Slide</button>' +
      '</div>' +
      '<div class="pk-slides-main">' +
      '<div class="pk-filmstrip"></div>' +
      '<div class="pk-canvas-area"><div class="pk-canvas-holder"><div class="pk-slide"></div></div></div>' +
      '<div class="pk-format"></div>' +
      '</div>';
    host.appendChild(wrap);

    const deck = doc.data;
    const film = wrap.querySelector('.pk-filmstrip');
    const slideEl = wrap.querySelector('.pk-slide');
    const canvasHolder = wrap.querySelector('.pk-canvas-holder');
    const formatPanel = wrap.querySelector('.pk-format');

    let cur = 0;
    let selectedId = null;
    let scale = 1;

    if (!deck.slides || !deck.slides.length) deck.slides = [{ elements: [] }];

    function slide() { return deck.slides[Math.min(cur, deck.slides.length - 1)]; }
    function findEl(id) { return (slide().elements || []).find((e) => e.id === id); }

    function changed() {
      doc.updated = Date.now();
      onDirty && onDirty();
      renderFilm();
      renderCanvas();
      renderFormat();
    }

    /* ----- filmstrip ----- */

    function renderFilm() {
      film.innerHTML = '';
      deck.slides.forEach((s, i) => {
        const d = document.createElement('div');
        d.className = 'pk-thumb' + (i === cur ? ' on' : '');
        d.innerHTML = '<div class="pk-thumb-num">' + (i + 1) + '</div>' + thumbHtml(s);
        d.addEventListener('click', () => { cur = i; selectedId = null; changed(); });
        film.appendChild(d);
      });
    }

    /* ----- canvas ----- */

    function computeScale() {
      const area = wrap.querySelector('.pk-canvas-area');
      scale = Math.min((area.clientWidth - 40) / W, (area.clientHeight - 40) / H, 1.4);
      canvasHolder.style.width = W * scale + 'px';
      canvasHolder.style.height = H * scale + 'px';
      slideEl.style.transform = 'scale(' + scale + ')';
    }

    function renderCanvas() {
      computeScale();
      slideEl.style.width = W + 'px';
      slideEl.style.height = H + 'px';
      renderSlideInto(slideEl, slide());
      for (const el of slide().elements || []) {
        const node = slideEl.querySelector('[data-id="' + el.id + '"]');
        if (!node) continue;
        node.addEventListener('mousedown', (e) => {
          if (e.target.isContentEditable) return;
          e.stopPropagation();
          selectEl(el.id);
          startDrag(e, el, node, 'move');
        });
        const t = node.querySelector('.pk-el-text-inner');
        if (t) {
          t.addEventListener('dblclick', () => {
            t.contentEditable = 'true';
            t.focus();
            document.execCommand('selectAll', false, null);
          });
          t.addEventListener('blur', () => {
            t.contentEditable = 'false';
            el.props.html = t.innerHTML;
            changed();
          });
          t.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') t.blur();
            e.stopPropagation();
          });
        }
      }
      slideEl.addEventListener('mousedown', (e) => {
        if (e.target === slideEl) { selectedId = null; renderCanvas(); renderFormat(); }
      });
      if (selectedId) drawSelection();
    }

    function drawSelection() {
      slideEl.querySelectorAll('.pk-selbox,.pk-handle').forEach((n) => n.remove());
      const el = findEl(selectedId);
      if (!el) return;
      const box = document.createElement('div');
      box.className = 'pk-selbox';
      box.style.left = el.x + 'px';
      box.style.top = el.y + 'px';
      box.style.width = el.w + 'px';
      box.style.height = el.h + 'px';
      slideEl.appendChild(box);
      const spots = [
        ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
        ['w', 0, 0.5], ['e', 1, 0.5],
        ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1],
      ];
      for (const [dir, fx, fy] of spots) {
        const h = document.createElement('div');
        h.className = 'pk-handle pk-h-' + dir;
        h.style.left = el.x + el.w * fx + 'px';
        h.style.top = el.y + el.h * fy + 'px';
        h.dataset.dir = dir;
        h.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startDrag(e, el, null, 'resize:' + dir);
        });
        slideEl.appendChild(h);
      }
    }

    function selectEl(id) {
      selectedId = id;
      drawSelection();
      renderFormat();
    }

    function startDrag(e, el, node, mode) {
      const startX = e.clientX, startY = e.clientY;
      const o = { x: el.x, y: el.y, w: el.w, h: el.h };
      const move = (ev) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        if (mode === 'move') {
          el.x = Math.round(o.x + dx);
          el.y = Math.round(o.y + dy);
        } else {
          const dir = mode.split(':')[1];
          if (dir.includes('e')) el.w = Math.max(20, Math.round(o.w + dx));
          if (dir.includes('s')) el.h = Math.max(20, Math.round(o.h + dy));
          if (dir.includes('w')) { el.x = Math.round(o.x + dx); el.w = Math.max(20, Math.round(o.w - dx)); }
          if (dir.includes('n')) { el.y = Math.round(o.y + dy); el.h = Math.max(20, Math.round(o.h - dy)); }
        }
        const node2 = slideEl.querySelector('[data-id="' + el.id + '"]');
        if (node2) {
          node2.style.left = el.x + 'px';
          node2.style.top = el.y + 'px';
          node2.style.width = el.w + 'px';
          node2.style.height = el.h + 'px';
        }
        drawSelection();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        changed();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }

    /* ----- keyboard ----- */

    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const el = findEl(selectedId);
      if (!el) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        slide().elements = slide().elements.filter((x) => x.id !== selectedId);
        selectedId = null;
        changed();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') el.y -= d;
        if (e.key === 'ArrowDown') el.y += d;
        if (e.key === 'ArrowLeft') el.x -= d;
        if (e.key === 'ArrowRight') el.x += d;
        changed();
      }
    });

    /* ----- toolbar ----- */

    wrap.querySelector('[data-add]').addEventListener('click', () => {
      deck.slides.splice(cur + 1, 0, { elements: [] });
      cur = cur + 1;
      changed();
    });
    wrap.querySelector('[data-dup]').addEventListener('click', () => {
      const copy = JSON.parse(JSON.stringify(slide()));
      copy.elements.forEach((el) => (el.id = uid()));
      deck.slides.splice(cur + 1, 0, copy);
      cur++;
      changed();
    });
    wrap.querySelector('[data-up]').addEventListener('click', () => {
      if (cur === 0) return;
      const [s] = deck.slides.splice(cur, 1);
      deck.slides.splice(cur - 1, 0, s);
      cur--;
      changed();
    });
    wrap.querySelector('[data-down]').addEventListener('click', () => {
      if (cur >= deck.slides.length - 1) return;
      const [s] = deck.slides.splice(cur, 1);
      deck.slides.splice(cur + 1, 0, s);
      cur++;
      changed();
    });
    wrap.querySelector('[data-del]').addEventListener('click', async () => {
      if (deck.slides.length <= 1) { OB.ui.toast('A deck needs at least one slide', 'err'); return; }
      const yes = await OB.ui.confirmDialog({ title: 'Delete slide ' + (cur + 1) + '?', okLabel: 'Delete', danger: true });
      if (!yes) return;
      deck.slides.splice(cur, 1);
      cur = Math.min(cur, deck.slides.length - 1);
      changed();
    });

    /* ----- format panel ----- */

    function renderFormat() {
      const el = findEl(selectedId);
      formatPanel.innerHTML = '';
      const head = (t) => {
        const h = document.createElement('div');
        h.className = 'pk-fmt-head';
        h.textContent = t;
        formatPanel.appendChild(h);
      };
      if (!el) {
        head('Insert');
        const ins = (label, fn) => {
          const b = document.createElement('button');
          b.className = 'ob-btn sm';
          b.textContent = label;
          b.style.display = 'block';
          b.style.marginBottom = '6px';
          b.addEventListener('click', fn);
          formatPanel.appendChild(b);
        };
        ins('Text box', () => addEl({ ...defaultText(), x: 100, y: 240 }));
        ins('Rectangle', () => addEl({ id: uid(), type: 'rect', x: 200, y: 180, w: 260, h: 160, z: nextZ(), props: { fill: '#4f8cff', border: '', borderWidth: 0 } }));
        ins('Ellipse', () => addEl({ id: uid(), type: 'ellipse', x: 200, y: 180, w: 200, h: 200, z: nextZ(), props: { fill: '#3fd68f', border: '', borderWidth: 0 } }));
        ins('Image', async () => {
          const files = await OB.ui.pickFiles({ accept: 'image/*' });
          if (!files[0]) return;
          const src = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(files[0]);
          });
          addEl({ id: uid(), type: 'image', x: 180, y: 150, w: 360, h: 240, z: nextZ(), props: { src } });
        });
        return;
      }
      head(el.type === 'text' ? 'Text' : el.type === 'image' ? 'Image' : 'Shape');
      const row = (label, inputEl) => {
        const r = document.createElement('label');
        r.className = 'pk-fmt-row';
        const l = document.createElement('span');
        l.textContent = label;
        r.append(l, inputEl);
        formatPanel.appendChild(r);
      };
      if (el.type === 'text') {
        const fs = document.createElement('input');
        fs.className = 'ob-input';
        fs.type = 'number';
        fs.value = el.props.fontSize || 28;
        fs.addEventListener('change', () => { el.props.fontSize = +fs.value || 28; changed(); });
        row('Font size', fs);
        const c = colorInput(el.props.color || '#1a1a1a', (v) => { el.props.color = v; changed(); });
        row('Color', c);
        const b = document.createElement('input');
        b.type = 'checkbox';
        b.checked = !!el.props.bold;
        b.addEventListener('change', () => { el.props.bold = b.checked; changed(); });
        row('Bold', b);
        const al = document.createElement('select');
        al.className = 'ob-select';
        for (const v of ['left', 'center', 'right']) {
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          al.appendChild(o);
        }
        al.value = el.props.align || 'left';
        al.addEventListener('change', () => { el.props.align = al.value; changed(); });
        row('Align', al);
      } else if (el.type === 'rect' || el.type === 'ellipse') {
        formatPanel.appendChild(colorInput(el.props.fill || '#4f8cff', (v) => { el.props.fill = v; changed(); }));
        const bw = document.createElement('input');
        bw.className = 'ob-input';
        bw.type = 'number';
        bw.value = el.props.borderWidth || 0;
        bw.addEventListener('change', () => { el.props.borderWidth = +bw.value || 0; changed(); });
        row('Border width', bw);
        formatPanel.appendChild(colorInput(el.props.border || '#1a1a1a', (v) => { el.props.border = v; changed(); }));
      }
      head('Layer');
      const lr = document.createElement('div');
      lr.className = 'pk-fmt-layer';
      const zbtn = (label, fn) => {
        const b = document.createElement('button');
        b.className = 'ob-btn ghost sm';
        b.textContent = label;
        b.addEventListener('click', fn);
        lr.appendChild(b);
      };
      zbtn('↑ front', () => { el.z = nextZ() + 1; changed(); });
      zbtn('↑', () => { el.z = (el.z || 0) + 1; changed(); });
      zbtn('↓', () => { el.z = Math.max(0, (el.z || 0) - 1); changed(); });
      zbtn('↓ back', () => { el.z = -1; changed(); });
      formatPanel.appendChild(lr);
    }

    function colorInput(value, onChange) {
        const c = document.createElement('input');
        c.type = 'color';
        c.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#4f8cff';
        c.addEventListener('input', () => onChange(c.value));
        return c;
    }

    function nextZ() {
      return (slide().elements || []).reduce((m, e) => Math.max(m, e.z || 0), 0);
    }
    function addEl(el) {
      slide().elements = slide().elements || [];
      slide().elements.push(el);
      selectedId = el.id;
      changed();
    }

    /* ----- present / export ----- */

    function present() {
      const overlay = document.createElement('div');
      overlay.className = 'pk-present';
      let idx = cur;
      const show = () => {
        overlay.innerHTML = '<div class="pk-present-count">' + (idx + 1) + ' / ' + deck.slides.length + '</div>';
        const holder = document.createElement('div');
        holder.className = 'pk-present-holder';
        const s = document.createElement('div');
        s.className = 'pk-slide';
        s.style.width = W + 'px';
        s.style.height = H + 'px';
        const sc = Math.min(innerWidth / W, (innerHeight - 60) / H);
        s.style.transform = 'scale(' + sc + ')';
        holder.appendChild(s);
        renderSlideInto(s, deck.slides[idx]);
        overlay.appendChild(holder);
      };
      show();
      const nav = (e) => {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { if (idx < deck.slides.length - 1) { idx++; show(); } }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (idx > 0) { idx--; show(); } }
        else if (e.key === 'Escape') close();
      };
      const click = () => { if (idx < deck.slides.length - 1) { idx++; show(); } };
      const close = () => {
        document.removeEventListener('keydown', nav);
        overlay.remove();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      };
      document.addEventListener('keydown', nav);
      overlay.addEventListener('click', click);
      const esc = document.createElement('button');
      esc.className = 'ob-btn sm pk-present-exit';
      esc.textContent = 'Esc';
      esc.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      overlay.appendChild(esc);
      document.body.appendChild(overlay);
      if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
    }

    function exportStandalone() {
      const slidesHtml = deck.slides.map((s) =>
        '<div class="slide" style="position:relative;width:' + W + 'px;height:' + H + 'px;background:#fff;overflow:hidden;margin:20px auto;">' +
        thumbHtml(s).replace('class="pk-thumb-slide"', 'style="position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;"') +
        '</div>'
      ).join('');
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + OB.ui.esc(doc.name) +
        '</title><style>body{background:#222;margin:0;padding:20px 0}img{max-width:100%}</style></head><body>' + slidesHtml + '</body></html>';
      OB.ui.download((doc.name || 'deck') + '.html', html, 'text/html');
    }

    function printDeck() {
      const p = document.createElement('div');
      p.className = 'pk-print';
      deck.slides.forEach((s) => {
        const page = document.createElement('div');
        page.className = 'pk-print-page';
        page.innerHTML = thumbHtml(s);
        p.appendChild(page);
      });
      document.body.appendChild(p);
      const cleanup = () => { p.remove(); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      setTimeout(() => { window.print(); }, 60);
    }

    renderFilm();
    renderCanvas();
    renderFormat();
    window.addEventListener('resize', () => {
      if (document.body.contains(wrap)) computeScale();
    });

    return {
      destroy() { host.innerHTML = ''; },
      focus() { wrap.focus(); },
      present,
      exportStandalone,
      printDeck,
    };
  }

  OB.slides = { create };
})();
