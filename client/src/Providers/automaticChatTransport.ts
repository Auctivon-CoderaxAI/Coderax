import {
  EModelEndpoint,
  EndpointURLs,
  compareModelRoutes,
  isAgentsEndpoint,
  isAssistantsEndpoint,
} from 'coderax-data-provider';
import type {
  AutomaticChatModel,
  ModelRouteCandidate,
  TEndpointsConfig,
  TPayload,
} from 'coderax-data-provider';
import type { ChatTransportRequest } from 'coderax-data-provider';
import type { Transport } from '~/hooks/Chat/contract';

const PAID_APPROVAL_TTL_MS = 5 * 60 * 1000;

type RouteHealth = { attempts: number; starts: number; averageStartMs: number };

function candidateKey(candidate: ModelRouteCandidate): string {
  return `${candidate.provider ?? ''}\u0000${candidate.id}`;
}

function recordRouteStart(
  health: Map<string, RouteHealth>,
  candidate: ModelRouteCandidate,
  elapsedMs: number,
  succeeded: boolean,
) {
  const key = candidateKey(candidate);
  const current = health.get(key) ?? { attempts: 0, starts: 0, averageStartMs: 0 };
  const attempts = current.attempts + 1;
  const starts = current.starts + (succeeded ? 1 : 0);
  const averageStartMs =
    current.attempts === 0
      ? elapsedMs
      : current.averageStartMs + (elapsedMs - current.averageStartMs) / attempts;
  health.set(key, { attempts, starts, averageStartMs });
}

function rankedByObservedHealth(
  candidates: ModelRouteCandidate[],
  health: Map<string, RouteHealth>,
): ModelRouteCandidate[] {
  return candidates
    .map((candidate) => {
      const observed = health.get(candidateKey(candidate));
      return {
        candidate,
        ranked: observed
          ? {
              ...candidate,
              reliability:
                observed.attempts > 0 ? observed.starts / observed.attempts : candidate.reliability,
              speed: 1 / (1 + observed.averageStartMs / 5_000),
            }
          : candidate,
      };
    })
    .sort((a, b) => compareModelRoutes(a.ranked, b.ranked))
    .map(({ candidate }) => candidate);
}

function getStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined;
  }
  const value = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = value.response?.status ?? value.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

/** Only availability failures before a stream starts can safely change models. */
export function canFailOverChatModel(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
    return false;
  }
  const status = getStatus(error);
  if (status != null) {
    return [404, 408, 429, 502, 503, 504].includes(status);
  }
  if (error == null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

function withCandidate(
  request: ChatTransportRequest,
  candidate: ModelRouteCandidate,
  endpointsConfig: TEndpointsConfig | undefined,
  paidConsent: boolean,
): ChatTransportRequest {
  const origin = typeof window === 'undefined' ? 'http://coderax.local' : window.location.origin;
  const nativeEndpoint = new URL(EndpointURLs[EModelEndpoint.agents], origin);
  const url = new URL(request.server, nativeEndpoint);
  const prefix = nativeEndpoint.pathname.replace(/\/$/, '');
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    throw new Error('Chat model routing received an unexpected generation route.');
  }
  const suffix = url.pathname.slice(prefix.length).replace(/^\/[^/]+/, '');
  url.pathname = `${prefix}/${encodeURIComponent(candidate.provider ?? '')}${suffix}`;

  const endpointType = endpointsConfig?.[candidate.provider ?? '']?.type;
  const payload: TPayload = {
    ...request.payload,
    endpoint: candidate.provider as TPayload['endpoint'],
    model: candidate.id,
    modelLabel: candidate.label,
    modelDisplayLabel: endpointsConfig?.[candidate.provider ?? '']?.modelDisplayLabel,
    ...(endpointType ? { endpointType: endpointType as TPayload['endpointType'] } : {}),
  };
  if (!endpointType) {
    delete payload.endpointType;
  }
  const consentPayload = payload as TPayload & { paidModelConsent?: boolean };
  delete consentPayload.paidModelConsent;
  if (paidConsent) {
    consentPayload.paidModelConsent = true;
  }
  return { server: url.toString(), payload };
}

export type AutomaticChatTransportController = {
  transport: Transport;
  /** Authorizes one newly submitted paid request; same-request retries keep it. */
  approvePaidRequest: () => void;
  clearPaidApproval: () => void;
};

export function createAutomaticChatTransport({
  transport,
  selection,
  endpointsConfig,
}: {
  transport: Transport;
  selection: AutomaticChatModel;
  endpointsConfig?: TEndpointsConfig;
}): AutomaticChatTransportController {
  /** Per-route start outcomes never cross browser accounts or chat hosts. */
  const health = new Map<string, RouteHealth>();
  let paidApprovalExpiresAt = 0;
  let approvedRequestId: string | undefined;

  const approvePaidRequest = () => {
    paidApprovalExpiresAt = Date.now() + PAID_APPROVAL_TTL_MS;
  };
  const clearPaidApproval = () => {
    paidApprovalExpiresAt = 0;
    approvedRequestId = undefined;
  };

  const automaticTransport: Transport = {
    ...transport,
    start: async (request, options) => {
      const endpoint = request.payload.endpoint;
      if (
        request.payload.spec ||
        request.payload.agent_id ||
        isAgentsEndpoint(endpoint) ||
        isAssistantsEndpoint(endpoint)
      ) {
        return transport.start(request, options);
      }

      let candidates: ModelRouteCandidate[];
      const paidRequest = !selection.ok;
      if (selection.ok) {
        candidates = rankedByObservedHealth([selection.model, ...selection.alternatives], health);
      } else {
        const requestId = request.payload.clientRequestId;
        if (
          selection.paid == null ||
          !requestId ||
          (approvedRequestId !== requestId && paidApprovalExpiresAt <= Date.now())
        ) {
          throw new Error(
            selection.paid == null ? 'CHAT_NO_AVAILABLE_MODEL' : 'CHAT_PAID_MODEL_CONSENT_REQUIRED',
          );
        }
        if (approvedRequestId !== requestId) {
          approvedRequestId = requestId;
          paidApprovalExpiresAt = 0;
        }
        candidates = [selection.paid];
      }

      let lastError: unknown;
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index] as ModelRouteCandidate;
        const routedRequest = withCandidate(request, candidate, endpointsConfig, paidRequest);
        const startedAt = Date.now();
        try {
          const result = await transport.start(routedRequest, options);
          recordRouteStart(health, candidate, Date.now() - startedAt, true);
          if (paidRequest) {
            approvedRequestId = undefined;
          }
          return result;
        } catch (error) {
          lastError = error;
          recordRouteStart(health, candidate, Date.now() - startedAt, false);
          const hasNext = index < candidates.length - 1;
          if (!hasNext || paidRequest || !canFailOverChatModel(error, options?.signal)) {
            if (paidRequest) {
              approvedRequestId = undefined;
            }
            throw error;
          }
        }
      }
      throw lastError;
    },
  };

  return { transport: automaticTransport, approvePaidRequest, clearPaidApproval };
}
