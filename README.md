# Oblivious

A toolkit of single-file apps built for privacy, usable on any device — a locked-down
Chromebook, a colleague's iPad, a friend's computer in another country. Each app is
one self-contained HTML file: no install, no account, no server, no build artifacts
to carry. Open it from a USB stick, from GitHub Pages, or anywhere else.

## Apps

| App | File | What it is |
| --- | --- | --- |
| **Core** | `dist/index.html` | iOS-style home screen + encrypt/decrypt tool. Any file(s) → one password-encrypted `.obv` container, and back. Also manages encrypted data saved on the device. |
| **Pocketknife** | `dist/pocketknife.html` | Google-Workspace-style editor: Docs (rich text), Sheets (formulas, real `.xlsx`), Slides (present mode, PDF export). Every export is offered as a normal file **or** encrypted `.obv`. |
| **Whisker** | `dist/whisker.html` | Claude-style local AI chat. Bring your own `.gguf` model (stored on-device in IndexedDB, click-load afterwards). Local RAG on txt/pdf, Artifacts panel (view + create/edit), Projects, voice input, optional BYO-endpoint online mode. The inference engine (wllama 3.13 + WASM, ~4 MB) is embedded in the file — it runs fully offline, including from `file://` on a USB stick. |
| **Wire** | `dist/wire.html` | Spotify-style music player. Local audio files + optional audio-only online streaming (Piped), OS-level media controls (MediaSession), synced lyrics (LRCLIB). |

## How it works

**RAM-only sessions, encrypted exports.**

- While you work, data lives only in JavaScript memory. Nothing is written to disk
  by default, so a borrowed machine keeps nothing.
- Persistence happens through `.obv` files: a password derives an AES-256-GCM key
  via PBKDF2-SHA256 (600,000 iterations), and the file is pure ciphertext — carry it
  on a USB stick, through email, through cloud storage; it's inert without the password.
- Apps can optionally keep an **encrypted copy on the device** (IndexedDB). It is the
  same ciphertext as the export files, unlocked by password per session.
- Lock (or triple-Esc / Ctrl+Shift+Esc in Whisker) wipes session memory. Closing the
  tab does too.
- Whisker's model library is the one deliberate exception: GGUF models are public
  binaries, so they're stored unencrypted to avoid re-hundreds-of-MBs of pointless
  crypto. They contain none of your data.

### The `.obv` container format (v1)

```
"OBLV" | version | kdf-id | cipher-id | iterations(u32) | salt(16) | IV(12) | metaLen(u32) | ciphertext
```

Ciphertext = AES-256-GCM over `metadata-JSON || payload`, with the 43-byte header
as additional authenticated data. Any tampering — including edits to the iteration
count or salt — fails authentication. Wrong password = `BAD_PASSWORD`. The format is
versioned so stronger KDFs (e.g. Argon2) can be added later without breaking old files.
All apps share this one format; a Pocketknife library and a Wire vault unlock the
same way, and Core can manage all of them.

## Threat model — honest version

**This protects against:**

- Data at rest: stolen/lost USB sticks, cloud storage snooping, confiscated devices —
  everything is ciphertext without the password.
- Data left behind: sessions leave no plaintext traces on borrowed machines (with
  the caveats below).
- Host blindness: GitHub Pages (or any static host) serves opaque bytes; it never
  sees plaintext.
- Tampering: GCM authentication means modified files won't decrypt.

**This does NOT protect against:**

- A compromised operating system: a keylogger sees your password as you type it.
  On truly hostile machines, prefer one-time passwords and rotate secrets.
- Shoulder-surfing, screen recorders, browser extensions on the borrowed browser.
- Memory forensics on a running session: data is in RAM by necessity, and JS strings
  can't be cryptographically wiped. Lock when done; closing the tab helps.
- Browser cache of the Whisker wllama runtime (jsDelivr) on first use online.
- Online features are only as private as their endpoints: Whisker's online mode sends
  prompts to the endpoint you configure; Wire's streaming is visible to the Piped
  instance; LRCLIB sees lyric lookups. All of these are off/unloaded by default.

## Usage notes

- Everything works offline from `file://`, including Whisker's inference engine
  (embedded in the file). One caveat on `file://` in Chrome: IndexedDB is
  blocked, so Whisker's model library and the apps' encrypted device-storage
  are session-only there — export `.obv` files instead. Over GitHub Pages or
  any http host, everything persists.
- Pocketknife is the only other heavy file (~1.3 MB) because real `.xlsx`
  support (SheetJS, Apache-2.0) and embedded fonts (Georgia/Calibri twins,
  Roboto, Orbitron) are inlined.
- Lost password = lost data. There is no recovery, by design.

## Building

```
npm test        # crypto + container + formula engine tests
npm run build   # writes dist/*.html (zero dependencies)
npm run watch   # rebuild on change
```

Source lives in `src/`: shared core (`crypto`, tar bundler, session store, encrypted
persistence, UI helpers, theme) and one folder per app. The build script inlines
everything into single self-contained files. Deploy by pointing GitHub Pages (or any
static host) at `dist/`, or just copy the files to a USB stick.

## License notes

- SheetJS (Apache-2.0), wllama (MIT), PDF.js (BSD-2) are inlined at build time.
- UI patterns are inspired by iOS, Google Workspace, Claude, Spotify and Monochrome;
  no brand assets, fonts, or code are copied.
