#!/usr/bin/env node
/**
 * Fail the Vercel backend build if @coderax/api still imports mathjs or the
 * MCP SDK at runtime. Both have been missing from deployed serverless bundles
 * even when npm ci and the frontend build succeeded.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const externalMathjs = /\b(?:require|import)\s*\(\s*['"]mathjs(?:\/[^'"]*)?['"]\s*\)/;
const externalMcpSdk = /\b(?:require|import)\s*\(\s*['"]@modelcontextprotocol\/sdk(?:\/[^'"]*)?['"]\s*\)/;

export async function verifyApiBundle(root = repoRoot) {
  const dist = path.join(root, 'packages/api/dist');
  const files = (await readdir(dist)).filter((name) => /\.(?:cjs|js|mjs)$/.test(name));
  assert.ok(files.includes('index.cjs'), 'built @coderax/api index.cjs is missing');
  for (const name of files) {
    const code = await readFile(path.join(dist, name), 'utf8');
    assert.ok(!externalMathjs.test(code), name + ' still requires external mathjs');
    assert.ok(!externalMcpSdk.test(code), name + ' still requires external MCP SDK');
  }
  return { filesScanned: files.length, externalMathjs: false, externalMcpSdk: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ ok: true, bundle: await verifyApiBundle() }));
  } catch (error) {
    console.error('[Coderax backend bundle gate] FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
