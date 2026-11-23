import { renderHook } from '@testing-library/react';
import { EModelEndpoint } from 'coderax-data-provider';
import type { TSubmission } from 'coderax-data-provider';
import { defaultChatTransport, useChatTransport } from '~/Providers/ChatTransportContext';
import useResumableSSE from '../useResumableSSE';
import useAdaptiveSSE from '../useAdaptiveSSE';
import useSSE from '../useSSE';

jest.mock('~/Providers/ChatTransportContext', () => ({
  defaultChatTransport: {},
  useChatTransport: jest.fn(),
}));
jest.mock('../useSSE', () => jest.fn());
jest.mock('../useResumableSSE', () => jest.fn(() => ({ streamId: 'stream' })));

const helpers = {
  setMessages: jest.fn(),
  getMessages: jest.fn(),
  setConversation: jest.fn(),
  setIsSubmitting: jest.fn(),
  newConversation: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useChatTransport).mockReturnValue(defaultChatTransport);
});

it.each([
  { endpoint: EModelEndpoint.agents },
  { endpoint: 'custom', endpointType: EModelEndpoint.agents },
  { endpoint: EModelEndpoint.openAI },
])(
  'routes $endpoint through resumable lifecycle, never legacy local cancellation',
  (conversation) => {
    const submission = {
      conversation: { ...conversation, conversationId: 'saved' },
      codeEnvironmentMode: 'attached',
      codeWorkspaces: [{ environmentId: 'vm', workspaceId: 'repo' }],
    } as TSubmission;
    const { rerender } = renderHook(({ value }) => useAdaptiveSSE(value, helpers), {
      initialProps: { value: submission as TSubmission | null },
    });
    expect(useSSE).toHaveBeenLastCalledWith(null, helpers, false, 0, undefined);
    expect(useResumableSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0);
    rerender({ value: null });
    expect(useSSE).toHaveBeenLastCalledWith(null, helpers, false, 0, undefined);
  },
);

it('preserves the Assistants transport and its server abort endpoint', () => {
  const submission = { conversation: { endpoint: EModelEndpoint.assistants } } as TSubmission;
  renderHook(() => useAdaptiveSSE(submission, helpers));
  expect(useSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0, undefined);
  expect(useResumableSSE).toHaveBeenLastCalledWith(null, helpers, false, 0);
});

it('uses the native resumable lifecycle for Work on an Assistants conversation', () => {
  const submission = { conversation: { endpoint: EModelEndpoint.assistants } } as TSubmission;
  renderHook(() => useAdaptiveSSE(submission, helpers, false, 0, true));
  expect(useSSE).toHaveBeenLastCalledWith(null, helpers, false, 0, undefined);
  expect(useResumableSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0);
});

it('keeps the transport selected when the mode changes during an active submission', () => {
  const submission = {
    userMessage: { messageId: 'message-1' },
    conversation: { endpoint: EModelEndpoint.assistants },
  } as TSubmission;
  const { rerender } = renderHook(
    ({ workMode }) => useAdaptiveSSE(submission, helpers, false, 0, workMode),
    { initialProps: { workMode: false } },
  );

  rerender({ workMode: true });

  expect(useSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0, undefined);
  expect(useResumableSSE).toHaveBeenLastCalledWith(null, helpers, false, 0);
});

it('selects Work transport for a new submission after a mode change', () => {
  const chatSubmission = {
    userMessage: { messageId: 'message-1' },
    conversation: { endpoint: EModelEndpoint.assistants },
  } as TSubmission;
  const workSubmission = {
    userMessage: { messageId: 'message-2' },
    conversation: { endpoint: EModelEndpoint.assistants },
  } as TSubmission;
  const { rerender } = renderHook(
    ({ submission, workMode }) => useAdaptiveSSE(submission, helpers, false, 0, workMode),
    { initialProps: { submission: chatSubmission, workMode: false } },
  );

  rerender({ submission: workSubmission, workMode: true });

  expect(useSSE).toHaveBeenLastCalledWith(null, helpers, false, 0, undefined);
  expect(useResumableSSE).toHaveBeenLastCalledWith(workSubmission, helpers, false, 0);
});

it('pins a direct POST to the active turn and keeps restored native runs on their resume path', () => {
  const prepareStreamingStart = jest.fn(() => () => ({
    server: 'https://work.example/api/work/chat',
    payload: { conversationId: 'existing', isContinued: false, isTemporary: false },
  }));
  jest.mocked(useChatTransport).mockReturnValue({ ...defaultChatTransport, prepareStreamingStart });
  const submission = {
    userMessage: { messageId: 'open-code-turn' },
    conversation: { conversationId: 'existing', endpoint: EModelEndpoint.agents },
    endpointOption: { endpoint: EModelEndpoint.agents },
  } as TSubmission;
  const { rerender } = renderHook(({ value }) => useAdaptiveSSE(value, helpers, false, 0, true), {
    initialProps: { value: submission },
  });
  expect(useSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0, expect.any(Function));
  expect(useResumableSSE).toHaveBeenLastCalledWith(null, helpers, false, 0);

  jest.mocked(useChatTransport).mockReturnValue(defaultChatTransport);
  rerender({ value: submission });
  expect(useSSE).toHaveBeenLastCalledWith(submission, helpers, false, 0, expect.any(Function));

  jest.mocked(useChatTransport).mockReturnValue({ ...defaultChatTransport, prepareStreamingStart });
  const restored = {
    ...submission,
    userMessage: { ...submission.userMessage, messageId: 'native-turn' },
    resumeStreamId: 'existing',
  };
  rerender({ value: restored });
  expect(prepareStreamingStart).toHaveBeenCalledTimes(1);
  expect(useSSE).toHaveBeenLastCalledWith(null, helpers, false, 0, undefined);
  expect(useResumableSSE).toHaveBeenLastCalledWith(restored, helpers, false, 0);
});
