'use strict';
/* Whisker artifacts — sandboxed live previews + create/edit mode. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});
  let panel = null;
  let current = null; // {type, title, content}

  const TYPES = ['html', 'svg', 'markdown', 'text'];

  function isOpen() { return !!panel; }

  function close() {
    if (panel) {
      panel.remove();
      panel = null;
    }
    document.body.classList.remove('wh-artifacts-open');
  }

  function titleOf(code) {
    const m = code.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : 'Untitled';
  }

  function guessType(code, langLabel) {
    if (langLabel === 'html' || /<(html|body|div|section|script)\b/i.test(code)) return 'html';
    if (langLabel === 'svg' || /<svg\b/i.test(code)) return 'svg';
    if (langLabel === 'markdown' || langLabel === 'md') return 'markdown';
    return 'html';
  }

  function previewNode(type, content) {
    if (type === 'html' || type === 'svg') {
      const frame = document.createElement('iframe');
      frame.className = 'wh-artifact-frame';
      frame.setAttribute('sandbox', 'allow-scripts allow-modals');
      const doc = type === 'svg'
        ? '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh">' + content + '</body></html>'
        : content;
      frame.srcdoc = doc;
      return frame;
    }
    if (type === 'markdown') {
      const div = document.createElement('div');
      div.className = 'wh-artifact-md';
      div.innerHTML = OB.md.render(content);
      return div;
    }
    const pre = document.createElement('pre');
    pre.className = 'wh-artifact-plain ob-mono';
    pre.textContent = content;
    return pre;
  }

  function open(code, opts = {}) {
    current = { type: opts.type || guessType(code, opts.lang || ''), title: opts.title || titleOf(code), content: code };
    render(false);
  }

  function create() {
    current = { type: 'html', title: 'New artifact', content: '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>New artifact</title>\n  <style>\n    body { font-family: system-ui, sans-serif; padding: 32px; }\n  </style>\n</head>\n<body>\n  <h1>Hello 👋</h1>\n  <p>Edit me on the left, preview updates live.</p>\n</body>\n</html>' };
    render(true);
  }

  function render(editMode) {
    close();
    panel = document.createElement('aside');
    panel.className = 'wh-artifact-panel' + (editMode ? ' wh-artifact-editing' : '');
    panel.innerHTML =
      '<div class="wh-artifact-head">' +
      '<input class="ob-input wh-artifact-title-in" title="Artifact title">' +
      '<select class="ob-select wh-artifact-type" title="Type">' +
      TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('') +
      '</select>' +
      '<button class="ob-btn ghost sm" data-a="edit" title="Edit source">✏</button>' +
      '<button class="ob-btn ghost sm" data-a="refresh" title="Refresh preview">↻</button>' +
      '<button class="ob-btn ghost sm" data-a="copy" title="Copy source">⧉</button>' +
      '<button class="ob-btn ghost sm" data-a="dl" title="Download file">⇩</button>' +
      '<button class="ob-btn ghost sm" data-a="tab" title="Open in new tab">↗</button>' +
      '<button class="ob-btn ghost sm" data-a="light" title="Toggle background">◐</button>' +
      '<button class="ob-btn ghost sm" data-a="close" title="Close">✕</button>' +
      '</div>' +
      '<div class="wh-artifact-body">' +
      '<div class="wh-artifact-editor ob-hidden">' +
      '<textarea class="ob-textarea wh-artifact-src ob-mono" spellcheck="false"></textarea>' +
      '<div class="wh-artifact-editor-foot">' +
      '<span class="ob-faint" style="font-size:11.5px">live preview updates as you type</span>' +
      '<button class="ob-btn sm primary" data-a="done">Done editing</button>' +
      '</div></div>' +
      '<div class="wh-artifact-view"></div>' +
      '</div>';

    const titleIn = panel.querySelector('.wh-artifact-title-in');
    const typeSel = panel.querySelector('.wh-artifact-type');
    const srcTa = panel.querySelector('.wh-artifact-src');
    const view = panel.querySelector('.wh-artifact-view');
    const editor = panel.querySelector('.wh-artifact-editor');

    titleIn.value = current.title;
    typeSel.value = current.type;
    srcTa.value = current.content;

    let debounce = null;
    const syncPreview = () => {
      current.content = srcTa.value;
      view.innerHTML = '';
      view.appendChild(previewNode(current.type, current.content));
    };
    srcTa.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(syncPreview, 400);
    });
    titleIn.addEventListener('input', () => { current.title = titleIn.value; });
    typeSel.addEventListener('change', () => { current.type = typeSel.value; syncPreview(); });

    const setMode = (editing) => {
      editor.classList.toggle('ob-hidden', !editing);
      view.classList.toggle('ob-hidden', editing);
      panel.classList.toggle('wh-artifact-editing', editing);
      if (editing) srcTa.focus();
      else syncPreview();
    };
    panel.querySelector('[data-a=edit]').addEventListener('click', () => setMode(true));
    panel.querySelector('[data-a=done]').addEventListener('click', () => setMode(false));
    panel.querySelector('[data-a=refresh]').addEventListener('click', syncPreview);
    panel.querySelector('[data-a=close]').addEventListener('click', close);
    panel.querySelector('[data-a=copy]').addEventListener('click', () => OB.ui.copy(current.content, { toastMsg: 'Source copied' }));
    panel.querySelector('[data-a=light]').addEventListener('click', () => panel.classList.toggle('wh-artifact-dark'));
    panel.querySelector('[data-a=dl]').addEventListener('click', () => {
      const ext = current.type === 'markdown' ? 'md' : current.type === 'text' ? 'txt' : current.type;
      OB.ui.download((current.title || 'artifact').replace(/[^\w\- ]+/g, '_') + '.' + ext, current.content,
        current.type === 'html' || current.type === 'svg' ? 'text/html' : 'text/plain');
    });
    panel.querySelector('[data-a=tab]').addEventListener('click', () => {
      const isFullDoc = current.type === 'html';
      const html = isFullDoc ? current.content : '<pre style="white-space:pre-wrap;font-family:ui-monospace;padding:24px">' +
        OB.ui.esc(current.content) + '</pre>';
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });

    document.body.appendChild(panel);
    document.body.classList.add('wh-artifacts-open');
    if (editMode) setMode(true);
    else syncPreview();
  }

  /* Scan a finished assistant message element for html/svg code blocks and badge them. */
  function scanMessage(el) {
    el.querySelectorAll('.md-codeblock').forEach((block) => {
      if (block.dataset.artifact) return;
      const code = block.querySelector('code');
      const text = code ? code.textContent : '';
      const lang = block.querySelector('.md-code-head span')?.textContent || '';
      const type = guessType(text, lang);
      const eligible = (type === 'html' || type === 'svg') && text.split('\n').length >= 6;
      if (!eligible) return;
      block.dataset.artifact = '1';
      const btn = document.createElement('button');
      btn.className = 'ob-btn sm primary wh-artifact-btn';
      btn.textContent = '▷ View artifact';
      btn.addEventListener('click', () => open(text, { lang }));
      block.appendChild(btn);
    });
  }

  OB.artifacts = { open, create, close, scanMessage, isOpen };
})();
