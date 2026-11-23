import { useRef } from 'react';
import { isAssistantsEndpoint } from 'coderax-data-provider';
import type { TSubmission } from 'coderax-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import useResumableSSE from './useResumableSSE';
import useSSE from './useSSE';

type ChatHelpers = Pick<
  EventHandlerParams,
  'setMessages' | 'getMessages' | 'setConversation' | 'setIsSubmitting' | 'newConversation'
>;

/**
 * Adaptive SSE hook that switches between standard and resumable modes.
 * Uses resumable streams by default, falls back to standard SSE for assistants endpoints.
 *
 * Note: Both hooks are always called to comply with React's Rules of Hooks.
 * We pass null submission to the inactive one.
 */
export default function useAdaptiveSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
  forceResumable = false,
) {
  const submissionKey = submission?.userMessage?.messageId
    ? `${submission.userMessage.messageId}:${submission.clientTimestamp ?? ''}`
    : null;
  const transportModeRef = useRef({ submissionKey, forceResumable });
  if (submissionKey == null || transportModeRef.current.submissionKey !== submissionKey) {
    transportModeRef.current = { submissionKey, forceResumable };
  }
  const pinnedForceResumable = transportModeRef.current.forceResumable;
  const endpoint = submission?.conversation?.endpoint;
  const endpointType = submission?.conversation?.endpointType;
  const actualEndpoint = endpointType ?? endpoint;
  const isAssistants = !pinnedForceResumable && isAssistantsEndpoint(actualEndpoint);
  const resumableEnabled = !isAssistants;

  useSSE(resumableEnabled ? null : submission, chatHelpers, isAddedRequest, runIndex);

  const { streamId } = useResumableSSE(
    resumableEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  return { streamId, resumableEnabled };
}
