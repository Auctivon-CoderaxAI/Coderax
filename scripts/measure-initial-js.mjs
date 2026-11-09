#!/usr/bin/env node
/**
 * Measures the gzip size of the JavaScript the browser downloads before the app
 * boots: the entry module plus every `modulepreload` link Vite emits into
 * index.html. Both builds must be produced by the same Vite config and Node
 * version for the comparison to mean anything.
 *
 * Usage: node scripts/measure-initial-js.mjs [distDir] [--json]
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const json = args.includes('--json');
const distDir = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'client/dist');

const html = readFileSync(join(distDir, 'index.html'), 'utf8');

/** Every JS file the document pulls in as a module or preloads for the module graph. */
function collectInitialJs(document) {
  const entries = new Set();
  const scriptPattern = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g;
  const preloadPattern = /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g;
  for (const pattern of [scriptPattern, preloadPattern]) {
    for (const match of document.matchAll(pattern)) {
      entries.add(match[1]);
    }
  }
  return [...entries];
}

const files = collectInitialJs(html).map((reference) => {
  const path = join(distDir, reference.replace(/^\.?\//, ''));
  const bytes = readFileSync(path);
  return {
    reference,
    rawBytes: statSync(path).size,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
  };
});

files.sort((a, b) => b.gzipBytes - a.gzipBytes);

const sum = (key) => files.reduce((total, file) => total + file[key], 0);
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const total = { files: files.length, raw: sum('rawBytes'), gzip: sum('gzipBytes') };

if (json) {
  console.log(
    JSON.stringify(
      {
        distDir,
        total: { files: total.files, rawKB: kb(total.raw), gzipKB: kb(total.gzip) },
        files: files.map((file) => ({
          reference: file.reference,
          rawKB: kb(file.rawBytes),
          gzipKB: kb(file.gzipBytes),
        })),
      },
      null,
      2,
    ),
  );
} else {
  for (const file of files) {
    console.log(
      `${String(kb(file.gzipBytes)).padStart(8)} KB gzip  ${String(kb(file.rawBytes)).padStart(
        9,
      )} KB raw   ${file.reference}`,
    );
  }
  console.log(
    `\ninitial JS: ${total.files} files, ${kb(total.gzip)} KB gzip, ${kb(total.raw)} KB raw`,
  );
}
