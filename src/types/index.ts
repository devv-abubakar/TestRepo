/** Shared domain types for VU Handouts AI Highlighter. */

// ---------------------------------------------------------------- AI provider

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'proxy';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Models offered in the UI; the field stays editable for anything newer. */
  models: readonly string[];
  defaultModel: string;
  /** True when the browser talks straight to the vendor with the user's key. */
  browserDirect: boolean;
  keyHint: string;
  docsUrl: string;
}

/** One API key in the pool, usually one per free-tier cloud project. */
export interface ApiKeyEntry {
  id: string;
  /** Short name shown in the activity log, e.g. "Project A". */
  label: string;
  key: string;
  enabled: boolean;
}

export interface AiConfig {
  provider: ProviderId;
  /**
   * The key pool. Several free-tier keys from different projects are rotated,
   * so their quotas add up and requests run in parallel.
   */
  keys: ApiKeyEntry[];
  model: string;
  temperature: number;
  /** Absolute or relative URL of a serverless proxy (provider === 'proxy'). */
  proxyUrl: string;
  /** Persist the keys in localStorage. Off by default. */
  rememberKey: boolean;
  /** Requests per minute allowed per key. 0 disables the spacing. */
  requestsPerMinutePerKey: number;
  /** Requests per key per day before it is parked. 0 disables the budget. */
  dailyBudgetPerKey: number;
  /** Hard ceiling on concurrent AI requests across the whole pool. */
  maxParallelRequests: number;
}

export type KeyStatus = 'idle' | 'active' | 'cooling' | 'exhausted' | 'disabled';

/** Live state of one pooled key, surfaced in the UI and the log. */
export interface KeyStats {
  id: string;
  label: string;
  status: KeyStatus;
  inFlight: number;
  requests: number;
  succeeded: number;
  failed: number;
  rateLimited: number;
  /** Requests spent today, against `dailyBudgetPerKey`. */
  usedToday: number;
  /** Epoch ms until which this key is resting. */
  cooldownUntil: number;
  lastUsedAt: number;
  lastError?: string;
  /** What this key is working on right now. */
  task?: string;
}

export type Importance = 'high' | 'medium' | 'low';

/** One span of source text the model considers exam-critical. */
export interface AiHighlight {
  text: string;
  importance: Importance;
  reason: string;
}

export interface AiResponse {
  highlights: AiHighlight[];
}

export interface AiRequest {
  /** Page-tagged plain text handed to the model. */
  content: string;
  courseCode: string;
  handoutName: string;
  /** Upper bound the prompt asks the model to respect. */
  maxHighlights: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'auth'
      | 'rate-limit'
      | 'network'
      | 'timeout'
      | 'model'
      | 'invalid-response'
      | 'unknown',
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

// -------------------------------------------------------------- PDF geometry

/** A rectangle in PDF user space: origin bottom-left, y grows upward. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One text run extracted from a page, with its device-independent box. */
export interface TextPiece {
  str: string;
  rect: Rect;
  /** Baseline font size in PDF units, used to size the highlight band. */
  fontSize: number;
  /** Index of the first character of `str` inside the page's normalized text. */
  normStart: number;
  normEnd: number;
}

export interface PageText {
  pageIndex: number;
  width: number;
  height: number;
  pieces: TextPiece[];
  /** Whitespace-normalized concatenation of every piece on the page. */
  normalized: string;
  /** Raw per-piece text joined with single spaces (for prompt payloads). */
  raw: string;
  /**
   * For every character of `normalized`, the index of the `pieces` entry it
   * came from, or -1 for a separator space inserted between two pieces.
   */
  pieceOf: Int32Array;
  /** For every character of `normalized`, its offset inside that piece. */
  posInPiece: Int32Array;
}

export interface DocumentText {
  pages: PageText[];
  /** True when extraction yielded so little text that OCR was used. */
  usedOcr: boolean;
  totalChars: number;
}

/** A resolved highlight ready to be written as an annotation. */
export interface MatchedHighlight {
  /** AI spans that were split across lines or pages share a group id. */
  groupId: number;
  pageIndex: number;
  rects: Rect[];
  confidence: number;
  importance: Importance;
  reason: string;
  matchedText: string;
}

export interface MatchFailure {
  text: string;
  reason: string;
  bestConfidence: number;
}

// ------------------------------------------------------------------- queue

export type HandoutStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface HandoutRef {
  /** Stable identity: `${courseCode}/${fileName}`. */
  id: string;
  courseCode: string;
  fileName: string;
  size: number;
}

export interface Handout extends HandoutRef {
  status: HandoutStatus;
  highlightCount: number;
  pageCount: number;
  /** Pages that hold real text but received no highlight — worth a look. */
  pagesWithoutHighlights: number;
  /** Share of the handout's characters that ended up highlighted. */
  coverageShare: number;
  /** Set when status is 'failed'. */
  error?: string;
  /** How the output was delivered. */
  outputMode?: 'written' | 'stored';
  outputName?: string;
  lowConfidenceSkipped: number;
  usedOcr: boolean;
  durationMs?: number;
}

export interface Course {
  code: string;
  handoutIds: string[];
}

export interface ProcessingProgress {
  handoutId: string;
  courseCode: string;
  handoutName: string;
  /** Page currently being read, extracted or recognised. */
  page: number;
  pageCount: number;
  /** AI chunks finished and expected, so progress is real during analysis. */
  chunksDone: number;
  chunksTotal: number;
  stage: ProcessingStage;
  /** Free-text detail, e.g. "pages 5-8 via Project B". */
  detail: string;
  startedAt: number;
}

export type ProcessingStage =
  | 'idle'
  | 'reading'
  | 'extracting'
  | 'ocr'
  | 'analyzing'
  | 'matching'
  | 'highlighting'
  | 'annotating'
  | 'validating'
  | 'saving'
  | 'done';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
  handoutId?: string;
  /** Label of the API key this line is about, when it is key-specific. */
  keyLabel?: string;
}

// ------------------------------------------------------------------ settings

/**
 * How much of a handout to mark.
 *
 * `selective` keeps the page clean at the cost of leaving some material out.
 * `complete` is the opposite trade: more AI passes, looser caps, and a
 * rule-based sweep, so a student revising from the highlights alone is far
 * less likely to hit a gap.
 */
export type CoverageMode = 'selective' | 'balanced' | 'complete';

export interface HighlightSettings {
  color: string;
  opacity: number;
  coverage: CoverageMode;
  minImportance: Importance;
  /** 0 removes the cap. */
  maxPerPage: number;
  /** Largest share of a page's characters that may be highlighted. */
  pageCoverageCeiling: number;
  /** Matches below this confidence are logged, never drawn. */
  minConfidence: number;
  /**
   * Scan the text for definition, formula and classification cues and make
   * sure those sentences are marked even when the model overlooked them.
   */
  ruleBasedSweep: boolean;
}

export interface ContentSettings {
  addStudyMessage: boolean;
  addStudentsGuide: boolean;
  addWhatsApp: boolean;
}

export interface OutputSettings {
  suffix: string;
  reprocessExisting: boolean;
  concurrency: number;
}

export interface Settings {
  ai: AiConfig;
  highlight: HighlightSettings;
  content: ContentSettings;
  output: OutputSettings;
  theme: 'light' | 'dark';
}

// -------------------------------------------------------------- persistence

export interface OutputFile {
  handoutId: string;
  courseCode: string;
  fileName: string;
  bytes: Uint8Array;
  createdAt: number;
}

export interface SessionSnapshot {
  rootName: string;
  savedAt: number;
  handouts: Handout[];
  courses: Course[];
  totalHighlights: number;
}

// --------------------------------------------------------------- validation

export interface ValidationResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

/** Per-handout account of what was marked and what was not. */
export interface CoverageReport {
  /** Share of all extracted characters that were highlighted. */
  share: number;
  /** 1-based page numbers that hold substantial text but got nothing. */
  pagesWithoutHighlights: number[];
  /** Per-page highlighted share, indexed by page. */
  perPageShare: number[];
  /** Candidates the model returned that could not be located verbatim. */
  unmatchedSpans: number;
  /** Candidates added by the rule-based sweep rather than the model. */
  ruleBasedAdded: number;
  /** AI requests spent on this handout. */
  aiRequests: number;
}

export interface ProcessOutcome {
  highlightCount: number;
  lowConfidenceSkipped: number;
  pageCount: number;
  usedOcr: boolean;
  bytes: Uint8Array;
  validation: ValidationResult;
  coverage: CoverageReport;
}
