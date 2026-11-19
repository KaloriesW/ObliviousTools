'use strict';
/* Whisker markdown renderer — from scratch, escapes HTML first. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function inline(t) {
    return t
      .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function render(md) {
    const src = String(md || '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    let out = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
        i++;
        const code = esc(buf.join('\n'));
        out += '<div class="md-codeblock"><div class="md-code-head"><span>' + esc(lang || 'text') +
          '</span><button class="md-copy" type="button">copy</button></div>' +
          '<pre><code>' + code + '</code></pre></div>';
        continue;
      }

      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        const h = m[1].length;
        out += '<h' + h + '>' + inline(esc(m[2])) + '</h' + h + '>';
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out += '<hr>'; i++; continue; }
      if ((m = line.match(/^>\s?(.*)$/))) {
        const buf = [];
        while (i < lines.length && (m = lines[i].match(/^>\s?(.*)$/))) { buf.push(m[1]); i++; }
        out += '<blockquote>' + inline(esc(buf.join(' '))) + '</blockquote>';
        continue;
      }
      if (line.includes('|') && lines[i + 1] && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const header = line.split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          const cells = lines[i].split('|').map((c) => c.trim());
          if (cells[0] === '') cells.shift();
          if (cells[cells.length - 1] === '') cells.pop();
          rows.push(cells);
          i++;
        }
        out += '<table><thead><tr>' + header.map((h) => '<th>' + inline(esc(h)) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        continue;
      }
      if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        const ordered = /^\d+\./.test(line);
        const items = [];
        while (i < lines.length && (/^[-*+]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i]))) {
          items.push(lines[i].replace(/^([-*+]|\d+\.)\s+/, ''));
          i++;
        }
        out += '<' + (ordered ? 'ol' : 'ul') + '>' + items.map((t) => '<li>' + inline(esc(t)) + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>';
        continue;
      }
      if (line.trim() === '') { out += '<br>'; i++; continue; }

      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^([#>-]|\d+\.|[-*+]\s|```)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out += '<p>' + inline(esc(para.join(' '))) + '</p>';
      else i++;
    }
    return out;
  }

  OB.md = { render, esc };
})();
