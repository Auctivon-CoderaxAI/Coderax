import { memo, useMemo, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { Constants, buildTree } from 'coderax-data-provider';
import type { TChatProject } from 'coderax-data-provider';
import type { ChatFormValues } from '~/common';
import {
  useScrollbarGutterSeed,
  useAddedResponse,
  useResumeOnLoad,
  useAdaptiveSSE,
  useChatHelpers,
  useQueueDrain,
  useQueuedTurnReveal,
  useLocalize,
} from '~/hooks';
import {
  ChatContext,
  AddedChatContext,
  ChatFormProvider,
  useFileMapContext,
  ComposerRestoreProvider,
} from '~/Providers';
import { MESSAGES_QUERY_STALE_TIME, useGetMessagesByConvoId } from '~/data-provider';
import { centerFormOnLandingAtom, maximizeChatSpaceAtom } from '~/store/chatLayout';
import { QueuedTurnPortalProvider } from './Steering/QueuedTurnPortal';
import ApprovalProvider from './Messages/Content/ApprovalContext';
import { ComposerPreferencesProvider } from './Input/preferences';
import ConversationStarters from './Input/ConversationStarters';
import { landingBandClass, landingColumnClass } from './layout';
import { pendingApprovalActionFamily } from './approval/state';
import ProjectBadge from '~/components/Projects/ProjectBadge';
import { composerLiftFamily } from './Input/Composer/state';
import { OwnerTextProvider } from './Messages/PrivateText';
import Footer, { useConfiguredFooter } from './Footer';
import TranscriptSkeleton from './Messages/Loading';
import { AskAnswerHostProvider } from './ask/state';
import MessagesView from './Messages/MessagesView';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import { TraceSurface } from './Trace';
import Landing from './Landing';
import Header from './Header';
import { cn } from '~/utils';
import store from '~/store';


function ChatView({
  index = 0,
  project,
  routePending = false,
  workMode = false,
  workCanSubmit = false,
  handoffDraft,
  onWorkHandoffDraftApplied,
}: {
  index?: number;
  project?: TChatProject;
  /** The route is loading another conversation, or failed to. */
  routePending?: boolean;
  /** Work keeps its model selector; Chat selects automatically and shows none. */
  workMode?: boolean;
  workCanSubmit?: boolean;
  /** One-time text staged while a Guest signs into the owner account for Work. */
  handoffDraft?: string | null;
  onWorkHandoffDraftApplied?: () => void;
}) {
  const { conversationId } = useParams();
  const localize = useLocalize();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousConversationId = useRef(conversationId);

  /** A route change unmounts whatever held focus; land it on the new page's heading so a
   *  screen reader announces it. Child effects run first, so a composer that took focus
   *  keeps it. */
  useEffect(() => {
    if (previousConversationId.current === conversationId) {
      return;
    }
    previousConversationId.current = conversationId;
    const active = document.activeElement;
    if (active == null || active === document.body) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [conversationId]);
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const saveDrafts = useRecoilValue(store.saveDrafts);
  const enterToSend = useRecoilValue(store.enterToSend);
  const autoSendText = useRecoilValue(store.autoSendText);
  const speechSettingsInitialized = useRecoilValue(store.speechSettingsInitialized);
  const centerFormOnLanding = useAtomValue(centerFormOnLandingAtom);
  const composerPreferences = useMemo(
    () => ({ enterToSend, autoSendText, speechSettingsInitialized, centerFormOnLanding }),
    [enterToSend, autoSendText, speechSettingsInitialized, centerFormOnLanding],
  );
  /** The same preference `AppChatSurface` hands `MessagesView`, so the skeleton
   *  occupies the column the transcript will replace it in. */
  const maximizeChatSpace = useAtomValue(maximizeChatSpaceAtom);
  const pendingAction = useAtomValue(
    pendingApprovalActionFamily(conversationId ?? Constants.NEW_CONVO),
  );

  /** The welcome screen reserves the message column's scrollbar band before any
   *  column exists to measure it (see the column's class list below). */
  useScrollbarGutterSeed();

  /** A conversation carries a footer only for configured content, and the
   *  composer's clearance has to account for the bar when it does — including
   *  before the config answers, so a cold load does not jump. */
  const configuredFooter = useConfiguredFooter();

  /** Room an open composer popover needs below the composer; see the atom. */
  const composerLift = useAtomValue(composerLiftFamily(index));

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  const fileMap = useFileMapContext();

  const {
    data: messages = null,
    isLoading,
    isFetching,
  } = useGetMessagesByConvoId(
    conversationId ?? '',
    {
      enabled: !!conversationId && conversationId !== Constants.SEARCH,
      /** Reuse the route's transcript prefetch during initial setup. Explicit
       * navigation invalidation still makes cached conversations refetch. */
      staleTime: MESSAGES_QUERY_STALE_TIME,
      refetchOnMount: true,
    },
    { isStreaming: isSubmitting },
  );
  const messagesTree = useMemo(() => {
    const dataTree = buildTree({ messages, fileMap });
    return dataTree?.length === 0 ? null : (dataTree ?? null);
  }, [messages, fileMap]);

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse();

  const activeConversation =
    chatHelpers.conversation?.conversationId === conversationId
      ? chatHelpers.conversation
      : undefined;
  const activeSubagentThread = activeConversation?.subagentThread;
  /** Trimmed so a blank or whitespace-only ID never narrows into `badgeProjectId`. */
  const chatProjectId = activeConversation?.chatProjectId?.trim() || undefined;

  useAdaptiveSSE(rootSubmission, chatHelpers, false, index, workMode);

  // Auto-resume if navigating back to conversation with active job.
  // Wait for messages to load AND the warm-cache background revalidation to
  // settle: a stale invalidated cache mounts with isLoading false while the
  // refetch is in flight, and resume must not build from (or race) it.
  useResumeOnLoad(conversationId, chatHelpers.getMessages, index, !isLoading && !isFetching);

  // Show a server-owned queued follow-up as the next user turn as soon as its
  // predecessor completes, ahead of the receipt and active-job polls.
  const revealQueuedTurn = useQueuedTurnReveal(conversationId, index);

  // Auto-send queued follow-up messages once a run finishes cleanly.
  useQueueDrain(index, conversationId, chatHelpers.ask, revealQueuedTurn);

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);

  /** A footer bar renders beneath the composer on the welcome screen always, and
   *  in a conversation when the deployment configured one. The shell already
   *  carried that answer, so this is the same value before and after the config
   *  resolves. */
  const footerBelow = isLandingPage || configuredFooter;
  const isNavigating = (!messagesTree || messagesTree.length === 0) && conversationId != null;
  const isProjectLandingPage = isLandingPage && project != null;

  const badgeProjectId = !isLandingPage && chatProjectId ? chatProjectId : undefined;
  const hasProjectBadge = badgeProjectId != null;

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <TranscriptSkeleton fullWidth={maximizeChatSpace} hasProjectBadge={hasProjectBadge} />;
  } else if ((isLoading || isNavigating) && !isLandingPage) {
    content = <TranscriptSkeleton fullWidth={maximizeChatSpace} hasProjectBadge={hasProjectBadge} />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} messages={messages} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  let chatFormPlaceholder: string | undefined;
  if (isProjectLandingPage && project) {
    chatFormPlaceholder = localize('com_ui_new_chat_in_project', { name: project.name });
  } else if (isLandingPage) {
    chatFormPlaceholder = localize('com_cyvox_home_chat_placeholder');
  }

  // Recoil conversation can lag the route during navigation; only announce a
  // title that belongs to the conversation currently in the URL. Reuses the
  // same route-matched conversation that gates the project badge and thread.
  const conversationTitle = activeConversation?.title?.trim() || undefined;
  const pageHeading =
    isLandingPage || !conversationTitle ? localize('com_ui_new_chat') : conversationTitle;
  const parentConversationId = activeSubagentThread?.parentConversationId;
  /** Durable child threads are an execution record owned by their parent agent.
   * Human continuation is a separate future fork/promotion flow, never an
   * in-place mutation of this canonical child transcript. */
  const isSubagentThreadReadOnly = activeSubagentThread != null;

  return (
    <AskAnswerHostProvider saveDrafts={saveDrafts}>
      <ChatFormProvider {...methods}>
        <ComposerRestoreProvider>
          <QueuedTurnPortalProvider>
            <ChatContext.Provider value={chatHelpers}>
              <AddedChatContext.Provider value={addedChatHelpers}>
                <ApprovalProvider pendingAction={pendingAction}>
                  <Presentation routePending={routePending}>
                    <TraceSurface conversationId={conversationId}>
                      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
                        {pageHeading}
                      </h1>
                      {/* Marks the header's controls as this pane's, so a pane-scoped
                        shortcut pressed from them acts here, not on the first pane. */}
                      <div data-chat-pane-portal={index} className="contents">
                        <Header
                          parentConversationId={parentConversationId}
                          readOnly={isSubagentThreadReadOnly}
                          mode={workMode ? 'work' : 'chat'}
                        />
                      </div>
                      {badgeProjectId && <ProjectBadge projectId={badgeProjectId} />}
                      <>
                        <div
                          data-chat-pane={index}
                          style={
                            isLandingPage && composerLift > 0
                              ? { transform: `translateY(-${composerLift}px)` }
                              : undefined
                          }
                          className={cn(
                            'flex flex-col',
                            isLandingPage
                              ? /* The gutter is reserved once per state, wherever the
                               centring happens. A conversation centres the composer
                               inside the band below, against a message column that
                               holds the scrollbar band back; the landing page centres
                               this whole column instead, greeting and composer
                               together, so it holds the same band back here. Without
                               it the composer lands 4px right of where a conversation
                               puts it and slides sideways on the way in. */
                                cn('scrollbar-gutter-spacer', landingColumnClass)
                              : 'h-full overflow-y-auto',
                            hasProjectBadge && 'pt-9',
                          )}
                        >
                          <OwnerTextProvider
                            messages={messages}
                            conversationId={conversationId}
                            isSubmitting={chatHelpers.isSubmitting}
                          >
                            {content}
                          </OwnerTextProvider>
                          {/* Named + opaque so a view transition (the ask_user_question
                        popover ⇄ chat-card morph) paints the whole composer band
                        over the travelling card instead of letting it show
                        through below the composer. The background matches the
                        page, so normal rendering is unchanged. The named surface
                        is a stacking context; keep it above positioned tool glyphs
                        so they cannot paint through the approval preview. */}
                          <div
                            className={cn(
                              'bg-surface-canvas relative z-10 w-full [view-transition-name:chat-form]',
                              !isLandingPage && 'scrollbar-gutter-spacer',
                              isLandingPage && cn(landingBandClass, 'transition-all duration-200'),
                            )}
                          >
                            {isLandingPage && <ConversationStarters />}
                            {isSubagentThreadReadOnly ? (
                              <div
                                className="text-text-secondary mx-auto w-full max-w-3xl px-4 py-3 text-center text-sm xl:max-w-4xl"
                                role="note"
                              >
                                {localize('com_ui_subagent_thread_read_only')}
                              </div>
                            ) : (
                              <ComposerPreferencesProvider value={composerPreferences}>
                                <ChatForm
                                  index={index}
                                  routePending={routePending}
                                  workMode={workMode}
                                  workCanSubmit={workCanSubmit}
                                  handoffDraft={handoffDraft}
                                  onWorkHandoffDraftApplied={onWorkHandoffDraftApplied}
                                  placeholder={chatFormPlaceholder}
                                  project={isProjectLandingPage ? project : undefined}
                                  isLandingPage={isLandingPage}
                                  footerBelow={footerBelow}
                                />
                              </ComposerPreferencesProvider>
                            )}
                            {/* The generic disclaimer and the policy links are the
                              welcome screen's; a deployment's own footer stays
                              with the conversation that always showed it. */}
                            {!isLandingPage && configuredFooter && <Footer configuredOnly />}
                          </div>
                        </div>
                        {isLandingPage && <Footer />}
                      </>
                    </TraceSurface>
                  </Presentation>
                </ApprovalProvider>
              </AddedChatContext.Provider>
            </ChatContext.Provider>
          </QueuedTurnPortalProvider>
        </ComposerRestoreProvider>
      </ChatFormProvider>
    </AskAnswerHostProvider>
  );
}

export default memo(ChatView);
