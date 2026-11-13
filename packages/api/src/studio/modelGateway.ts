import { STUDIO_ALLOWED_EXTENSIONS, STUDIO_LIMITS, StudioGenerationError } from './types';
import type { StudioGenerationResult, StudioGenerator } from './types';

/** Upper bound on the raw gateway response, before JSON parsing. */
const DEFAULT_MAX_RESPONSE_BYTES = STUDIO_LIMITS.maxTotalBytes * 2;

export const STUDIO_SYSTEM_PROMPT = [
  'You generate small static web projects.',
  'Respond with ONLY a JSON object of the form',
  '{"title": string, "entry": string, "files": [{"path": string, "content": string}]}.',
  '`entry` must be an .html file that is also listed in `files`.',
  'Paths are relative, use forward slashes, and never start with "." or contain "..".',
  `Allowed extensions: ${STUDIO_ALLOWED_EXTENSIONS.join(', ')}.`,
  `At most ${STUDIO_LIMITS.maxFiles} files.`,
  'Link stylesheets with <link rel="stylesheet" href="...">. Scripts will NOT run in the preview,',
  'so the page must be fully usable as HTML and CSS. Do not load remote resources.',
  'Use clearly labelled sample data; never include secrets or real personal data.',
].join(' ');

export type ModelGatewayStudioOptions = {
  /** OpenAI-compatible base URL, e.g. https://gateway.internal/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
};

/** Accepts plain JSON or a single ```json fenced block. */
function parseModelJson(content: string): unknown {
  const fenced = /^\s*<v-code-fenced-content uri="urn:uuid:d9f51829-0010-4bc3-b923-4eded720504e"></v-code-fenced-content>'));
    await expect(generator(fetchMock).generate(request())).resolves.toEqual(project);
  });

  it('maps non-JSON model output to INVALID_OUTPUT', async () => {
    const fetchMock = jest.fn().mockResolvedValue(reply('sure! here you go'));
    await expect(generator(fetchMock).generate(request())).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('maps gateway failures to UPSTREAM_ERROR', async () => {
    const failing = jest.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(generator(failing).generate(request())).rejects.toBeInstanceOf(
      StudioGenerationError,
    );
    const throwing = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(generator(throwing).generate(request())).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });

  it('is not configured without URL and model', () => {
    expect(createModelGatewayStudioGeneratorFromEnv({})).toBeNull();
    expect(
      createModelGatewayStudioGeneratorFromEnv({
        STUDIO_MODEL_GATEWAY_URL: 'https://gw.test',
        STUDIO_MODEL: 'm',
      }),
    ).not.toBeNull();
  });
});