function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]") {
    return true;
  }

  const octets = host.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every((octet, index) =>
      Number.isInteger(octet) && octet >= 0 && octet <= 255 && (index !== 0 || octet === 127)
    )
  );
}

function normalizeServerUrl(value) {
  if (typeof value !== "string") {
    throw new Error("Enter a Coderax server address.");
  }

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Enter a valid Coderax server address.");
  }

  const input = value.trim();
  if (!input || input.length > 2048) {
    throw new Error("Enter a valid Coderax server address.");
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete address, including https://.");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new Error("Use HTTPS for remote servers. HTTP is allowed only for a local server.");
  }

  if (url.username || url.password) {
    throw new Error("Do not include a username or password in the server address.");
  }

  if (url.search || url.hash) {
    throw new Error("Remove the query string or fragment from the server address.");
  }

  return url.toString().replace(/\/+$/, "");
}

function isSafeWebUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname))) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

module.exports = { isSafeWebUrl, normalizeServerUrl };
