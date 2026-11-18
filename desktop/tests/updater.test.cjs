const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  checkForDesktopUpdate,
  isNewerVersion,
  nextReleasePage,
  parseChecksum,
  parseVersion,
  selectDesktopRelease,
  sha256,
} = require("../updater.cjs");

const RELEASES_URL =
  "https://api.github.com/repos/Auctivon-CoderaxAI/Coderax/releases?per_page=100";
const NEXT_RELEASES_URL = `${RELEASES_URL}&page=2`;

function response(body, link = null) {
  return {
    ok: true,
    headers: { get: (name) => (name.toLowerCase() === "link" ? link : null) },
    json: async () => body,
  };
}

function release(version, overrides = {}) {
  const tag = `desktop-v${version}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/Auctivon-CoderaxAI/Coderax/releases/tag/${tag}`,
    assets: [
      {
        name: "Coderax-Windows-x64.exe",
        url: `https://api.github.com/repos/Auctivon-CoderaxAI/Coderax/releases/assets/${version}-installer`,
      },
      {
        name: "SHA256SUMS.txt",
        url: `https://api.github.com/repos/Auctivon-CoderaxAI/Coderax/releases/assets/${version}-checksums`,
      },
    ],
    ...overrides,
  };
}

test("parses three-part desktop versions", () => {
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.equal(parseVersion("v1.2.3"), null);
  assert.equal(parseVersion("desktop-v1.2.3"), null);
  assert.equal(parseVersion("1.2"), null);
});

test("compares versions numerically rather than lexically", () => {
  assert.equal(isNewerVersion("desktop-v1.10.0", "1.9.9"), true);
  assert.equal(isNewerVersion("desktop-v1.0.0", "1.0.0"), false);
  assert.equal(isNewerVersion("desktop-v0.9.0", "1.0.0"), false);
});

test("selects the newest newer desktop release with installer and checksums", () => {
  const selected = selectDesktopRelease(
    [release("1.0.0"), release("1.2.0"), release("1.1.0")],
    "1.0.0",
  );
  assert.equal(selected.version, "1.2.0");
  assert.equal(selected.tag, "desktop-v1.2.0");
  assert.equal(selected.installer.name, "Coderax-Windows-x64.exe");
});

test("ignores drafts, prereleases, unrelated tags and incomplete assets", () => {
  const missingChecksums = release("2.3.0");
  missingChecksums.assets = missingChecksums.assets.filter(
    (asset) => asset.name !== "SHA256SUMS.txt",
  );

  const selected = selectDesktopRelease(
    [
      release("2.0.0", { draft: true }),
      release("2.1.0", { prerelease: true }),
      { ...release("2.2.0"), tag_name: "app-v2.2.0" },
      missingChecksums,
      release("1.5.0"),
    ],
    "1.0.0",
  );
  assert.equal(selected.version, "1.5.0");
});

test("returns null when the installed version is current or newer", () => {
  assert.equal(selectDesktopRelease([release("1.0.0")], "1.0.0"), null);
  assert.equal(selectDesktopRelease([release("0.9.0")], "1.0.0"), null);
  assert.equal(selectDesktopRelease([], "1.0.0"), null);
});

test("reads the SHA-256 entry for the installer and rejects other entries", () => {
  const hash = "a".repeat(64);
  const text = `${"b".repeat(64)}  Other.exe\n${hash}  Coderax-Windows-x64.exe\n`;
  assert.equal(parseChecksum(text, "Coderax-Windows-x64.exe"), hash);
  assert.equal(parseChecksum(text, "Missing.exe"), null);
  assert.equal(parseChecksum("not a checksum file", "Coderax-Windows-x64.exe"), null);
});

test("hashes the installer bytes with SHA-256", () => {
  const bytes = Buffer.from("coderax");
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256(bytes), expected);
});

test("reads the next release page from the GitHub Link header", () => {
  assert.equal(
    nextReleasePage(`<${NEXT_RELEASES_URL}>; rel="next", <${RELEASES_URL}&page=3>; rel="last"`),
    NEXT_RELEASES_URL,
  );
  assert.equal(nextReleasePage(null), null);
  assert.equal(nextReleasePage(`<${RELEASES_URL}>; rel="prev"`), null);
});

test("follows release pagination before selecting an update", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? response([release("1.2.0", { draft: true })], `<${NEXT_RELEASES_URL}>; rel="next"`)
      : response([release("1.1.0")]);
  };

  const selected = await checkForDesktopUpdate({ currentVersion: "1.0.0", fetchImpl });

  assert.equal(selected.version, "1.1.0");
  assert.deepEqual(calls, [RELEASES_URL, NEXT_RELEASES_URL]);
});
