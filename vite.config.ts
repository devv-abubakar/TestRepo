import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, dirname } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

interface AssetGroup {
  /** Package whose files are served. */
  pkg: string;
  /** Sub-folder inside that package. */
  folder: string;
  /** URL prefix the files are served under. */
  servedUnder: string;
  /** Optional filter, when only part of a folder is needed. */
  include?: (name: string) => boolean;
}

/**
 * Runtime data files that must come from our own origin.
 *
 * pdf.js needs its standard-font and CMap data: without them a page that
 * relies on a non-embedded base-14 font renders blank, which silently breaks
 * the blank-space detection this app uses to place the footer safely.
 * Tesseract's worker and WASM core would otherwise be pulled from a public
 * CDN on first use, which is both a privacy leak for a tool that promises
 * local processing and a hard dependency on a third party staying up.
 */
const ASSET_GROUPS: AssetGroup[] = [
  { pkg: 'pdfjs-dist', folder: 'standard_fonts', servedUnder: 'pdfjs/standard_fonts' },
  { pkg: 'pdfjs-dist', folder: 'cmaps', servedUnder: 'pdfjs/cmaps' },
  {
    pkg: 'tesseract.js',
    folder: 'dist',
    servedUnder: 'tesseract',
    include: (name) => name === 'worker.min.js',
  },
  {
    pkg: 'tesseract.js-core',
    folder: '.',
    servedUnder: 'tesseract',
    // Only the LSTM builds, which is what Tesseract 5 selects: the SIMD one
    // where the browser supports it, the plain one as the fallback. Shipping
    // the legacy cores as well would quadruple the asset payload.
    include: (name) => /^tesseract-core(-simd)?-lstm\.wasm(\.js)?$/.test(name),
  },
  {
    // Optional: when @tesseract.js-data/eng is installed, the English model
    // is served locally and OCR needs no network at all. Uninstall it and the
    // app falls back to the public tessdata host.
    pkg: '@tesseract.js-data/eng',
    folder: '4.0.0',
    servedUnder: 'tesseract/lang',
    include: (name) => name === 'eng.traineddata.gz',
  },
];

/** Did the optional local language data resolve? */
function hasLocalLanguageData(files: readonly { served: string }[]): boolean {
  return files.some((file) => file.served === 'tesseract/lang/eng.traineddata.gz');
}

function localAssets(): Plugin {
  const files = ASSET_GROUPS.flatMap((group) => {
    const dir = join(dirname(require.resolve(`${group.pkg}/package.json`)), group.folder);
    try {
      return readdirSync(dir)
        .filter((name) => (group.include ? group.include(name) : true))
        .filter((name) => statSync(join(dir, name)).isFile())
        .map((name) => ({ served: posix.join(group.servedUnder, name), disk: join(dir, name) }));
    } catch {
      return [];
    }
  });

  return {
    name: 'local-runtime-assets',
    config() {
      return {
        define: {
          __LOCAL_TESSDATA__: JSON.stringify(hasLocalLanguageData(files)),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0] ?? '';
        const match = files.find((file) => url === `/${file.served}`);
        if (!match) {
          next();
          return;
        }
        response.setHeader(
          'content-type',
          url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        );
        response.end(readFileSync(match.disk));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: file.served, source: readFileSync(file.disk) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localAssets()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the heavy PDF and OCR engines out of the initial payload.
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          pdflib: ['pdf-lib'],
          ocr: ['tesseract.js'],
        },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
} as never);
