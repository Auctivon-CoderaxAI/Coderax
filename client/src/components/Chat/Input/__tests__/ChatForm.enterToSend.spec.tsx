import React, { useMemo, useState } from 'react';
import '@testing-library/jest-dom';
import { DndProvider } from 'react-dnd';
import { useForm } from 'react-hook-form';
import { RecoilRoot, useRecoilState } from 'recoil';
import userEvent from '@testing-library/user-event';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { render, screen } from '@testing-library/react';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryKeys, EModelEndpoint } from 'coderax-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TFile, TConversation, ModelRouteCandidate } from 'coderax-data-provider';
import type { ChatModelRouting } from '~/Providers/ChatModelRoutingContext';
import type { ChatFormValues } from '~/common';
import { ChatModelRoutingContext } from '~/Providers/ChatModelRoutingContext';
import { ChatContext, ChatFormProvider } from '~/Providers';
import ConversationStarters from '../ConversationStarters';
import { AuthContextProvider } from '~/hooks/AuthContext';
import ChatForm from '../ChatForm';
import store from '~/store';

const conversation = {
  conversationId: 'new',
  endpoint: EModelEndpoint.openAI,
  model: 'gpt-4o',
  title: 'New Chat',
} as TConversation;

/**
 * The atom default (`atomWithLocalStorage('enterToSend', true)`) always stays
 * true here: these tests prove the composer follows the `enterToSend` prop
 * ChatView passes it, not the atom it used to read directly, so the prop is
 * deliberately set opposite to that default.
 */
const mockAsk = jest.fn();

function Harness({ enterToSend, withStarters }: { enterToSend: boolean; withStarters: boolean }) {
  const [files, setFiles] = useRecoilState(store.filesByIndex(0));
  const [isSubmitting] = useRecoilState(store.isSubmittingFamily(0));
  const [, setFilesLoading] = useState(false);
  const methods = useForm<ChatFormValues>({ defaultValues: { text: '' } });

  const chatHelpers = useMemo(
    () =>
      ({
        index: 0,
        conversation,
        setConversation: () => undefined,
        files,
        setFiles,
        isSubmitting,
        setIsSubmitting: () => undefined,
        filesLoading: false,
        setFilesLoading,
        newConversation: () => undefined,
        handleStopGenerating: () => undefined,
        stopGenerating: () => undefined,
        getMessages: () => undefined,
        setMessages: () => undefined,
        ask: mockAsk,
        regenerate: () => undefined,
        setSiblingIdx: () => undefined,
        showPopover: false,
        setShowPopover: () => undefined,
        abortScroll: false,
        setAbortScroll: () => undefined,
        preset: null,
        setPreset: () => undefined,
        optionSettings: {},
        setOptionSettings: () => undefined,
        handleRegenerate: () => undefined,
        handleContinue: () => undefined,
      }) as unknown as React.ContextType<typeof ChatContext>,
    [files, setFiles, isSubmitting],
  );

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <ChatForm
          index={0}
          isLandingPage={withStarters}
          landingStarters={
            withStarters ? (onSubmit) => <ConversationStarters onSubmit={onSubmit} /> : undefined
          }
          enterToSend={enterToSend}
          footerBelow={false}
          centerFormOnLanding={false}
        />
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

function renderComposer({
  enterToSend,
  routing = null,
}: {
  enterToSend: boolean;
  routing?: ChatModelRouting | null;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<TFile[]>([QueryKeys.files], []);
  queryClient.setQueryData([QueryKeys.endpoints], { [EModelEndpoint.openAI]: { order: 0 } });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <Router>
          <AuthContextProvider authConfig={{ loginRedirect: '', test: true }}>
            <DndProvider backend={HTML5Backend}>
              <ChatModelRoutingContext.Provider value={routing}>
                <Harness enterToSend={enterToSend} withStarters={routing != null} />
              </ChatModelRoutingContext.Provider>
            </DndProvider>
          </AuthContextProvider>
        </Router>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('ChatForm enterToSend prop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('follows the prop when it disagrees with the persisted default', async () => {
    renderComposer({ enterToSend: false });

    const textarea = await screen.findByTestId('text-input');
    await userEvent.type(textarea, 'hi');

    const hint = document.getElementById('composer-hint-0') as HTMLElement;
    expect(hint).toHaveTextContent('to send');
    expect(hint).toHaveTextContent('for newline');
    expect(hint).not.toHaveTextContent('Enter to send');
  }, 20000);

  test('reflects the prop when it agrees with the persisted default', async () => {
    renderComposer({ enterToSend: true });

    const textarea = await screen.findByTestId('text-input');
    await userEvent.type(textarea, 'hi');

    const hint = document.getElementById('composer-hint-0') as HTMLElement;
    expect(hint).toHaveTextContent('Enter to send');
  }, 20000);
});

test('holds a landing starter until the paid model is approved', async () => {
  const approvePaidRequest = jest.fn();
  const unexpectedTransportCall = () => {
    throw new Error('The fixture should submit through ChatContext.ask');
  };
  const paidModel: ModelRouteCandidate = {
    id: 'paid-test-model',
    label: 'Paid test model',
    free: false,
    local: false,
    capability: 0.5,
    speed: 0.5,
    reliability: 0.5,
    tools: false,
  };
  mockAsk.mockClear();
  renderComposer({
    enterToSend: true,
    routing: {
      approvePaidRequest,
      clearPaidApproval: jest.fn(),
      consentModel: paidModel,
      selection: { ok: false, reason: 'no_free_local_model', paid: paidModel },
      unavailable: false,
      transport: {
        stream: unexpectedTransportCall,
        start: unexpectedTransportCall,
        abort: unexpectedTransportCall,
        abortRun: unexpectedTransportCall,
        steer: unexpectedTransportCall,
        cancelSteer: unexpectedTransportCall,
        armSteer: unexpectedTransportCall,
        listQueued: unexpectedTransportCall,
        enqueue: unexpectedTransportCall,
        cancelQueued: unexpectedTransportCall,
      },
    },
  });

  await userEvent.click(await screen.findByRole('button', { name: 'Help me get started' }));
  expect(
    await screen.findByRole('dialog', { name: 'Use a paid model for this message?' }),
  ).toBeVisible();
  expect(mockAsk).not.toHaveBeenCalled();
  expect(approvePaidRequest).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Continue with paid model' }));
  expect(approvePaidRequest).toHaveBeenCalledTimes(1);
  expect(mockAsk).toHaveBeenCalledTimes(1);
  expect(mockAsk).toHaveBeenCalledWith({ text: 'Help me get started' }, expect.anything());
}, 20000);
