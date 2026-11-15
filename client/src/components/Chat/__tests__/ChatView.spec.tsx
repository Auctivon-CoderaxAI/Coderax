import React from 'react';
import '@testing-library/jest-dom';
import { getDefaultStore } from 'jotai';
import { Constants } from 'coderax-data-provider';
import { render, screen } from 'test/layout-test-utils';
import { maximizeChatSpaceAtom } from '~/store/chatLayout';
import ChatView from '../ChatView';

const mockParams = jest.fn();
const mockConversation = jest.fn();
const mockChatFormProps = jest.fn();
/** Lets a test control the transcript query; unset falls back to "no messages, settled". */
const mockMessagesQuery = jest.fn();
const defaultMessagesQuery = { data: null, isLoading: false, isFetching: false };
/** Any parent ID that is not another message's ID makes the message a tree root. */
const ROOT_PARENT_ID = '00000000-0000-0000-0000-000000000000';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams(),
}));

/** Auth is out of scope for heading selection; keep the shared harness wrappers. */
jest.mock('~/hooks/AuthContext', () => ({
  AuthContextProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({ isAuthenticated: false, user: null, roles: {} }),
}));

jest.mock('~/data-provider', () => ({
  useGetMessagesByConvoId: () => mockMessagesQuery() ?? defaultMessagesQuery,
  useProjectQuery: () => ({ data: undefined }),
}));

/**
 * Heading selection only needs route params + conversation state. Stub the chat
 * helper surface so the suite can inject matching vs stale IDs without standing
 * up SSE, message trees, or full ChatRoute synchronization.
 */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => (key === 'com_ui_new_chat' ? 'New chat' : key),
  useChatHelpers: () => ({ conversation: mockConversation() }),
  useAddedResponse: () => ({}),
  useAdaptiveSSE: jest.fn(),
  useResumeOnLoad: jest.fn(),
  useQueueDrain: jest.fn(),
  useQueuedTurnReveal: jest.fn(),
  useScrollbarGutterSeed: jest.fn(),
}));

jest.mock('../Presentation', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../Header', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('../Footer', () => ({
  __esModule: true,
  default: () => <div />,
  useConfiguredFooter: () => false,
}));
jest.mock('../Landing', () => ({
  __esModule: true,
  default: () => <div data-testid="landing" />,
}));
jest.mock('../Messages/MessagesView', () => ({
  __esModule: true,
  default: () => <div data-testid="messages-view" />,
}));
jest.mock('../Input/ChatForm', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { useComposerPreferences } = jest.requireActual('../Input/preferences');
    mockChatFormProps({ ...useComposerPreferences(), ...props });
    return <div />;
  },
}));
jest.mock('../Input/ConversationStarters', () => ({ __esModule: true, default: () => <div /> }));
/** Exposes the received `projectId` so tests can assert which project the badge links to. */
jest.mock('~/components/Projects/ProjectBadge', () => ({
  __esModule: true,
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-badge" data-project-id={projectId} />
  ),
}));

describe('ChatView page heading', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({});
    mockConversation.mockReturnValue(null);
  });

  test('exposes a single h1 to assistive technology', () => {
    render(<ChatView />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
  });

  test('announces a localized new chat heading on the landing page', () => {
    render(<ChatView />);

    expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
  });

  test('uses the conversation title once a conversation is open', () => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });

    render(<ChatView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();
  });

  test('falls back to the localized heading when a title is blank', () => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: '   ' });

    render(<ChatView />);

    expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
  });

  test('prefers the localized heading over a stale title on the landing page', () => {
    mockConversation.mockReturnValue({ conversationId: 'new', title: 'New Chat' });

    render(<ChatView />);

    expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
  });

  test('ignores a Recoil title that belongs to a different conversation than the route', () => {
    mockParams.mockReturnValue({ conversationId: 'convo-2' });
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Previous chat' });

    render(<ChatView />);

    expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Previous chat' }),
    ).not.toBeInTheDocument();
  });
});

describe('ChatView route focus', () => {
  beforeEach(() => {
    mockConversation.mockReturnValue(null);
  });

  test('moves focus to the page heading when a route change leaves it on the body', () => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    const { rerender } = render(<ChatView />);
    (document.activeElement as HTMLElement | null)?.blur();

    mockParams.mockReturnValue({ conversationId: 'convo-2' });
    rerender(<ChatView />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  test('leaves focus alone on first render and when something else holds it', () => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    const { rerender } = render(<ChatView />);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    mockParams.mockReturnValue({ conversationId: 'convo-2' });
    rerender(<ChatView />);

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('ChatView composer preferences', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({});
    mockConversation.mockReturnValue(null);
    mockChatFormProps.mockClear();
    localStorage.clear();
  });

  /** ChatView owns the preference reads and hands them to the composer through
   *  `ComposerPreferencesProvider`; the mock records context and props together. */
  test('reads the persisted enterToSend preference and provides it to ChatForm', () => {
    localStorage.setItem('enterToSend', JSON.stringify(false));

    render(<ChatView />);

    expect(mockChatFormProps).toHaveBeenCalledWith(expect.objectContaining({ enterToSend: false }));
  });

  /** The same boundary for the dictation preferences: ChatForm consumes them
   *  but ChatView owns the reads. */
  test('passes the persisted Auto Send Text preference and the speech init state', () => {
    localStorage.setItem('autoSendText', JSON.stringify(3));

    render(<ChatView />);

    expect(mockChatFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ autoSendText: 3, speechSettingsInitialized: false }),
    );
  });

  test.each([true, false])('passes routePending=%p into ChatForm', (routePending) => {
    render(<ChatView routePending={routePending} />);
    expect(mockChatFormProps).toHaveBeenCalledWith(expect.objectContaining({ routePending }));
  });

  test('falls back to the atom default when nothing is persisted', () => {
    render(<ChatView />);

    expect(mockChatFormProps).toHaveBeenCalledWith(expect.objectContaining({ enterToSend: true }));
  });
});

describe('ChatView transcript skeleton', () => {
  beforeEach(() => {
    /** A routed conversation with no tree yet is navigating, so the skeleton renders. */
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
    localStorage.clear();
  });

  test('uses the reading column by default', () => {
    render(<ChatView />);

    const skeleton = screen.getByTestId('transcript-skeleton');
    expect(skeleton.querySelector('.md\\:max-w-3xl')).not.toBeNull();
    expect(skeleton.querySelector('.max-w-full')).toBeNull();
  });

  test('follows the persisted full-width chat preference', () => {
    getDefaultStore().set(maximizeChatSpaceAtom, true);

    render(<ChatView />);

    const skeleton = screen.getByTestId('transcript-skeleton');
    expect(skeleton.querySelector('.max-w-full')).not.toBeNull();
    expect(skeleton.querySelector('.md\\:max-w-3xl')).toBeNull();
    getDefaultStore().set(maximizeChatSpaceAtom, false);
  });

  test('renders Landing instead of the skeleton for a new conversation', () => {
    mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
    mockConversation.mockReturnValue({ conversationId: Constants.NEW_CONVO, title: 'New Chat' });

    render(<ChatView />);

    expect(screen.getByTestId('landing')).toBeInTheDocument();
    expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
  });
});

/**
 * The project badge offset lives on the `data-chat-pane` container, so the
 * skeleton and the loaded transcript share it and nothing shifts on load.
 */
describe('ChatView project badge offset', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
  });

  afterEach(() => {
    mockMessagesQuery.mockReset();
  });

  test('pads the chat pane under the badge while a project conversation loads', () => {
    mockConversation.mockReturnValue({
      conversationId: 'convo-1',
      title: 'Deploy checklist',
      chatProjectId: 'project-1',
    });

    const { container } = render(<ChatView />);

    expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('project-badge')).toBeInTheDocument();
    expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
    expect(screen.getByTestId('transcript-skeleton')).toHaveAttribute('data-project-badge', 'true');
  });

  test('does not pad the chat pane without a chatProjectId', () => {
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });

    const { container } = render(<ChatView />);

    expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
    expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
  });

  /**
   * `chatProjectId` is normalized with `?.trim() || undefined`, so a missing,
   * null, empty or whitespace-only value never narrows into `badgeProjectId`.
   * Outside the landing page, neither the skeleton nor the loaded transcript may
   * show the badge, its `pt-9` offset, or the skeleton's `data-project-badge` attribute.
   */
  describe.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a tab/newline-only string', '\t\n '],
  ])('when chatProjectId is %s', (_label, chatProjectId) => {
    beforeEach(() => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId,
      });
    });

    test('omits the badge while the conversation loads', () => {
      const { container } = render(<ChatView />);

      const skeleton = screen.getByTestId('transcript-skeleton');
      expect(skeleton).not.toHaveAttribute('data-project-badge', 'true');
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });

    test('omits the badge once the transcript loads', () => {
      mockMessagesQuery.mockReturnValue({
        data: [
          { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
          { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
        ],
        isLoading: false,
        isFetching: false,
      });

      const { container } = render(<ChatView />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });
  });

  /**
   * `hasProjectBadge` is `!isLandingPage && !!chatProjectId`. On the landing
   * page a new chat may already belong to a project, but the badge and its
   * offset are a transcript concern, so neither applies there.
   */
  describe('on the landing page', () => {
    test('omits the badge and offset for a NEW_CONVO that carries a chatProjectId', () => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });

      const { container } = render(<ChatView />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });

    test('omits the badge and offset once the NEW_CONVO query settles', () => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });

      const { container } = render(<ChatView />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });

    /** Leaving a project conversation for a new chat in the same project must
     *  drop the offset, or the landing column would sit 36px low. */
    test('drops the badge and offset when returning to the landing page', () => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });

      const { container, rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('project-badge')).toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');

      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });

      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });

    /** A NEW_CONVO query that is still fetching must not be mistaken for a
     *  loading transcript: Landing renders, and the project's chatProjectId
     *  yields neither the skeleton, the badge, nor the pane offset. Covers both
     *  a cold load and a background refetch of a settled query. */
    test.each([
      ['a cold load', { data: null, isLoading: true, isFetching: true }],
      ['a background refetch', { data: null, isLoading: false, isFetching: true }],
    ])('shows no skeleton, badge or offset during %s of a NEW_CONVO', (_label, query) => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue(query);

      const { container } = render(<ChatView />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(container.querySelector('[data-project-badge]')).toBeNull();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });
  });

  /**
   * The reverse transition: from a project's landing page into one of its
   * conversations. The badge and the `pt-9` offset must appear as soon as the
   * route-matched conversation is known (while the skeleton shows) and stay
   * when the transcript replaces it, so nothing shifts on load. ChatView is
   * memoized, so each rerender toggles `routePending` to force a re-read.
   */
  describe('entering a project conversation from the landing page', () => {
    const loadedMessages = [
      { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
      { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
    ];

    const openProjectLanding = () => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });
    };

    test('adds the badge and offset while the project transcript loads', () => {
      openProjectLanding();
      const { container, rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');

      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      rerender(<ChatView routePending={false} />);

      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.getByTestId('transcript-skeleton')).toHaveAttribute('data-project-badge', 'true');
      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
    });

    test('keeps the badge and offset once the transcript replaces the skeleton', () => {
      openProjectLanding();
      const { container, rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending={false} />);

      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');

      mockMessagesQuery.mockReturnValue({
        data: loadedMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('project-badge')).toHaveLength(1);
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
    });

    /** Recoil lags the route: while it still holds the NEW_CONVO, the route's
     *  conversation is unknown, so the badge and offset wait for it. */
    test('waits for Recoil to match the route before adding the badge', () => {
      openProjectLanding();
      const { container, rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('transcript-skeleton')).not.toHaveAttribute('data-project-badge');
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');

      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      rerender(<ChatView routePending />);

      expect(screen.getByTestId('project-badge')).toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
    });
  });

  /**
   * The forward transition: from a loaded project conversation back to the
   * landing page. Whatever form the new-chat route takes, the badge, the
   * `pt-9` offset and the skeleton attribute must all go, or the landing
   * column would sit 36px low under a badge that no longer applies.
   */
  describe('leaving a project conversation for the landing page', () => {
    const loadedMessages = [
      { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
      { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
    ];

    const openLoadedProjectConversation = () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({
        data: loadedMessages,
        isLoading: false,
        isFetching: false,
      });
    };

    const expectNoBadgeOrOffset = (container: HTMLElement) => {
      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-project-badge]')).toBeNull();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    };

    test.each([
      ['a settled', { data: null, isLoading: false, isFetching: false }],
      ['a still-loading', { data: null, isLoading: true, isFetching: true }],
    ])('removes the badge and offset for %s NEW_CONVO query', (_label, query) => {
      openLoadedProjectConversation();
      const { container, rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');

      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({
        conversationId: Constants.NEW_CONVO,
        title: 'New Chat',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue(query);
      rerender(<ChatView routePending={false} />);

      expectNoBadgeOrOffset(container);
    });

    /** Recoil may still hold the project conversation; the route alone decides
     *  it is the landing page, so the stale chatProjectId must not apply. */
    test('removes the badge and offset when the route drops its ID while Recoil lags', () => {
      openLoadedProjectConversation();
      const { container, rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({});
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });
      rerender(<ChatView routePending={false} />);

      expectNoBadgeOrOffset(container);
    });
  });

  /**
   * Switching directly between conversations in different projects. When
   * Recoil matches the new route in the same render, the badge must follow the
   * new chatProjectId while `pt-9` stays on every render, so the column never
   * jumps up and back down.
   */
  describe('switching between conversations in different projects', () => {
    const firstMessages = [
      { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
      { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
    ];
    const secondMessages = [
      { messageId: 'n1', parentMessageId: ROOT_PARENT_ID, text: 'Notes?', isCreatedByUser: true },
      { messageId: 'n2', parentMessageId: 'n1', text: 'Here they are', isCreatedByUser: false },
    ];

    const openFirstProjectConversation = () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({
        data: firstMessages,
        isLoading: false,
        isFetching: false,
      });
    };

    test('moves the badge to the new project and keeps the offset on every render', () => {
      openFirstProjectConversation();
      const { container, rerender } = render(<ChatView routePending />);
      const pane = () => container.querySelector('[data-chat-pane]');
      const offsetHistory: boolean[] = [pane()?.classList.contains('pt-9') ?? false];

      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');

      /** Second conversation loads with Recoil already matching the route. */
      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-2',
        title: 'Release notes',
        chatProjectId: 'project-2',
      });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending={false} />);
      offsetHistory.push(pane()?.classList.contains('pt-9') ?? false);

      expect(screen.getByTestId('transcript-skeleton')).toHaveAttribute('data-project-badge', 'true');
      const loadingBadges = screen.getAllByTestId('project-badge');
      expect(loadingBadges).toHaveLength(1);
      expect(loadingBadges[0]).toHaveAttribute('data-project-id', 'project-2');

      /** Transcript resolves. */
      mockMessagesQuery.mockReturnValue({
        data: secondMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending />);
      offsetHistory.push(pane()?.classList.contains('pt-9') ?? false);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      const loadedBadges = screen.getAllByTestId('project-badge');
      expect(loadedBadges).toHaveLength(1);
      expect(loadedBadges[0]).toHaveAttribute('data-project-id', 'project-2');

      expect(offsetHistory).toEqual([true, true, true]);
    });

    /** A cached transcript for the second project renders at once; the badge
     *  swaps projects in that single render without dropping the offset. */
    test('swaps the badge in one render when the new transcript is cached', () => {
      openFirstProjectConversation();
      const { container, rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-2',
        title: 'Release notes',
        chatProjectId: 'project-2',
      });
      mockMessagesQuery.mockReturnValue({
        data: secondMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-2');
      expect(container.querySelector('[data-project-id="project-1"]')).toBeNull();
      expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
    });

    /** Moving to a conversation outside any project removes the offset. */
    test('removes the badge and offset when the new conversation has no project', () => {
      openFirstProjectConversation();
      const { container, rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('transcript-skeleton')).not.toHaveAttribute('data-project-badge');
      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
    });

    /**
     * Recoil lags the route: the URL already points at convo-2 while Recoil
     * still holds convo-1 (project-1). The route-matched conversation is
     * unknown, so the stale project-1 badge must never render for convo-2, and
     * the offset must always agree with the badge (no `pt-9` without a badge,
     * or vice versa). Within each phase, repeated renders must not toggle it.
     */
    describe('while Recoil lags behind the route', () => {
      type Snapshot = { badgeIds: (string | null)[]; offset: boolean };

      const snapshot = (container: HTMLElement): Snapshot => ({
        badgeIds: screen
          .queryAllByTestId('project-badge')
          .map((badge) => badge.getAttribute('data-project-id')),
        offset: container.querySelector('[data-chat-pane]')?.classList.contains('pt-9') ?? false,
      });

      const expectOffsetMatchesBadge = (snap: Snapshot) => {
        expect(snap.badgeIds.length <= 1).toBe(true);
        expect(snap.offset).toBe(snap.badgeIds.length === 1);
      };

      test('never shows the stale badge for the new route and keeps the offset stable per phase', () => {
        openFirstProjectConversation();
        const { container, rerender } = render(<ChatView routePending />);
        const history: Snapshot[] = [snapshot(container)];

        expect(history[0]).toEqual({ badgeIds: ['project-1'], offset: true });

        /** Lag phase: route moves, Recoil still holds convo-1. Two renders. */
        mockParams.mockReturnValue({ conversationId: 'convo-2' });
        mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
        rerender(<ChatView routePending={false} />);
        history.push(snapshot(container));
        rerender(<ChatView routePending />);
        history.push(snapshot(container));

        expect(container.querySelector('[data-project-id="project-1"]')).toBeNull();
        expect(screen.getByTestId('transcript-skeleton')).not.toHaveAttribute('data-project-badge');

        /** Catch-up phase: Recoil matches convo-2 while the skeleton shows. */
        mockConversation.mockReturnValue({
          conversationId: 'convo-2',
          title: 'Release notes',
          chatProjectId: 'project-2',
        });
        rerender(<ChatView routePending={false} />);
        history.push(snapshot(container));

        expect(screen.getByTestId('transcript-skeleton')).toHaveAttribute(
          'data-project-badge',
          'true',
        );

        /** Transcript resolves: the offset must not flicker on the swap. */
        mockMessagesQuery.mockReturnValue({
          data: secondMessages,
          isLoading: false,
          isFetching: false,
        });
        rerender(<ChatView routePending />);
        history.push(snapshot(container));
        rerender(<ChatView routePending={false} />);
        history.push(snapshot(container));

        expect(screen.getByTestId('messages-view')).toBeInTheDocument();

        history.forEach(expectOffsetMatchesBadge);
        /** project-1 appears only on the initial render, before the route moved. */
        history.slice(1).forEach((snap) => expect(snap.badgeIds).not.toContain('project-1'));
        expect(history.map((snap) => snap.offset)).toEqual([true, false, false, true, true, true]);
        expect(history.slice(3).map((snap) => snap.badgeIds)).toEqual([
          ['project-2'],
          ['project-2'],
          ['project-2'],
        ]);
      });

      /** A cached convo-2 transcript renders at once, but the badge still waits
       *  for Recoil; the stale project must not ride along with the new transcript. */
      test('withholds the stale badge from a cached transcript until Recoil matches', () => {
        openFirstProjectConversation();
        const { container, rerender } = render(<ChatView routePending />);

        mockParams.mockReturnValue({ conversationId: 'convo-2' });
        mockMessagesQuery.mockReturnValue({
          data: secondMessages,
          isLoading: false,
          isFetching: false,
        });
        rerender(<ChatView routePending={false} />);

        expect(screen.getByTestId('messages-view')).toBeInTheDocument();
        expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
        expect(container.querySelector('[data-project-id="project-1"]')).toBeNull();
        expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');

        mockConversation.mockReturnValue({
          conversationId: 'convo-2',
          title: 'Release notes',
          chatProjectId: 'project-2',
        });
        rerender(<ChatView routePending />);

        const badges = screen.getAllByTestId('project-badge');
        expect(badges).toHaveLength(1);
        expect(badges[0]).toHaveAttribute('data-project-id', 'project-2');
        expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
      });

      /** Recoil catching up to a whitespace-only project ID is the same as no
       *  project: neither the stale badge nor a blank one, and no offset. */
      test('shows no badge when Recoil catches up with a whitespace-only chatProjectId', () => {
        openFirstProjectConversation();
        const { container, rerender } = render(<ChatView routePending />);

        mockParams.mockReturnValue({ conversationId: 'convo-2' });
        mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
        rerender(<ChatView routePending={false} />);

        mockConversation.mockReturnValue({
          conversationId: 'convo-2',
          title: 'Release notes',
          chatProjectId: '   ',
        });
        rerender(<ChatView routePending />);

        expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
        expect(screen.getByTestId('transcript-skeleton')).not.toHaveAttribute('data-project-badge');
        expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
      });
    });
  });

  /** `hasProjectBadge` requires both conditions: a chatProjectId alone is not
   *  enough on the landing page, so the badge, the offset and the skeleton
   *  attribute are all absent there. */
  test('does not render the badge on the landing page even with a chatProjectId', () => {
    mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
    mockConversation.mockReturnValue({
      conversationId: Constants.NEW_CONVO,
      title: 'New Chat',
      chatProjectId: 'project-1',
    });

    const { container } = render(<ChatView />);

    expect(screen.getByTestId('landing')).toBeInTheDocument();
    expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
    expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
  });

  /** The same offset carries over to the loaded transcript, so nothing shifts
   *  when MessagesView replaces the skeleton. */
  test('keeps the badge and the pane offset once the project transcript loads', () => {
    mockConversation.mockReturnValue({
      conversationId: 'convo-1',
      title: 'Deploy checklist',
      chatProjectId: 'project-1',
    });
    mockMessagesQuery.mockReturnValue({
      data: [
        { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
        { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
      ],
      isLoading: false,
      isFetching: false,
    });

    const { container } = render(<ChatView />);

    expect(screen.getByTestId('messages-view')).toBeInTheDocument();
    expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-badge')).toBeInTheDocument();
    expect(container.querySelector('[data-chat-pane]')).toHaveClass('pt-9');
  });

  /** `badgeProjectId` is the narrowed `chatProjectId`, so the badge must receive
   *  exactly the route-matched conversation's project. */
  describe('projectId prop', () => {
    const loadedMessages = [
      { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
      { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
    ];

    test('passes the chatProjectId while the conversation loads', () => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });

      render(<ChatView />);

      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');
    });

    test('passes the chatProjectId once the transcript loads', () => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({
        data: loadedMessages,
        isLoading: false,
        isFetching: false,
      });

      render(<ChatView />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');
    });

    test('follows the new conversation project after switching routes', () => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });

      const { rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('project-badge')).toHaveAttribute('data-project-id', 'project-1');

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-2',
        title: 'Release notes',
        chatProjectId: 'project-2',
      });

      rerender(<ChatView routePending={false} />);

      const badges = screen.getAllByTestId('project-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveAttribute('data-project-id', 'project-2');
    });
  });
});

describe('ChatView composer column', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ conversationId: 'convo-1' });
    mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
  });

  /* The composer's in-flight steer overlay is painted above the composer's top
     edge, so a scroll container here would clip it out of sight for the whole
     run. The gutter that lines the column up with the messages has to be
     reserved with padding instead. */
  test('reserves the message column gutter without becoming a scroll container', () => {
    const { container } = render(<ChatView />);

    const composerColumn = container.querySelector('.scrollbar-gutter-spacer');

    expect(composerColumn).not.toBeNull();
    expect(composerColumn).not.toHaveClass('overflow-y-auto');
    expect(composerColumn).not.toHaveClass('scrollbar-gutter-stable');
  });

  test('layers composer overlays above positioned tool glyphs in the message column', () => {
    const { container } = render(<ChatView />);

    const composerColumn = container.querySelector('.scrollbar-gutter-spacer');

    expect(composerColumn).toHaveClass('[view-transition-name:chat-form]');
    expect(composerColumn).toHaveClass('relative', 'z-10');
  });
});

/**
 * Content selection in ChatView:
 * - New conversation (no route ID or NEW_CONVO, empty tree) -> Landing
 * - Existing conversation still loading or without a tree yet -> TranscriptSkeleton
 * - Existing conversation with messages -> MessagesView
 */
describe('ChatView rendering paths', () => {
  const existingMessages = [
    { messageId: 'm1', parentMessageId: ROOT_PARENT_ID, text: 'Hi', isCreatedByUser: true },
    { messageId: 'm2', parentMessageId: 'm1', text: 'Hello', isCreatedByUser: false },
  ];

  beforeEach(() => {
    mockParams.mockReturnValue({});
    mockConversation.mockReturnValue(null);
    mockChatFormProps.mockClear();
    mockMessagesQuery.mockReset();
    localStorage.clear();
  });

  afterAll(() => {
    mockMessagesQuery.mockReset();
  });

  describe('new conversation', () => {
    test('renders Landing when the route has no conversation ID', () => {
      render(<ChatView />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
    });

    test('renders Landing for NEW_CONVO even while the query reports loading', () => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({ conversationId: Constants.NEW_CONVO, title: 'New Chat' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      render(<ChatView />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
    });

    test('tells ChatForm it is on the landing page', () => {
      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });

      render(<ChatView />);

      expect(mockChatFormProps).toHaveBeenCalledWith(
        expect.objectContaining({ isLandingPage: true, footerBelow: true }),
      );
    });
  });

  describe('existing conversation', () => {
    beforeEach(() => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
    });

    test('renders the skeleton while messages are loading', () => {
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      render(<ChatView />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
    });

    test('keeps the skeleton when the query settles with no messages yet', () => {
      mockMessagesQuery.mockReturnValue({ data: [], isLoading: false, isFetching: false });

      render(<ChatView />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
    });

    test('renders MessagesView once messages are available', () => {
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });

      render(<ChatView />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();
    });

    test('tells ChatForm it is not on the landing page and omits the landing placeholder', () => {
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });

      render(<ChatView />);

      expect(mockChatFormProps).toHaveBeenCalledWith(
        expect.objectContaining({ isLandingPage: false, placeholder: undefined }),
      );
    });

    /** ChatView does not branch on `isError`: a failed query leaves no tree, so a
     *  routed conversation stays on the skeleton and never falls back to Landing. */
    test('keeps the skeleton and stays off the landing page when the query errors', () => {
      mockMessagesQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: true,
        error: new Error('Network error'),
      });

      render(<ChatView />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
      expect(mockChatFormProps).toHaveBeenCalledWith(
        expect.objectContaining({ isLandingPage: false }),
      );
    });

    /** An untitled conversation still renders its transcript; only the heading
     *  falls back to the localized label. */
    test('renders MessagesView with the localized heading when the conversation has no title', () => {
      mockConversation.mockReturnValue({ conversationId: 'convo-1' });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });

      render(<ChatView />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    /** A route-matched Recoil conversation whose title is empty or whitespace-only
     *  must not produce an empty or blank h1: `trim() || undefined` makes it fall
     *  back to the localized label, both on the transcript and on the skeleton. */
    describe.each([
      ['an empty', ''],
      ['a whitespace-only', '   '],
      ['a tab/newline-only', '\t\n '],
    ])('with %s title', (_label, title) => {
      beforeEach(() => {
        mockConversation.mockReturnValue({ conversationId: 'convo-1', title });
      });

      test('falls back to the localized heading on the loaded transcript', () => {
        mockMessagesQuery.mockReturnValue({
          data: existingMessages,
          isLoading: false,
          isFetching: false,
        });

        render(<ChatView />);

        expect(screen.getByTestId('messages-view')).toBeInTheDocument();
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('New chat');
        expect(headings[0].textContent?.trim()).not.toBe('');
      });

      test('falls back to the localized heading while the skeleton shows', () => {
        mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

        render(<ChatView />);

        expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      });
    });

    /** Recoil holding a different conversation than the route must never leak its
     *  title, even when the route's transcript is already loaded: the heading is
     *  derived from the route-matched `activeConversation` only. */
    describe('when Recoil holds a conversation that does not match the route', () => {
      beforeEach(() => {
        mockConversation.mockReturnValue({ conversationId: 'convo-9', title: 'Other chat' });
      });

      test('falls back to the localized heading on the loaded transcript', () => {
        mockMessagesQuery.mockReturnValue({
          data: existingMessages,
          isLoading: false,
          isFetching: false,
        });

        render(<ChatView />);

        expect(screen.getByTestId('messages-view')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
        expect(
          screen.queryByRole('heading', { level: 1, name: 'Other chat' }),
        ).not.toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      });

      test('falls back to the localized heading while the skeleton shows', () => {
        mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

        render(<ChatView />);

        expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
        expect(screen.queryByText('Other chat')).not.toBeInTheDocument();
      });
    });

    /** A real title padded with whitespace is announced trimmed. Accessible-name
     *  matching normalizes whitespace, so the raw text content is asserted. */
    test('renders a padded title trimmed in the heading', () => {
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: '  \t Deploy checklist \n ',
      });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });

      render(<ChatView />);

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0].textContent).toBe('Deploy checklist');
    });

    /** The skeleton must be replaced in place once the transcript resolves after
     *  the first render. ChatView is memoized, so the rerender changes a prop
     *  (`routePending` settling) to force the component to read the new query state. */
    test('swaps the skeleton for MessagesView when messages resolve after the initial render', () => {
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      const { rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();

      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });

      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();
    });

    test('keeps the skeleton while a resolved-but-empty query is refetching', () => {
      mockMessagesQuery.mockReturnValue({ data: [], isLoading: false, isFetching: true });

      const { rerender } = render(<ChatView routePending />);
      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();

      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
    });
  });

  /**
   * Starting a new conversation from an open one: the route moves to NEW_CONVO
   * (or drops its ID) and the query returns no transcript. With an empty tree on
   * a new-conversation route, ChatView must replace MessagesView with Landing
   * rather than showing the skeleton.
   */
  describe('returning to the landing page from an open conversation', () => {
    const openConversation = () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
    };

    test('swaps MessagesView for Landing when the route moves to NEW_CONVO', () => {
      openConversation();
      const { rerender } = render(<ChatView routePending />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();

      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({ conversationId: Constants.NEW_CONVO, title: 'New Chat' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });

      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Deploy checklist' }),
      ).not.toBeInTheDocument();
    });

    /** NEW_CONVO never shows the skeleton, even if the query briefly reports loading. */
    test('goes straight to Landing without a skeleton while the NEW_CONVO query is loading', () => {
      openConversation();
      const { rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({ conversationId: Constants.NEW_CONVO, title: 'New Chat' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
    });

    test('returns to Landing when the route drops its conversation ID', () => {
      openConversation();
      const { rerender } = render(<ChatView routePending />);

      mockParams.mockReturnValue({});
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });

      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
    });

    /** The composer must switch back to its landing configuration as well. */
    test('switches ChatForm back to landing mode with the landing placeholder', () => {
      openConversation();
      const { rerender } = render(<ChatView routePending />);

      expect(mockChatFormProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ isLandingPage: false, placeholder: undefined }),
      );

      mockParams.mockReturnValue({ conversationId: Constants.NEW_CONVO });
      mockConversation.mockReturnValue({ conversationId: Constants.NEW_CONVO, title: 'New Chat' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: false, isFetching: false });

      rerender(<ChatView routePending={false} />);

      expect(mockChatFormProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isLandingPage: true,
          footerBelow: true,
          placeholder: 'com_cyvox_home_chat_placeholder',
        }),
      );
    });
  });

  /**
   * Switching directly from one existing conversation to another: the route
   * moves to the second ID while its transcript loads. ChatView must show the
   * skeleton (never Landing, never the previous transcript) and only announce
   * the title once the Recoil conversation matches the new route.
   */
  describe('switching between two existing conversations', () => {
    const secondMessages = [
      { messageId: 'n1', parentMessageId: ROOT_PARENT_ID, text: 'Notes?', isCreatedByUser: true },
      { messageId: 'n2', parentMessageId: 'n1', text: 'Here they are', isCreatedByUser: false },
    ];

    const openFirstConversation = () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
    };

    test('shows the skeleton while the second conversation loads', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      rerender(<ChatView routePending />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(mockChatFormProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ isLandingPage: false, placeholder: undefined }),
      );
    });

    /** Recoil lags the route: the previous title must not be announced for the new ID. */
    test('does not announce the previous title while Recoil still holds the first conversation', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      rerender(<ChatView routePending />);

      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Deploy checklist' }),
      ).not.toBeInTheDocument();
    });

    test('announces the new title on the skeleton once Recoil catches up', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });

      rerender(<ChatView routePending />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument();
    });

    test('renders the second transcript with its title after the query resolves', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();

      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      mockMessagesQuery.mockReturnValue({
        data: secondMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Deploy checklist' }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    /** A failed load for the second conversation leaves no tree: the skeleton
     *  stays, and the first conversation's title is never announced for it. */
    test('keeps the skeleton and hides the stale title when the second query fails', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: true,
        error: new Error('Network error'),
      });
      rerender(<ChatView routePending />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('messages-view')).not.toBeInTheDocument();
      expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Deploy checklist' }),
      ).not.toBeInTheDocument();

      /** Recoil catches up even though the transcript failed: the title follows. */
      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('transcript-skeleton')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    /** Going back to the first conversation: its cached transcript renders at
     *  once, but the second title must not be announced until Recoil follows. */
    test('switching back to the first conversation never announces the second title', () => {
      openFirstConversation();
      const { rerender } = render(<ChatView />);

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      mockMessagesQuery.mockReturnValue({
        data: secondMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending />);

      expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument();

      /** Route returns to convo-1 with a cached transcript; Recoil still holds convo-2. */
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.queryByTestId('transcript-skeleton')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Release notes' }),
      ).not.toBeInTheDocument();

      mockConversation.mockReturnValue({ conversationId: 'convo-1', title: 'Deploy checklist' });
      rerender(<ChatView routePending />);

      expect(screen.getByRole('heading', { level: 1, name: 'Deploy checklist' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    /** The project badge follows the same route-matched conversation as the title. */
    test('does not show the previous conversation project badge while Recoil lags', () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({
        conversationId: 'convo-1',
        title: 'Deploy checklist',
        chatProjectId: 'project-1',
      });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
      const { rerender, container } = render(<ChatView />);

      expect(screen.getByTestId('project-badge')).toBeInTheDocument();

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({ data: null, isLoading: true, isFetching: true });
      rerender(<ChatView routePending />);

      expect(screen.queryByTestId('project-badge')).not.toBeInTheDocument();
      expect(container.querySelector('[data-chat-pane]')).not.toHaveClass('pt-9');
      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
    });

    /** The reverse lag: Recoil already holds the next conversation before the
     *  route moves. The title stays hidden until the route ID matches, then
     *  appears on the rerender that brings the route in line. */
    test('announces the Recoil title once the route ID changes to match it', () => {
      mockParams.mockReturnValue({ conversationId: 'convo-1' });
      mockConversation.mockReturnValue({ conversationId: 'convo-2', title: 'Release notes' });
      mockMessagesQuery.mockReturnValue({
        data: existingMessages,
        isLoading: false,
        isFetching: false,
      });
      const { rerender } = render(<ChatView routePending />);

      expect(screen.getByRole('heading', { level: 1, name: 'New chat' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Release notes' }),
      ).not.toBeInTheDocument();

      mockParams.mockReturnValue({ conversationId: 'convo-2' });
      mockMessagesQuery.mockReturnValue({
        data: secondMessages,
        isLoading: false,
        isFetching: false,
      });
      rerender(<ChatView routePending={false} />);

      expect(screen.getByTestId('messages-view')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });
});
