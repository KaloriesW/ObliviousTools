'use strict';
/* Pocketknife Sheets editor — grid, formula bar, context menus, CSV/XLSX. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  const F = () => OB.formulas;

  /* ---------- csv ---------- */

  function parseCsv(text, delim) {
    delim = delim || ',';
    const rows = [];
    let row = [], cell = '', q = false;
    text = String(text).replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function toCsv(cells, maxCol, maxRow) {
    const lines = [];
    for (let r = 0; r <= maxRow; r++) {
      const cols = [];
      for (let c = 0; c <= maxCol; c++) {
        const v = cells[colName(c) + (r + 1)] ?? '';
        const s = String(v);
        cols.push(/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
      }
      lines.push(cols.join(','));
    }
    return lines.join('\n');
  }

  function colName(i) { return F().indexToCol(i); }
  function colIdx(name) { return F().colToIndex(name); }

  /* ---------- editor ---------- */

  function create({ doc, host, onDirty }) {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pk-sheets';
    wrap.innerHTML =
      '<div class="pk-sheet-bar">' +
      '<span class="pk-cellref ob-mono">A1</span>' +
      '<span class="pk-fx">fx</span>' +
      '<input class="ob-input pk-fx-input" placeholder="Enter value or =formula">' +
      '</div>' +
      '<div class="pk-grid-wrap"><table class="pk-grid"></table></div>' +
      '<div class="pk-sheet-foot">' +
      '<button class="ob-btn ghost sm" data-addrows>+10 rows</button>' +
      '<button class="ob-btn ghost sm" data-addcols>+10 cols</button>' +
      '<span class="pk-grid-info ob-faint"></span></div>';
    host.appendChild(wrap);

    const table = wrap.querySelector('.pk-grid');
    const cellRefLabel = wrap.querySelector('.pk-cellref');
    const fxInput = wrap.querySelector('.pk-fx-input');
    const gridInfo = wrap.querySelector('.pk-grid-info');
    const data = doc.data;

    let sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
    let anchor = { r: 0, c: 0 };
    let editing = null;
    let clip = null;
    let engine = F().createEngine((c, r) => {
      const v = data.cells[colName(c) + (r + 1)];
      return v === undefined || v === null ? null : v;
    });

    function key(r, c) { return colName(c) + (r + 1); }
    function changed() {
      engine.invalidate();
      doc.updated = Date.now();
      onDirty && onDirty();
      renderValues();
      updateInfo();
    }
    function updateInfo() {
      gridInfo.textContent = (data.cols) + ' cols × ' + (data.rows) + ' rows · ' +
        Object.keys(data.cells).length + ' filled';
    }

    /* ----- build grid ----- */

    function buildGrid() {
      table.innerHTML = '';
      const head = document.createElement('thead');
      const hr = document.createElement('tr');
      const corner = document.createElement('th');
      corner.className = 'pk-corner';
      hr.appendChild(corner);
      for (let c = 0; c < data.cols; c++) {
        const th = document.createElement('th');
        th.textContent = colName(c);
        th.dataset.col = c;
        hr.appendChild(th);
      }
      head.appendChild(hr);
      table.appendChild(head);
      const body = document.createElement('tbody');
      for (let r = 0; r < data.rows; r++) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = r + 1;
        th.dataset.row = r;
        tr.appendChild(th);
        for (let c = 0; c < data.cols; c++) {
          const td = document.createElement('td');
          td.dataset.r = r;
          td.dataset.c = c;
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.appendChild(body);
      renderValues();
    }

    function displayValue(raw) {
      const v = engine.compute(raw);
      if (F().isErr(v)) return { text: v.err, cls: 'pk-err' };
      if (v === null || v === undefined) return { text: '', cls: '' };
      if (typeof v === 'number') return { text: String(Math.round(v * 1e10) / 1e10), cls: 'pk-num' };
      if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', cls: 'pk-num' };
      return { text: String(v), cls: '' };
    }

    function tdAt(r, c) {
      return table.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    }

    function renderValues() {
      for (let r = 0; r < data.rows; r++) {
        for (let c = 0; c < data.cols; c++) {
          const td = tdAt(r, c);
          if (!td) continue;
          const raw = data.cells[key(r, c)];
          if (raw === undefined || raw === '') { td.textContent = ''; td.className = ''; }
          else {
            const d = displayValue(raw);
            td.textContent = d.text;
            td.className = d.cls;
          }
        }
      }
      renderSel();
    }

    function renderSel() {
      table.querySelectorAll('.pk-sel,.pk-anchor').forEach((el) => el.classList.remove('pk-sel', 'pk-anchor'));
      for (let r = sel.r1; r <= sel.r2; r++) {
        for (let c = sel.c1; c <= sel.c2; c++) {
          const td = tdAt(r, c);
          if (td) td.classList.add('pk-sel');
        }
      }
      const a = tdAt(anchor.r, anchor.c);
      if (a) a.classList.add('pk-anchor');
      cellRefLabel.textContent = (sel.r1 === sel.r2 && sel.c1 === sel.c2)
        ? key(anchor.r, anchor.c)
        : key(sel.r1, sel.c1) + ':' + key(sel.r2, sel.c2);
    }

    function setSelection(r, c, extend) {
      r = Math.max(0, Math.min(data.rows - 1, r));
      c = Math.max(0, Math.min(data.cols - 1, c));
      if (extend) {
        sel.r1 = Math.min(anchor.r, r); sel.r2 = Math.max(anchor.r, r);
        sel.c1 = Math.min(anchor.c, c); sel.c2 = Math.max(anchor.c, c);
      } else {
        anchor = { r, c };
        sel = { r1: r, c1: c, r2: r, c2: c };
      }
      fxInput.value = data.cells[key(anchor.r, anchor.c)] ?? '';
      renderSel();
    }

    /* ----- editing ----- */

    function startEdit(initial) {
      if (editing) commitEdit();
      const td = tdAt(anchor.r, anchor.c);
      if (!td) return;
      const input = document.createElement('input');
      input.className = 'pk-cell-edit ob-mono';
      input.value = initial !== undefined ? initial : (data.cells[key(anchor.r, anchor.c)] ?? '');
      td.textContent = '';
      td.appendChild(input);
      input.focus();
      if (initial === undefined) input.select();
      editing = { input, r: anchor.r, c: anchor.c };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); setSelection(anchor.r + 1, anchor.c); }
        else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); setSelection(anchor.r, anchor.c + 1); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      input.addEventListener('blur', () => { if (editing) commitEdit(); });
    }

    function commitEdit() {
      if (!editing) return;
      const { input, r, c } = editing;
      editing = null;
      const k = key(r, c);
      const v = input.value;
      if (v === '') delete data.cells[k];
      else data.cells[k] = v;
      input.remove();
      changed();
    }
    function cancelEdit() {
      if (!editing) return;
      editing.input.remove();
      editing = null;
      renderValues();
    }

    /* ----- grid events ----- */

    table.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      if (editing) commitEdit();
      setSelection(+td.dataset.r, +td.dataset.c, e.shiftKey);
    });
    table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      setSelection(+td.dataset.r, +td.dataset.c);
      startEdit();
    });
    table.addEventListener('contextmenu', (e) => {
      const th = e.target.closest('th');
      if (!th || th.classList.contains('pk-corner')) return;
      e.preventDefault();
      if (th.dataset.col !== undefined) headerMenu(+th.dataset.col, null, e);
      else if (th.dataset.row !== undefined) headerMenu(null, +th.dataset.row, e);
    });

    wrap.addEventListener('keydown', (e) => {
      if (editing) return;
      const { r, c } = anchor;
      const ext = e.shiftKey;
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelection(r - 1, c, ext); scrollCell(anchor.r, anchor.c); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelection(r + 1, c, ext); scrollCell(anchor.r, anchor.c); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setSelection(r, c - 1, ext); scrollCell(anchor.r, anchor.c); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSelection(r, c + 1, ext); scrollCell(anchor.r, anchor.c); }
      else if (e.key === 'Tab') { e.preventDefault(); setSelection(r, c + 1); }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        let n = 0;
        for (let rr = sel.r1; rr <= sel.r2; rr++)
          for (let cc = sel.c1; cc <= sel.c2; cc++) { delete data.cells[key(rr, cc)]; n++; }
        if (n) changed();
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' || e.key === 'C') { copySel(); }
        else if (e.key === 'v' || e.key === 'V') { /* handled by paste event */ }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEdit(e.key);
      }
    });
    wrap.tabIndex = 0;

    function scrollCell(r, c) {
      const td = tdAt(r, c);
      if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function copySel() {
      const rows = [];
      for (let r = sel.r1; r <= sel.r2; r++) {
        const cols = [];
        for (let c = sel.c1; c <= sel.c2; c++) cols.push(data.cells[key(r, c)] ?? '');
        rows.push(cols);
      }
      clip = rows;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(rows.map((r) => r.join('\t')).join('\n')).catch(() => {});
      }
    }

    wrap.addEventListener('paste', (e) => {
      if (editing) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const rows = clip || text.split('\n').map((l) => l.split('\t'));
      pasteBlock(rows);
    });
    wrap.addEventListener('copy', (e) => {
      if (editing) return;
      copySel();
    });

    function pasteBlock(rows) {
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const rr = anchor.r + r, cc = anchor.c + c;
          if (rr >= data.rows) data.rows = rr + 1;
          if (cc >= data.cols) data.cols = cc + 1;
          const v = String(rows[r][c] ?? '');
          if (v === '') delete data.cells[key(rr, cc)];
          else data.cells[key(rr, cc)] = v;
        }
      }
      buildGrid();
      changed();
    }

    /* ----- header context menu ----- */

    function headerMenu(col, row, e) {
      const menu = document.createElement('div');
      menu.className = 'pk-menu';
      const item = (label, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => { fn(); menu.remove(); });
        menu.appendChild(b);
      };
      if (col !== null) {
        item('Insert column left', () => insertCol(col));
        item('Insert column right', () => insertCol(col + 1));
        item('Delete column ' + colName(col), () => deleteCol(col));
        item('Clear column', () => clearRange(0, col, data.rows - 1, col));
      } else {
        item('Insert row above', () => insertRow(row));
        item('Insert row below', () => insertRow(row + 1));
        item('Delete row ' + (row + 1), () => deleteRow(row));
        item('Clear row', () => clearRange(row, 0, row, data.cols - 1));
      }
      document.body.appendChild(menu);
      const rect = { left: e.clientX, top: e.clientY };
      menu.style.left = Math.min(rect.left, innerWidth - 180) + 'px';
      menu.style.top = Math.min(rect.top, innerHeight - 160) + 'px';
      setTimeout(() => {
        const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closer); } };
        document.addEventListener('mousedown', closer);
      }, 0);
    }

    function shiftKeys(fromCol, fromRow, dCol, dRow) {
      const next = {};
      for (const k of Object.keys(data.cells)) {
        const m = k.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        let c = colIdx(m[1]), r = +m[2] - 1;
        if (fromCol !== null && c >= fromCol) c += dCol;
        if (fromRow !== null && r >= fromRow) r += dRow;
        if (c < 0 || r < 0) continue;
        next[colName(c) + (r + 1)] = data.cells[k];
      }
      data.cells = next;
    }
    function insertCol(at) { shiftKeys(at, null, 1, 0); data.cols++; buildGrid(); changed(); }
    function deleteCol(at) { shiftKeys(at + 1, null, -1, 0); data.cols = Math.max(1, data.cols - 1); buildGrid(); changed(); }
    function insertRow(at) { shiftKeys(null, at, 0, 1); data.rows++; buildGrid(); changed(); }
    function deleteRow(at) { shiftKeys(null, at + 1, 0, -1); data.rows = Math.max(1, data.rows - 1); buildGrid(); changed(); }
    function clearRange(r1, c1, r2, c2) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) delete data.cells[key(r, c)];
      changed();
    }

    wrap.querySelector('[data-addrows]').addEventListener('click', () => { data.rows += 10; buildGrid(); updateInfo(); });
    wrap.querySelector('[data-addcols]').addEventListener('click', () => { data.cols += 10; buildGrid(); updateInfo(); });

    fxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const k = key(anchor.r, anchor.c);
        if (fxInput.value === '') delete data.cells[k];
        else data.cells[k] = fxInput.value;
        changed();
        wrap.focus();
        setSelection(anchor.r + 1, anchor.c);
      } else if (e.key === 'Escape') {
        fxInput.value = data.cells[key(anchor.r, anchor.c)] ?? '';
        wrap.focus();
      }
    });

    buildGrid();
    setSelection(0, 0);
    updateInfo();

    /* ----- import/export ----- */

    function importCsv(text) {
      const rows = parseCsv(text);
      data.cells = {};
      data.rows = Math.max(50, rows.length + 10);
      let maxC = 0;
      rows.forEach((row, r) => {
        row.forEach((v, c) => {
          if (v !== '') data.cells[key(r, c)] = v;
          if (c > maxC) maxC = c;
        });
      });
      data.cols = Math.max(20, maxC + 3);
      buildGrid();
      changed();
    }

    function importXlsx(buf) {
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      data.cells = {};
      data.rows = Math.max(50, grid.length + 10);
      let maxC = 0;
      grid.forEach((row, r) => {
        row.forEach((v, c) => {
          if (v !== '' && v !== null && v !== undefined) data.cells[key(r, c)] = String(v);
          if (c > maxC) maxC = c;
        });
      });
      data.cols = Math.max(20, maxC + 3);
      buildGrid();
      changed();
    }

    function exportXlsx() {
      const ws = {};
      const range = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
      let maxR = 0, maxC = 0;
      for (const k of Object.keys(data.cells)) {
        const m = k.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        const c = colIdx(m[1]), r = +m[2] - 1;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
        const raw = data.cells[k];
        const cell = {};
        if (typeof raw === 'string' && raw.startsWith('=')) {
          cell.f = raw.slice(1);
          const d = displayValue(raw);
          cell.v = F().isErr(d) ? d.text : (d.text === '' ? '' : Number(d.text) || d.text);
          if (typeof cell.v === 'string' && cell.v !== '') cell.t = 's';
        } else if (raw !== '' && !isNaN(raw) && typeof raw !== 'string') {
          cell.t = 'n'; cell.v = Number(raw);
        } else if (typeof raw === 'string' && raw !== '' && !isNaN(raw.trim()) && raw.trim() !== '') {
          cell.t = 'n'; cell.v = Number(raw);
        } else {
          cell.t = 's'; cell.v = String(raw);
        }
        ws[k] = cell;
      }
      range.e = { c: maxC, r: maxR };
      ws['!ref'] = XLSX.utils.encode_range(range);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, (doc.name || 'sheet') + '.xlsx');
    }

    return {
      destroy() { host.innerHTML = ''; },
      focus() { wrap.focus(); },
      importCsv,
      importXlsx,
      exportCsv() {
        let maxR = 0, maxC = 0;
        for (const k of Object.keys(data.cells)) {
          const m = k.match(/^([A-Z]+)(\d+)$/);
          if (!m) continue;
          maxR = Math.max(maxR, +m[2] - 1);
          maxC = Math.max(maxC, colIdx(m[1]));
        }
        OB.ui.download((doc.name || 'sheet') + '.csv', toCsv(data.cells, maxC, maxR), 'text/csv');
      },
      exportXlsx,
    };
  }

  OB.sheets = { create, parseCsv };
})();
