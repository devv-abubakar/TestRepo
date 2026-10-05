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

export interface AiConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  temperature: number;
  /** Absolute or relative URL of a serverless proxy (provider === 'proxy'). */
  proxyUrl: string;
  /** Persist the key in localStorage. Off by default. */
  rememberKey: boolean;
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
  handoutId: string | null;
  courseCode: string;
  handoutName: string;
  page: number;
  pageCount: number;
  stage: ProcessingStage;
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
}

// ------------------------------------------------------------------ settings

export interface HighlightSettings {
  color: string;
  opacity: number;
  minImportance: Importance;
  maxPerPage: number;
  /** Matches below this confidence are logged, never drawn. */
  minConfidence: number;
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

export interface ProcessOutcome {
  highlightCount: number;
  lowConfidenceSkipped: number;
  pageCount: number;
  usedOcr: boolean;
  bytes: Uint8Array;
  validation: ValidationResult;
}
