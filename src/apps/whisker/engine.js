'use strict';
/* Whisker LLM engine — wllama 3.x vendored into the page (ESM source string +
   gzip'd wasm), loaded via blob URLs so it runs on file:// with zero network.
   Native jinja chat templating; GPU-first with CPU fallback. */
(function () {
  const OB = (globalThis.OB = globalThis.OB || {});

  let mod = null;
  let wasmUrl = null;
  let inst = null;
  let loadedName = null;
  let aborter = null;

  async function boot() {
    if (mod) return;
    const bytes = Uint8Array.from(atob(window.__WLLAMA_WASM_GZ), (c) => c.charCodeAt(0));
    const gz = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const wasmBuf = await new Response(gz).arrayBuffer();
    wasmUrl = URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' }));
    mod = await import(URL.createObjectURL(new Blob([window.__WLLAMA_SRC], { type: 'text/javascript' })));
  }

  function noopManager() {
    return new Proxy({}, { get: () => async () => { throw new Error('disabled'); } });
  }

  function makeEngine() {
    const w = new mod.Wllama(
      { default: wasmUrl },
      {
        suppressNativeLog: true,
        cacheManager: noopManager(),
        modelManager: noopManager(),
      }
    );
    try { w.setCompat(null); } catch (_) { /* optional */ }
    return w;
  }

  function threads() {
    return (navigator.hardwareConcurrency || 2) > 2 ? Math.min(4, navigator.hardwareConcurrency) : 1;
  }

  async function dispose() {
    if (inst) {
      try { await inst.exit(); } catch (_) { /* best effort */ }
    }
    inst = null;
    loadedName = null;
  }

  async function gpuAvailable() {
    if (!navigator.gpu) return false;
    try {
      const adapter = await Promise.race([
        navigator.gpu.requestAdapter(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('adapter timeout')), 3000)),
      ]);
      return !!adapter;
    } catch (_) {
      return false;
    }
  }

  async function loadModel(record, onProgress) {
    await dispose();
    await boot();
    const base = {
      n_ctx: 2048,
      n_threads: threads(),
      jinja: true,
      embeddings: true,
    };
    const attempt = async (gpu) => {
      const w = makeEngine();
      const params = Object.assign({}, base);
      params.n_gpu_layers = gpu ? 999 : 0;
      const load = w.loadModel(record.parts, params);
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 180000));
      try {
        await Promise.race([load, timeout]);
      } catch (e) {
        try { await w.exit(); } catch (_) { /* ignore */ }
        throw e;
      }
      return w;
    };
    const useGpu = await gpuAvailable();
    try {
      inst = await attempt(useGpu);
    } catch (e) {
      if (useGpu && e.message !== 'TIMEOUT') {
        inst = await attempt(false);
      } else if (useGpu) {
        /* GPU attempt timed out — still try CPU before giving up */
        inst = await attempt(false);
      } else {
        throw e;
      }
    }
    loadedName = record.name;
    onProgress && onProgress(1);
    let metaName = '';
    try { metaName = inst.getModelMetadata().meta['general.name'] || ''; } catch (_) { /* optional */ }
    return { name: record.name, metaName, template: 'jinja' };
  }

  async function unload() {
    await dispose();
  }

  function abort() {
    if (aborter) {
      try { aborter.abort(); } catch (_) { /* ignore */ }
    }
  }

  /**
   * Stream a chat completion. history: [{role, content}]
   * @returns {Promise<string>} full generated text
   */
  async function complete(history, { system, temperature = 0.7, nPredict = 512, onToken }) {
    if (!inst || !loadedName) throw new Error('NO_MODEL');
    const messages = [{ role: 'system', content: system }].concat(history.slice(-12));
    aborter = new AbortController();
    let full = '';
    await inst.createChatCompletion({
      messages,
      max_tokens: nPredict,
      temperature,
      stream: true,
      abortSignal: aborter.signal,
      onData: (chunk) => {
        const piece = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || '';
        if (piece) {
          full += piece;
          onToken && onToken(full);
        }
      },
    });
    return full;
  }

  /* embeddings for RAG — model is loaded with embeddings: true */
  async function embed(text) {
    if (!inst || !loadedName) throw new Error('NO_MODEL');
    const res = await inst.createEmbedding({ input: text });
    return res.data[0].embedding;
  }

  OB.engine = {
    boot,
    loadModel,
    unload,
    complete,
    abort,
    embed,
    get loadedName() { return loadedName; },
    get isLoaded() { return !!loadedName; },
  };
})();
