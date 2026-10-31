import { EModelEndpoint, EndpointURLs } from 'coderax-data-provider';

/** Rewrite only native agent generation starts through Work's model gate. SSE,
 * resume, cancellation, approvals and queued-turn controls stay on the shared
 * authenticated agent transport. */
export function toWorkChatServer(
  server: string,
  nativeChatEndpoint = EndpointURLs[EModelEndpoint.agents],
): string {
  const origin = typeof window === 'undefined' ? 'http://coderax.local' : window.location.origin;
  const nativeBase = new URL(nativeChatEndpoint, origin);
  const requestUrl = new URL(server, nativeBase);
  const workPath = nativeBase.pathname.replace(/\/agents\/chat$/, '/work/chat');
  const nativePrefix = nativeBase.pathname;

  if (workPath === nativePrefix) {
    throw new Error(
      'Work could not resolve its native chat route. Check the server configuration.',
    );
  }
  if (requestUrl.origin !== nativeBase.origin) {
    throw new Error('Work requires a same-origin Coderax native agent endpoint.');
  }
  if (requestUrl.pathname === workPath || requestUrl.pathname.startsWith(`${workPath}/`)) {
    return requestUrl.toString();
  }
  if (requestUrl.pathname !== nativePrefix && !requestUrl.pathname.startsWith(`${nativePrefix}/`)) {
    throw new Error(
      'Work starts through Coderax native agents. Choose a free or local model configured for agents.',
    );
  }

  requestUrl.pathname = `${workPath}${requestUrl.pathname.slice(nativePrefix.length)}`;
  return requestUrl.toString();
}
