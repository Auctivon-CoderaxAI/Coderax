import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('login displays Coderax branding without CyVox image', () => {
  const layout = read('client/src/components/Auth/AuthLayout.tsx');
  assert.match(layout, /src="assets\/coderax-wordmark\.svg"/);
  assert.doesNotMatch(layout, /cyvox-(?:icon|favicon)/i);
  assert.match(read('client/public/assets/coderax-wordmark.svg'), />Coderax<\/text>/);
});

test('browser favicon and installable app identify as Coderax', () => {
  const html = read('client/index.html');
  const vite = read('client/vite.config.ts');
  assert.match(html, /assets\/coderax-mark\.svg/);
  assert.doesNotMatch(html, /cyvox-(?:icon|favicon|apple-touch)/i);
  assert.match(vite, /assets\/coderax-mark\.svg/);
  assert.doesNotMatch(vite, /assets\/cyvox-(?:icon|favicon|apple-touch|\*\.png)/i);
  assert.match(read('client/public/assets/coderax-mark.svg'), /<title>Coderax<\/title>/);
});

test('existing auth form and internal CyVox engine remain unchanged', () => {
  const layout = read('client/src/components/Auth/AuthLayout.tsx');
  assert.match(layout, /<SocialLoginRender/);
  assert.match(layout, /<ThemeSelector/);
  assert.match(layout, /{children}/);
});
