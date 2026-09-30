/*
 * Puts the OCR engine and its language data under /public/tesseract, so
 * "Scan bill" reads a photo entirely in the browser from files this app
 * serves itself — nothing is fetched from a CDN, and no bill leaves the
 * workshop's own site. Run by `npm install` (postinstall) and safe to re-run.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'public', 'tesseract');
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'ara.traineddata.gz'],
];

mkdirSync(out, { recursive: true });
const missing = [];
for (const [from, to] of files) {
  const source = path.join(root, from);
  if (!existsSync(source)) {
    missing.push(from);
    continue;
  }
  copyFileSync(source, path.join(out, to));
}
if (missing.length > 0) {
  console.warn(`copy-tesseract: not found, Scan bill will not read photos: ${missing.join(', ')}`);
} else {
  console.log(`copy-tesseract: ${files.length} files in public/tesseract`);
}
