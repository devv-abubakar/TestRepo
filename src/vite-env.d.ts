/// <reference types="vite/client" />

/**
 * True when the optional @tesseract.js-data/eng package was present at build
 * time, meaning the OCR model is served from this origin. Injected by the
 * `local-runtime-assets` Vite plugin.
 */
declare const __LOCAL_TESSDATA__: boolean;

interface ImportMetaEnv {
  /**
   * Base URL for Tesseract language data. Overrides the local/CDN choice;
   * set it to keep OCR offline when the optional data package is not used.
   */
  readonly VITE_TESSERACT_LANG_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
