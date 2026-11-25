/**
 * HTTP basic auth for `opencode serve`.
 *
 * The server enforces `OPENCODE_SERVER_PASSWORD` on every route, so a client
 * without the header is refused. The credential is placed in an Authorization
 * header and never in a URL, a log line or an error message; the default
 * username is the server's own (`opencode`) and only the password is configured.
 */
export function openCodeAuthHeader(input: {
  username?: string;
  password?: string;
}): Record<string, string> | undefined {
  if (!input.password) {
    return undefined;
  }
  const username = input.username?.trim() || 'opencode';
  const encoded = Buffer.from(`${username}:${input.password}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${encoded}` };
}
