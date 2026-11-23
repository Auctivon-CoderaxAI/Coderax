import { useRef } from 'react';
import { createPayload, isAssistantsEndpoint } from 'coderax-data-provider';
import type { TSubmission } from 'coderax-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { Transport } from '~/hooks/Chat/contract';
import { useChatTransport } from '~/Providers/ChatTransportContext';
import useResumableSSE from './useResumableSSE';
import useSSE from './useSSE';

type ChatHelpers = Pick<
  EventHandlerParams,
  'setMessages' | 'getMessages' | 'setConversation' | 'setIsSubmitting' | 'newConversation'
>;

/**
 * Adaptive SSE hook that switches between standard and resumable modes.
 * Native runs resume; Assistants and OpenCode read their POST response as SSE.
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
  const transport = useChatTransport();
  const submissionKey = submission?.userMessage?.messageId
    ? `${submission.userMessage.messageId}:${submission.clientTimestamp ?? ''}`
    : null;
  const transportModeRef = useRef<{
    submissionKey: string | null;
    forceResumable: boolean;
    streamingStart?: ReturnType<NonNullable<Transport['prepareStreamingStart']>>;
  }>({ submissionKey: null, forceResumable });
  if (submissionKey == null || transportModeRef.current.submissionKey !== submissionKey) {
    const resumeStreamId = (submission as (TSubmission & { resumeStreamId?: string }) | null)
      ?.resumeStreamId;
    transportModeRef.current = {
      submissionKey,
      forceResumable,
      streamingStart:
        submission && !resumeStreamId && transport.prepareStreamingStart
          ? transport.prepareStreamingStart(createPayload(submission).payload)
          : undefined,
    };
  }
  const { forceResumable: pinnedForceResumable, streamingStart } = transportModeRef.current;
  const endpoint = submission?.conversation?.endpointType ?? submission?.conversation?.endpoint;
  const resumableEnabled =
    !streamingStart && (pinnedForceResumable || !isAssistantsEndpoint(endpoint));

  useSSE(
    resumableEnabled ? null : submission,
    chatHelpers,
    isAddedRequest,
    runIndex,
    streamingStart,
  );

  const { streamId } = useResumableSSE(
    resumableEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  return { streamId, resumableEnabled };
}
