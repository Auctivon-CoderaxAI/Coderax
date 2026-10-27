const assert = require("node:assert/strict");
const test = require("node:test");
const { isSafeWebUrl, normalizeServerUrl } = require("../server-url.cjs");

test("normalizes an HTTPS deployment and keeps a reverse-proxy path", () => {
  assert.equal(normalizeServerUrl(" https://chat.example.com/coderax/ "), "https://chat.example.com/coderax");
});

test("allows local HTTP development addresses", () => {
  assert.equal(normalizeServerUrl("http://localhost:3080/"), "http://localhost:3080");
  assert.equal(normalizeServerUrl("http://127.0.0.2:3080"), "http://127.0.0.2:3080");
  assert.equal(normalizeServerUrl("http://[::1]:3080"), "http://[::1]:3080");
});

test("rejects remote HTTP and non-web protocols", () => {
  assert.throws(() => normalizeServerUrl("http://chat.example.com"), /Use HTTPS/);
  assert.throws(() => normalizeServerUrl("file:///C:/private"), /Use HTTPS/);
  assert.throws(() => normalizeServerUrl("not a URL"), /complete address/);
});

test("rejects credentials, query strings, fragments, and control characters", () => {
  assert.throws(() => normalizeServerUrl("https://user:pass@chat.example.com"), /username or password/);
  assert.throws(() => normalizeServerUrl("https://chat.example.com/?token=secret"), /query string or fragment/);
  assert.throws(() => normalizeServerUrl("https://chat.example.com/#private"), /query string or fragment/);
  assert.throws(() => normalizeServerUrl("https://chat.example.com/\n"), /valid Coderax server address/);
});

test("blocks unsafe navigation protocols in remote windows", () => {
  assert.equal(isSafeWebUrl("https://login.example.com/authorize"), true);
  assert.equal(isSafeWebUrl("http://localhost:3080"), true);
  assert.equal(isSafeWebUrl("http://example.com"), false);
  assert.equal(isSafeWebUrl("javascript:alert(1)"), false);
});
