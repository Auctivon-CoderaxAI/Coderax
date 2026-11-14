import { readBoundedBytes } from '~/utils/http';

/** CyVox forwards bounded JSON so a misbehaving upstream cannot buffer an unbounded body. */
export const CYVOX_MAX_RESPONSE_BYTES = 1024 * 1024;

export type BoundedBody = { ok: true; body: string } | { ok: false; code: 'too_large' };

/** Reads at most `limit` bytes of a response body and decodes them as UTF-8. */
export async function readBoundedBody(
  response: Response,
  limit = CYVOX_MAX_RESPONSE_BYTES,
): Promise<BoundedBody> {
  const result = await readBoundedBytes(response, limit);
  return result.ok
    ? { ok: true, body: new TextDecoder().decode(result.body) }
    : { ok: false, code: result.code };
}
