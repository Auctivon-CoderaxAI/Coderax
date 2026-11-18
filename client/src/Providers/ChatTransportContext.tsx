import { createContext, useContext } from 'react';
import { EndpointURLs, EModelEndpoint, isAssistantsEndpoint } from 'coderax-data-provider';
import type { WorkOptions, WorkSelection } from '~/components/Chat/Input/workSelection';
import type { Transport } from '~/hooks/Chat/contract';
import {
  resolveWorkSelection,
  sanitizeWorkSelection,
  workSelectionFromConversation,
} from '~/components/Chat/Input/workSelection';
import { createSSETransport } from '~/hooks/SSE/transport';
import {
  configuredWorkEngineOrigin,
  toWorkChatServer,
  toWorkEngineChatServer,
  toWorkEngineStreamUrl,
} from './workTransport';
import * as requests from '~/data-provider';

export { toWorkChatServer } from './workTransport';

/**
 * The stock transport: SSE for streams, the generation routes for control requests. Members
 * resolve their request functions when called, not when this module loads, because the request
 * hooks in `~/data-provider` read this context and so import this module back.
 */
export const defaultChatTransport: Transport = {
  stream: ({ token }) => createSSETransport({ token }),
  start: ({ server, payload }, options) =>
    requests.postGenerationRequest<unknown>(server, payload, options),
  abort: (params) => requests.abortStream(params),
  abortRun: ({ endpoint, abortKey }, { token }) =>
    fetch(`${EndpointURLs[endpoint]}/abort`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ abortKey, endpoint }),
    }),
  steer: (params) => requests.steerMessage(params),
  cancelSteer: (params) => requests.cancelSteerMessage(params),
  armSteer: (params) => requests.armSteerMessage(params),
  listQueued: (conversationId, clientRequestIds) =>
    requests.fetchAgentQueuedTurns(conversationId, clientRequestIds),
  enqueue: (input) => requests.enqueueAgentQueuedTurn(input),
  cancelQueued: (input) => requests.cancelAgentQueuedTurn(input),
};

export function createWorkChatTransport(
  transport: Transport = defaultChatTransport,
  options?: WorkOptions,
  selection?: WorkSelection | null,
  engineOrigin?: string,
): Transport {
  const directEngineOrigin = engineOrigin ?? configuredWorkEngineOrigin();
  let engineStream = false;

  return {
    ...transport,
    stream: (auth) => {
      const stream = transport.stream(auth);
      return {
        ...stream,
        reconnectToStream: (request, requestOptions) => {
          if (!engineStream || !directEngineOrigin) {
            return stream.reconnectToStream(request, requestOptions);
          }
          return stream.reconnectToStream(
            { ...request, url: toWorkEngineStreamUrl(request.url, directEngineOrigin) },
            requestOptions,
          );
        },
      };
    },
    start: ({ server, payload }, requestOptions) => {
      const selected = options
        ? resolveWorkSelection(
            selection
              ? sanitizeWorkSelection(selection, options)
              : workSelectionFromConversation(payload, options),
            options,
          )
        : undefined;
      if (options && !selected) {
        throw new Error('WORK_NO_FREE_MODEL');
      }
      const engineSelected = selected?.model.engine != null;
      engineStream = engineSelected;
      const workPayload = (() => {
        if (!selected) {
          return payload;
        }
        if (engineSelected) {
          return {
            ...payload,
            model: selected.model.id,
            agent_id: undefined,
            assistant_id: undefined,
            endpoint: undefined,
            endpointType: undefined,
            spec: null,
          };
        }
        return {
          ...payload,
          ...selected.preset,
          agent_id: selected.preset.agent_id,
          assistant_id: undefined,
          endpointType: selected.preset.endpoint,
          spec: null,
        };
      })();
      return transport.start(
        {
          server: engineSelected
            ? toWorkEngineChatServer(directEngineOrigin)
            : toWorkChatServer(
                isAssistantsEndpoint(payload.endpointType ?? payload.endpoint)
                  ? EndpointURLs[EModelEndpoint.agents]
                  : server,
              ),
          payload: workPayload,
        },
        requestOptions,
      );
    },
  };
}

export const workChatTransport = createWorkChatTransport();

export const ChatTransportContext = createContext<Transport>(defaultChatTransport);

export const useChatTransport = () => useContext(ChatTransportContext);
