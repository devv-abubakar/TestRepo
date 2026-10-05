# VU Handouts AI Highlighter

Turn your VU handouts into focused exam-revision material with AI-assisted highlighting.

A single-page web application that reads a folder of Virtual University handouts, asks an AI
model which passages genuinely matter for exams, and writes a **separate** highlighted PDF for
each one — with true yellow highlight annotations, a clickable VU Students Guide link, and the
bookshop WhatsApp contact.

Everything runs in the browser. PDFs are never uploaded anywhere; only the extracted text of the
handout being processed is sent to the AI provider you choose.

Built for Google Gemini's free tier, where quotas are counted **per cloud project**: add a key from
each project and the app rotates them, so their limits add up and several parts of your handouts are
analysed at the same time.

---

## Table of contents

- [What it does](#what-it-does)
- [The API key pool](#the-api-key-pool)
- [Highlighting accuracy](#highlighting-accuracy)
- [Installation](#installation)
- [Local development](#local-development)
- [Production deployment](#production-deployment)
- [Environment variables](#environment-variables)
- [AI API configuration](#ai-api-configuration)
- [Browser compatibility](#browser-compatibility)
- [Security notes](#security-notes)
- [Privacy](#privacy)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Testing and acceptance results](#testing-and-acceptance-results)
- [Known limitations](#known-limitations)

---

## What it does

```
Select root folder → detect course folders → detect handouts → build queue
   → extract PDF text (OCR if the handout is a scan)
   → split into page-aligned parts and analyse them in parallel across your API keys
   → receive exact-text spans as structured JSON
   → validate the response, reject anything not in the source
   → match each span to real page coordinates
   → write yellow highlight annotations
   → add the AI study message and VU Students Guide link
   → add the WhatsApp contact to the existing bookshop line
   → validate the output PDF
   → save beside the original (or offer a download)
   → release memory, process the next handout
```

Features:

- **Folder batch processing.** Point it at `All Handouts/`; it finds the course folders, the PDFs
  inside them (including sub-folders), and builds a queue. Counts of courses, handouts, completed,
  failed and skipped are shown live.
- **Live, detailed progress.** For every handout in flight you see the course, the file, the page
  being read (`page 8 / 18`), the analysis part (`part 3/5`), which API key is handling it, and how
  long it has been running. Every number comes from queue state — there is no simulated progress.
- **A pool of API keys.** Several keys are rotated, rate-limited keys step aside automatically, and
  the activity table shows what each key is doing right now. See [the next section](#the-api-key-pool).
- **Controlled concurrency.** 1–6 handouts in flight, configurable, with a separate ceiling on
  concurrent AI requests. One document is loaded, used and released at a time, so a 300-handout
  batch stays within browser memory.
- **Resume.** Processing state is checkpointed to IndexedDB after every handout. Close the tab,
  lose the connection, restart the laptop — reopen the app and it offers to resume, skipping what
  is already done.
- **Skip existing outputs.** A handout with an existing `*_AI_Highlighted.pdf` is skipped unless you
  tick *Re-process existing outputs*.
- **Retry failed.** Failures are isolated per handout and listed separately with a retry button.
- **Stop safely.** *Stop Processing* finishes nothing half-way: the in-flight handout returns to
  pending, completed outputs are kept.
- **Output.** Written straight back into the course folder when the browser supports it, and always
  available as an individual download, an in-browser preview, or one ZIP that preserves the course
  folder structure.
- **Originals are never touched.** The input file is opened read-only and every consumer gets its
  own copy of the bytes. Output is always a new file.

---

## The API key pool

Gemini's free tier is metered per cloud project. One key gives you roughly 15–30 requests per
minute and about 1,000–1,500 per day; **ten keys from ten projects give you ten times that**, and
the app is built to use them together.

Add as many keys as you like in **Settings → AI Configuration**, each with its own label
("Project A", "Spare", whatever helps you recognise it in the log).

How the pool behaves:

- **Round-robin by least-recently-used**, so load is spread evenly instead of hammering key 1.
- **One request in flight per key**, which keeps the per-minute accounting honest.
- **Per-key request spacing** from the *Requests per minute, per key* setting (default 15).
- **Parallel analysis.** A handout is split into parts, and the parts are analysed concurrently up
  to *Max parallel AI requests* (default 4) — never more than the number of usable keys.
- **Automatic failover.** A rate-limited key is rested with an exponential cooldown (20s → 45s →
  90s → 3m → 5m) and the work moves to another key immediately. A key the provider rejects is
  disabled for the session. A chunk is retried on up to five different keys before the handout fails.
- **Daily budgets.** Each key's usage is counted against *Daily requests, per key* (default 1,000)
  and remembered across reloads, so a refresh does not forget that a key is nearly spent. A key that
  reaches its budget is parked until the quota resets at UTC midnight.
- **Honest failure.** When every key is spent or invalid the batch stops with a clear message rather
  than hanging until midnight. Completed handouts are kept, and *Resume* picks up the rest later.

The **API Key Activity** table shows, live: each key's state (Ready / Working / Resting *n*s /
Quota used / Disabled), what it is working on, usage against its daily budget, and its success,
failure and rate-limit counts. Every log line that belongs to a key is tagged with that key's label:

```
11:04:18  Project A   analyzing pages 5-8 (part 2/5)
11:04:19  Project B   analyzing pages 9-12 (part 3/5)
11:04:23  Project A   pages 5-8 done (part 2/5) — 4 candidate(s) in 3.9s
11:04:24  Project C   rate limited — resting 20s, work moved to another key
11:04:31              CS101/Handout 07.pdf — COMPLETE: 18 highlight(s) across 18 page(s) in 24.6s
```

Key values are never written to the log, the console, or an error message — only labels.

---

## Highlighting accuracy

This is the part the application is actually judged on, so it is worth describing precisely.

**The model never draws anything.** It returns verbatim spans of text. The application then locates
each span in the text it extracted itself and highlights those coordinates. A span the application
cannot find in the source is discarded, which is what makes invented or paraphrased text harmless.

The matching pipeline:

1. Both the page text and the model's span go through the same normalisation — Unicode folding,
   ligatures, smart quotes, dashes, zero-width characters, collapsed whitespace, and rejoining
   words that a line break split with a hyphen.
2. An exact substring match is tried first, across every page.
3. Failing that, a scored fuzzy search runs: anchor tokens locate candidate windows, and a bounded
   edit-distance similarity picks the best one. **Anything below the confidence floor (default 90%)
   is logged, never highlighted.**
4. A span that straddles a page or column break — where no single page holds it — is matched
   sentence by sentence instead, so each highlighted fragment is still verbatim source text.
5. Match boundaries are snapped outwards to whole words, so a highlight never starts mid-word.
6. Matched character ranges are converted back to rectangles through a character-level map built
   during extraction, then merged per visual line.

Guards against over-highlighting:

| Guard | Default | What it does |
| --- | --- | --- |
| Prompt discipline | ~1–4 per page | The model is told to be selective and is given an explicit per-chunk ceiling. |
| Minimum importance | `medium` | Low-importance spans are dropped. |
| Maximum per page | 6 | Hard cap, highest-importance spans first. |
| Page coverage ceiling | 32% | Highlights may not cover more than this share of a page's characters. A sparse page is always allowed at least one highlight. |
| Duplicate detection | 70% overlap | Two spans resolving to the same range count once. |
| Minimum quote length | 14 characters | Shorter quotes cannot be matched safely and are refused. |

Highlights are written as **real PDF `/Highlight` annotations** with an explicit appearance stream
using the `Multiply` blend mode — so the mark is a genuine highlight (selectable, printable,
editable in a PDF reader) rather than an opaque box, and the text underneath stays readable. This
is verified by sampling rendered pixels in the test suite.

---

## Installation

Requirements: **Node.js 20.19+ or 22.12+** and npm.

```bash
git clone <your-repo-url>
cd vu-handouts-ai-highlighter
npm install
```

The install pulls in `pdfjs-dist` (extraction and rendering), `pdf-lib` (annotation writing),
`tesseract.js` (OCR), `fflate` (ZIP), `idb` (IndexedDB) and React + Vite + Tailwind.

`@tesseract.js-data/eng` (~14 MB) is an **optional** dev dependency holding the English OCR model.
With it installed the model is served from your own origin, so OCR works offline and no document
page ever reaches a third party. Remove it and the app falls back to the public tessdata host.

---

## Local development

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run lint         # TypeScript project-wide type check (strict, no `any`)
npm test             # 51 unit tests (text folding, matching, prompts, AI parsing)
npm run test:e2e     # browser acceptance suite in Chromium
npm run build        # type check + production build into dist/
npm run preview      # serve the production build locally
```

The acceptance harness is also available interactively at **`/selftest.html`** in dev mode. It
builds synthetic handouts and runs the real pipeline against them in your browser.

---

## Production deployment

The build output in `dist/` is a static site. Any static host works — Vercel, Netlify,
Cloudflare Pages, GitHub Pages, nginx.

```bash
npm run build
# deploy ./dist
```

**HTTPS is required.** The File System Access API, clipboard access and service-worker-style
features only work on a secure origin (`localhost` is treated as secure for development).

Deploying under a sub-path is supported — build with `--base`, e.g.
`npm run build -- --base=/highlighter/`. Runtime data files (pdf.js fonts and CMaps, the OCR
worker and core) are resolved from `import.meta.env.BASE_URL` and ship with the bundle, so no CDN
is involved.

### Optional: the AI proxy

To avoid every student pasting their own key, deploy `api/ai-proxy.ts` as a serverless function and
select **Secure backend proxy** in the app's AI settings. The handler is written against the
standard `Request`/`Response` API and runs unchanged on Vercel (Edge or Node), Netlify Functions
v2, Cloudflare Workers and Deno Deploy. On Vercel Edge add `export const config = { runtime: 'edge' }`.

The browser then posts `{model, system, user, temperature, maxTokens}` and receives `{text}`; the
provider key stays server-side.

---

## Environment variables

Nothing is required to run the app — AI configuration is entered in the UI.

**Build-time (frontend, `VITE_` prefix):**

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_TESSERACT_LANG_PATH` | local copy if `@tesseract.js-data/eng` is installed, otherwise `https://tessdata.projectnaptha.com/4.0.0` | Base URL for the OCR language model. Set it to a self-hosted path to keep OCR fully offline. |

**Server-side (only for `api/ai-proxy.ts`):**

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | no (default `anthropic`) | `anthropic`, `openai` or `gemini`. |
| `ANTHROPIC_API_KEY` | when provider is `anthropic` | Provider key. Never exposed to the browser. |
| `OPENAI_API_KEY` | when provider is `openai` | Provider key. |
| `GEMINI_API_KEY` | when provider is `gemini` | Provider key. |
| `AI_ALLOWED_ORIGIN` | no (default `*`) | Restrict CORS to your deployed origin. |
| `AI_MODEL_ALLOWLIST` | no | Comma-separated model ids the proxy will accept. |

> Never commit a `.env` file containing a provider key. `.env*` is git-ignored.

---

## AI API configuration

Open **Settings → AI Configuration**.

| Provider | Key format | Where to get one | Browser-direct |
| --- | --- | --- | --- |
| **Google Gemini** (default) | AI Studio key | <https://aistudio.google.com/app/apikey> | yes |
| Anthropic (Claude) | `sk-ant-…` | <https://console.anthropic.com/settings/keys> | yes |
| OpenAI | `sk-…` | <https://platform.openai.com/api-keys> | yes |
| Secure backend proxy | none in the browser | your own deployment | no |

Defaults are Gemini with **`gemini-3.1-flash-lite`** — fast and generous on the free tier, which is
what makes a 300-handout batch practical.

- **Model** is a free-text field with suggestions, so any model your keys can reach works.
- **Temperature** defaults to `0.1`. Keep it low: verbatim quoting needs a literal model.
- **Test Connection** performs a real round-trip **for every key in the pool** and reports each one
  separately, so one bad key out of ten is found before the batch starts rather than during it.
- **Requests per handout:** one per ~12,000 characters of extracted text. A 20-page handout is
  typically 2–4 requests, so ~300 handouts is roughly 700–1,200 requests in total — within a couple
  of free-tier projects' daily budgets.

Pool settings, all per key:

| Setting | Default | Notes |
| --- | --- | --- |
| Requests per minute, per key | 15 | Set it to your plan's limit. 0 removes the spacing. |
| Daily requests, per key | 1000 | A key that reaches this is parked until the quota resets. 0 removes the budget. |
| Max parallel AI requests | 4 | Across the whole pool. Never exceeds the number of usable keys. |
| Documents at a time | 2 | Handouts processed in parallel, 1–6. Memory, not quota, is the limit here. |

Adding another provider means adding one object to `src/services/ai/providers.ts` — endpoint, auth
header, request body and where the text sits in the response. Nothing else changes.

---

## Browser compatibility

| Browser | Folder reading | Writing output into the course folder | Notes |
| --- | --- | --- | --- |
| Chrome / Edge (desktop) 86+ | File System Access API | **yes** | Recommended. Full experience. |
| Opera (desktop) | File System Access API | yes | |
| Firefox | `webkitdirectory` fallback | no — downloads and ZIP | Reading and processing are identical. |
| Safari (desktop) | `webkitdirectory` fallback | no — downloads and ZIP | |
| Mobile browsers | limited | no | A notice recommends a desktop browser for large batches. |

The app detects support at runtime, shows the appropriate notice, and offers the fallback picker
alongside the primary button. Nothing is read before you pick a folder and grant permission.

---

## Security notes

- **No API key in the source, the repository, or the logs.** Keys live in React state, are masked
  in the UI, and are written to `localStorage` only if you explicitly tick *Remember these keys*
  (off by default). No log line, error message or key-status record ever contains a key value —
  only its label. This is covered by a test that serialises the pool's state and asserts the secret
  is absent.
- **Settings persistence strips key values.** Only labels, ids and enabled flags go into the
  settings blob; values are stored separately and removed the moment you untick the option.
- **BYOK mode is clearly labelled.** The UI states that keys go from your browser straight to the
  provider and that anyone with access to the browser profile could read remembered keys, and
  points to the proxy for shared or public deployments.
- **The proxy keeps secrets server-side**, caps body size, clamps `maxTokens`, supports a model
  allowlist and an explicit CORS origin, and never echoes the key in an error.
- **Local files require explicit permission.** A user-initiated folder pick, then the browser's own
  read/write permission prompt. Permission is re-checked when a stored handle is reused for a resume.
- **File validation.** Only `.pdf` files are queued; anything else in the folder is ignored.
- **Sandboxed PDF handling.** pdf.js runs in a Web Worker with `isEvalSupported: false`, so document
  content cannot execute script in the page. Font and CMap data are served from the app's own
  origin rather than a CDN.
- **HTTPS required in production**, as noted above.

---

## Privacy

> Your files are processed locally where possible. Content sent to an AI provider is subject to that
> provider's API/data policies.

- Handout PDFs are **never uploaded**. Parsing, highlighting, annotation and PDF generation all
  happen in the browser.
- Only the **extracted text** of the handout currently being processed is sent to the provider, in
  chunks, with the course code and file name for context.
- OCR runs locally. With the optional language-data package installed, OCR involves no network at all.
- Generated outputs are cached in IndexedDB on your own machine so downloads and ZIPs survive a
  reload. *Start Over* deletes them.
- The app has no analytics, no telemetry and no backend of its own unless you deploy the optional proxy.

---

## Architecture

```
Browser (single page)
  │
  ├── SPA UI ................. React 18 + TypeScript (strict) + Tailwind
  ├── State .................. Zustand store, real queue state
  ├── Folder access .......... File System Access API, webkitdirectory fallback
  ├── PDF extraction ......... pdf.js — text + per-run coordinates
  ├── OCR fallback ........... tesseract.js — word boxes mapped to PDF space
  ├── Processing queue ....... bounded concurrency, per-job isolation
  ├── AI analysis ............ provider abstraction, chunking, strict JSON validation
  ├── API key pool ........... rotation, per-key rate limits, daily budgets, failover
  ├── Text matching .......... normalisation, exact → scored fuzzy, confidence floor
  ├── PDF highlighting ....... pdf-lib — /Highlight annotations + appearance streams
  ├── Link injection ......... /Link annotations with URI actions
  ├── Validation ............. re-open, compare, verify before marking completed
  ├── Persistence ............ IndexedDB (state + outputs), localStorage (settings)
  └── Download / local save .. folder write, individual download, streaming ZIP
```

With the optional proxy:

```
Browser ──(extracted text only)──▶ Secure API proxy ──▶ AI provider
                                   (holds the key)
```

**Safe placement of added content.** The footer is only drawn into a strip measured as genuinely
blank, and the WhatsApp contact is only appended to the bookshop line when the rest of that line is
verifiably clear. Blankness is determined by rasterising the page and looking for empty pixel rows,
which catches text, images, diagrams, tables and rules alike. When there is not enough room, the
information block gets its own final page — original content is never moved, cropped or covered.

**Output validation** re-opens every generated file and checks that it opens, that the page count is
right, that the original text is byte-for-byte present once the added fragments are subtracted, that
nothing was drawn over existing content, that the highlight annotations are there, and that both
links are present with the exact expected URLs. A handout is marked *Completed* only if all of that
passes; otherwise it is marked *Failed* with the reason.

---

## Project structure

```
src/
├── components/            # Header, ApiSettings, FolderSelector, Dashboard,
│                          # CourseList, HandoutTable, ProgressPanel,
│                          # KeyActivityPanel, LogPanel, PdfPreview,
│                          # ResultsPanel, SettingsPanel, Notices, ui
├── services/
│   ├── ai/                # provider abstraction, key pool, prompt, chunking,
│   │                      # parallel orchestration, JSON validation
│   ├── pdf/               # pdfjs setup, extract, geometry, match, annotations,
│   │                      # decorate, whitespace, render, process (the pipeline)
│   ├── ocr/               # scanned-handout fallback
│   ├── filesystem/        # directory picker + webkitdirectory fallback
│   ├── zip/               # streaming ZIP, downloads
│   ├── validation/        # output verification
│   └── persist/           # IndexedDB state and outputs, settings
├── store/                 # Zustand store, batch runner, defaults
├── utils/                 # text normalisation and similarity
├── types/                 # Course, Handout, Highlight, AiResponse, ... (no `any`)
├── selftest/              # acceptance harness and synthetic fixtures (dev only)
├── constants.ts           # fixed copy, links, defaults
└── App.tsx
api/ai-proxy.ts            # optional serverless proxy
tests/unit/                # vitest
tests/e2e/                 # Playwright
```

TypeScript runs with `strict`, `noUnusedLocals`, `noUnusedParameters` and
`noUncheckedIndexedAccess`. There is no `any` in `src/`.

---

## Testing and acceptance results

```
npm test         →  7 files, 76 tests passed
npm run test:e2e →  6 tests passed (8 pipeline scenarios + UI, folder scanning, key pool)
npm run lint     →  clean
npm run build    →  clean
```

The browser suite runs the **real pipeline** — real PDF bytes, real extraction, real coordinate
matching, real annotation writing, real validation. Only the provider call is substituted, with
spans taken verbatim from the extracted text, plus one invented span that must be rejected and one
with mangled whitespace and a line-break hyphen that must still match.

| # | Acceptance test | Result |
| --- | --- | --- |
| 1 | Folder with multiple course folders → all courses detected | **Pass** — 3 courses, 6 handouts detected from a real folder tree |
| 2 | Course with several PDFs → all detected | **Pass** — non-PDFs and existing outputs correctly excluded |
| 3 | Process one PDF → AI highlights important text | **Pass** — 3 spans matched, 1 invented span rejected |
| 4 | Original unchanged | **Pass** — input bytes compared before and after |
| 5 | Output opens | **Pass** — re-opened and re-parsed by the validator |
| 6 | Important text accurately highlighted in yellow | **Pass** — 71% of sampled pixels inside the highlight are yellow; dark text pixels remain, so the text is still readable |
| 7 | Google Play link clickable and correct | **Pass** — exact URL present as a `/Link` annotation |
| 8 | WhatsApp number clickable and opens WhatsApp | **Pass** — `https://wa.me/923477776639` present as a `/Link` annotation |
| 9 | Existing VU bookshop text preserved | **Pass** — text intact, contact appended after `.com` |
| 10 | Small first page → no overlap | **Pass** — crowded page got its own information page; first-page content geometry unchanged |
| 11 | API failure → file marked failed, app continues | **Pass** — failure surfaced, next handout processed normally |
| 12 | Browser refresh during a batch → state recoverable | **Pass** — checkpoint restored, completed status carried into a fresh scan |
| 13 | Existing output skipped unless re-processing | **Pass** — detected and reported in the pre-flight summary |
| 14 | Scanned PDF → OCR fallback or clear status | **Pass** — scan detected, OCR ran, recognised span highlighted on the image, output validated. Without the optional language data the failure is reported clearly instead |
| 15 | 300-handout batch stays stable | **Partially verified** — see below |

Key-pool scenarios, all covered by tests:

| Behaviour | Result |
| --- | --- |
| Requests spread round-robin across every key | **Pass** |
| Rate-limited key rests and the work moves on | **Pass** — cooldown applied, chunk completed on the next key |
| Rejected key disabled, request succeeds elsewhere | **Pass** |
| Daily budget parks a key; usage survives a reload | **Pass** |
| Every key spent → clear error, no hang | **Pass** |
| A malformed reply is not blamed on the key | **Pass** — retried on the same key, no cooldown |
| Parallel analysis respects the configured ceiling | **Pass** |
| Per-key request spacing honours the RPM limit | **Pass** |
| Cancellation stops the pool promptly | **Pass** |
| Key values never appear in pool state or storage | **Pass** |
| Key-pool UI: add, label, mask, disable, remove | **Pass** |

Additional scenarios covered: over-highlighting guard on a dense page (31% coverage, the excess
reported rather than drawn), highlights never falling outside the page box, ZIP packaging preserving
course folders, resume snapshot round-trip, and the start button refusing to run without an API key.

**Test 15** is verified structurally, not at full scale: the queue processes with bounded
concurrency, one document is opened and destroyed per job, canvases are released explicitly,
outputs go to IndexedDB rather than memory, and the ZIP is built by streaming one file at a time.
A genuine 300-handout run needs 300 real handouts and a funded API key, so it has not been executed
end-to-end here.

---

## Known limitations

- Writing outputs back into the course folder needs the File System Access API (Chrome/Edge/Opera
  desktop). Elsewhere the outputs are downloads and a ZIP.
- OCR quality on low-resolution scans is bounded by Tesseract. Words recognised below 55%
  confidence are dropped rather than highlighted at the wrong place.
- Right-to-left and vertically-set text is not coordinate-mapped; such runs would be highlighted as
  whole runs rather than partial spans.
- Highlighting accuracy depends on the model you choose. A stronger model is noticeably more
  selective; the confidence floor and coverage ceiling protect against bad output either way.
- A 300-handout batch has not been run end-to-end (see Test 15).
- The pool's orchestration is tested against a stubbed HTTP layer, not against Gemini itself: the
  sandbox this was built in cannot reach the provider. Rotation, failover, spacing, budgets and
  cancellation are all verified; what remains unverified is how Gemini words its own 429 responses.
  The pool treats any 429 as a rate limit and keeps the response body in the message, so a per-day
  quota is recognised from it, but confirm this with *Test Connection* and a small batch first.
- Daily budgets reset at **UTC** midnight, which is when Google's free-tier quotas reset. In
  Pakistan that is 5:00 am.
