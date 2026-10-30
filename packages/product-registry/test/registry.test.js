import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRODUCTS,
  PRODUCT_ORDER,
  STATUS_LABELS,
  getLaunchableProducts,
  getOrderedProducts,
  getProduct,
  isLaunchable,
  productForPath,
  resolveLaunch,
} from '../index.js';

test('exposes exactly five products', () => {
  assert.equal(PRODUCTS.length, 5);
  assert.deepEqual(
    PRODUCTS.map((product) => product.id),
    ['desktop', 'web', 'chat', 'cli', 'cloud'],
  );
});

test('every product has the fields the UI renders', () => {
  for (const product of PRODUCTS) {
    assert.ok(product.name.length > 0, `${product.id} name`);
    assert.ok(product.tagline.length > 0, `${product.id} tagline`);
    assert.ok(product.description.length > 0, `${product.id} description`);
    assert.ok(product.icon.length > 0, `${product.id} icon`);
    assert.ok(product.cta.length > 0, `${product.id} cta`);
    assert.ok(product.availabilityNote.length > 0, `${product.id} note`);
    assert.ok(product.status in STATUS_LABELS, `${product.id} status label`);
  }
});

test('shortcuts are unique so keyboard navigation is unambiguous', () => {
  const shortcuts = PRODUCTS.map((product) => product.shortcut);
  assert.equal(new Set(shortcuts).size, shortcuts.length);
});

test('order covers every product exactly once', () => {
  assert.equal(PRODUCT_ORDER.length, PRODUCTS.length);
  assert.deepEqual(
    getOrderedProducts().map((product) => product.id),
    [...PRODUCT_ORDER],
  );
});

test('non-live products carry a roadmap and a reason', () => {
  for (const product of PRODUCTS) {
    if (product.status !== 'live') {
      assert.ok(product.roadmap.length > 0, `${product.id} needs a roadmap`);
      assert.ok(
        product.availabilityNote.length > 20,
        `${product.id} needs an honest availability note`,
      );
    }
  }
});

test('only live or preview products are launchable', () => {
  for (const product of getLaunchableProducts()) {
    assert.notEqual(
      product.status,
      'in-development',
      `${product.id} is in development but claims to launch`,
    );
  }
});

test('web and chat are the currently launchable products', () => {
  assert.deepEqual(
    getLaunchableProducts().map((product) => product.id).sort(),
    ['chat', 'web'],
  );
});

test('in-development products resolve to their roadmap, never a dead link', () => {
  for (const id of ['cli', 'cloud']) {
    const product = getProduct(id);
    assert.ok(product);
    assert.equal(isLaunchable(product), false);
    assert.equal(resolveLaunch(product).kind, 'roadmap');
  }
});

test('desktop preview resolves to roadmap because no artifact is verified', () => {
  const desktop = getProduct('desktop');
  assert.ok(desktop);
  assert.equal(desktop.status, 'preview');
  assert.deepEqual(resolveLaunch(desktop), { kind: 'roadmap' });
});

test('internal products resolve to routes', () => {
  assert.deepEqual(resolveLaunch(getProduct('web')), {
    kind: 'navigate',
    to: '/c/new',
  });
});

test('unknown ids return undefined rather than throwing', () => {
  assert.equal(getProduct('nonexistent'), undefined);
});

test('productForPath highlights a sensible product', () => {
  assert.equal(productForPath('/c/abc'), 'chat');
  assert.equal(productForPath('/projects'), 'cloud');
  assert.equal(productForPath('/projects/xyz'), 'cloud');
  assert.equal(productForPath('/agents'), 'web');
  assert.equal(productForPath(''), null);
});
