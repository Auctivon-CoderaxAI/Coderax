import { readBoundedBytes } from '~/utils/http';

/** Authorization servers return small documents; the same cap bounds streamed bodies in hardenedFetch. */
export const OAUTH_MAX_RESPONSE_BYTES = 1024 * 1024;
/** An error body is classified and quoted, so only a short prefix is read. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const MAX_ERROR_TEXT_CHARS = 300;

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * A fetch response carrying content always exposes a stream, so the bounded path covers
 * every real authorization server. A response without one has no body (204/HEAD); that
 * case still uses the accessor, which also keeps non-streaming test doubles working.
 */
export async function readOAuthJson(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown;
  if (!response.body) {
    parsed = await response.json();
  } else {
    const bounded = await readBoundedBytes(response, OAUTH_MAX_RESPONSE_BYTES);
    if (!bounded.ok) {
      throw new Error('OAuth token response exceeded the size limit');
    }
    parsed = JSON.parse(decode(bounded.body));
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
    throw new Error('OAuth token response was not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * RFC 6749 token errors are JSON with a stable `error` code. Callers classify
 * `invalid_scope`, `invalid_grant`, and `invalid_client` from this text, so a long
 * `error_description` must not push the code past the truncation point.
 */
function extractErrorCode(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const code = (parsed as Record<string, unknown>).error;
    return typeof code === 'string' && code.trim() ? code.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the machine-readable code ahead of a bounded diagnostic prefix. */
function summarizeErrorBody(text: string): string {
  const truncated = text.slice(0, MAX_ERROR_TEXT_CHARS);
  const code = extractErrorCode(text);
  if (!code || truncated.includes(code)) {
    return truncated;
  }
  return `${code}: ${truncated}`.slice(0, MAX_ERROR_TEXT_CHARS);
}

/** Reads a bounded prefix of an error body for classification and explanation. */
export async function readOAuthErrorText(response: Response): Promise<string> {
  if (!response.body) {
    return summarizeErrorBody(await response.text());
  }
  const bounded = await readBoundedBytes(response, MAX_ERROR_BODY_BYTES);
  if (!bounded.ok) {
    return 'response body too large';
  }
  return summarizeErrorBody(decode(bounded.body));
}
