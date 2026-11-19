'use strict';
/* Whisker RAG — local chunking + embeddings via the loaded model + cosine retrieval. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  let store = []; // { text, embedding }
  let activeName = null;

  function chunkText(text, chunkWords = 400, overlap = 50) {
    const words = String(text).split(/\s+/).filter((w) => w.length > 0);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
      chunks.push(words.slice(i, i + chunkWords).join(' '));
      i += chunkWords - overlap;
    }
    return chunks;
  }

  async function extractPdfText(file) {
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return text;
  }

  async function extractText(file) {
    if (file.name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdfText(file);
    return file.text();
  }

  async function indexFile(file, onProgress) {
    const text = await extractText(file);
    const chunks = chunkText(text);
    store = [];
    for (let i = 0; i < chunks.length; i++) {
      const emb = await OB.engine.embed(chunks[i]);
      store.push({ text: chunks[i], embedding: emb });
      onProgress && onProgress(i + 1, chunks.length);
    }
    activeName = file.name;
    return { name: file.name, chunks: chunks.length };
  }
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  async function retrieve(query, topK = 3) {
    if (!store.length) return [];
    const q = await OB.engine.embed(query);
    const scored = store.map((s) => ({ text: s.text, score: cosine(q, s.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.text);
  }

  function clear() {
    store = [];
    activeName = null;
  }

  OB.rag = { indexFile, retrieve, clear, chunkText, get activeName() { return activeName; }, get chunks() { return store.length; } };
})();
