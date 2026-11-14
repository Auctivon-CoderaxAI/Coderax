import { extractEnvVariable } from 'coderax-data-provider';
import type { TEndpoint } from 'coderax-data-provider';

/** Ollama on the server's own loopback interface does not require credentials. */
export function isKeylessLocalOllama(endpoint: Partial<TEndpoint>): boolean {
  if (endpoint.apiKey || !endpoint.name?.toLowerCase().startsWith('ollama')) {
    return false;
  }

  try {
    const url = new URL(extractEnvVariable(endpoint.baseURL ?? ''));
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
