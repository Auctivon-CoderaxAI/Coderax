const { createHash } = require("node:crypto");

const GITHUB_OWNER = "Auctivon-CoderaxAI";
const GITHUB_REPO = "Coderax";
const RELEASE_TAG_PREFIX = "desktop-v";
const INSTALLER_ASSET = "Coderax-Windows-x64.exe";
const CHECKSUMS_ASSET = "SHA256SUMS.txt";
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100`;
const USER_AGENT = "Coderax-Desktop-Updater";

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function releaseVersion(tag) {
  return typeof tag === "string" && tag.startsWith(RELEASE_TAG_PREFIX)
    ? tag.slice(RELEASE_TAG_PREFIX.length)
    : null;
}

function isNewerVersion(tag, currentVersion) {
  const next = parseVersion(releaseVersion(tag));
  const installed = parseVersion(currentVersion);
  return Boolean(next && installed && compareVersions(next, installed) > 0);
}

/** Extract the `rel="next"` URL from a GitHub Link header. */
function nextReleasePage(linkHeader) {
  if (typeof linkHeader !== "string") return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

function isTrustedAssetUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "api.github.com" ||
        url.hostname === "github.com" ||
        url.hostname.endsWith(".githubusercontent.com"))
    );
  } catch {
    return false;
  }
}

/**
 * Pick the newest published desktop release that is newer than the installed
 * version and ships both the Windows installer and its checksum file.
 */
function selectDesktopRelease(releases, currentVersion) {
  if (!Array.isArray(releases) || !parseVersion(currentVersion)) return null;

  const candidates = [];
  for (const release of releases) {
    if (!release || release.draft || release.prerelease) continue;
    const version = releaseVersion(release.tag_name);
    if (!version || !isNewerVersion(release.tag_name, currentVersion)) continue;

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find((asset) => asset && asset.name === INSTALLER_ASSET);
    const checksums = assets.find((asset) => asset && asset.name === CHECKSUMS_ASSET);
    if (!installer || !checksums) continue;
    if (!isTrustedAssetUrl(installer.url) || !isTrustedAssetUrl(checksums.url)) continue;

    candidates.push({
      tag: release.tag_name,
      version,
      notesUrl: typeof release.html_url === "string" ? release.html_url : RELEASES_PAGE,
      installer: { name: installer.name, url: installer.url },
      checksums: { name: checksums.name, url: checksums.url },
    });
  }

  candidates.sort((left, right) =>
    compareVersions(parseVersion(right.version), parseVersion(left.version)),
  );
  return candidates[0] || null;
}

/** Read the SHA-256 entry for one asset from a `sha256sum`-style manifest. */
function parseChecksum(text, assetName) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  return null;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function request(url, { token, accept, fetchImpl = fetch } = {}) {
  if (!isTrustedAssetUrl(url)) {
    throw new Error("The update URL is not a trusted GitHub address.");
  }

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub responded with ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function fetchAllReleases({ token = null, fetchImpl = fetch } = {}) {
  const releases = [];
  const seen = new Set();
  let url = RELEASES_API;
  while (url) {
    if (seen.has(url)) throw new Error("GitHub returned a release pagination loop.");
    if (seen.size >= 50) throw new Error("GitHub returned too many release pages.");
    seen.add(url);

    const response = await request(url, { token, fetchImpl });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("GitHub returned an invalid release list.");
    releases.push(...page);
    url = nextReleasePage(response.headers?.get?.("link"));
  }
  return releases;
}

async function checkForDesktopUpdate({ currentVersion, token = null, fetchImpl = fetch } = {}) {
  const releases = await fetchAllReleases({ token, fetchImpl });
  return selectDesktopRelease(releases, currentVersion);
}

async function downloadReleaseAsset({ url, token = null, fetchImpl = fetch }) {
  const response = await request(url, { token, accept: "application/octet-stream", fetchImpl });
  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  CHECKSUMS_ASSET,
  GITHUB_OWNER,
  GITHUB_REPO,
  INSTALLER_ASSET,
  RELEASES_PAGE,
  checkForDesktopUpdate,
  compareVersions,
  downloadReleaseAsset,
  isNewerVersion,
  isTrustedAssetUrl,
  nextReleasePage,
  parseChecksum,
  parseVersion,
  releaseVersion,
  selectDesktopRelease,
  sha256,
};
