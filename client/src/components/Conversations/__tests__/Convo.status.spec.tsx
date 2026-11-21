import { createStore, Provider } from 'jotai';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import type { ConversationMode } from '~/components/Chat/mode';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { TConversation } from 'coderax-data-provider';
import { getConversationModesAtom } from '~/components/Chat/mode';

let mockIsUnseen = false;
let mockUserId = 'user-1';

jest.mock('@coderax/client', () => ({
  useMediaQuery: () => false,
  useRemScale: () => 1,
  useToastContext: () => ({ showToast: jest.fn() }),
  Spinner: ({ className, size }: { className?: string; size?: string | number }) => (
    <svg data-testid="status-ring" className={className} data-size={size} />
  ),
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNavigateToConvo: () => ({ navigateToConvo: jest.fn() }),
  useShiftKey: () => false,
  useAuthContext: () => ({ user: { id: mockUserId } }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { sharedLinksEnabled: false } }),
  useUpdateConversationMutation: () => ({ mutateAsync: jest.fn() }),
  usePinConversationMutation: () => ({ mutate: jest.fn() }),
  useProjectName: () => 'Scheduling',
}));

jest.mock('react-router-dom', () => ({
  useParams: () => ({ conversationId: 'other-convo' }),
}));

jest.mock('recoil', () => ({
  useRecoilValue: () => [],
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    allConversationsSelector: 'allConversationsSelector',
    conversationIdByIndex: () => 'conversationIdByIndex',
  },
}));

jest.mock('~/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  logger: { error: jest.fn() },
  setDocumentTitle: jest.fn(),
  isConversationUnseen: () => mockIsUnseen,
  hasRealTitle: (title: string) => !!title && title !== 'New Chat',
}));

jest.mock('../ConvoOptions', () => ({
  ConvoOptions: () => <div data-testid="convo-options" />,
}));

jest.mock('../ConversationEndpointIcon', () => ({
  __esModule: true,
  default: () => <div data-testid="convo-icon" />,
}));

jest.mock('../RenameForm', () => ({
  __esModule: true,
  default: () => <form data-testid="rename-form" />,
}));

import Conversation from '../Convo';

const conversation = {
  conversationId: 'convo-1',
  title: 'Tool Approval UI',
} as TConversation;

/** Every render gets its own store with the shared modes atom seeded, so a mode
 *  saved by one test's localStorage write cannot leak into the next one. */
const renderRow = (
  props: { isGenerating?: boolean; convo?: TConversation } = {},
  modes: Record<string, ConversationMode> = {},
) => {
  const store = createStore();
  store.set(getConversationModesAtom('user-1'), modes);

  const row = () => (
    <Provider store={store}>
      <DndProvider backend={HTML5Backend}>
        <Conversation
          conversation={props.convo ?? conversation}
          retainView={jest.fn()}
          toggleNav={jest.fn()}
          isGenerating={props.isGenerating}
          showProjectBadge
        />
      </DndProvider>
    </Provider>
  );
  const view = render(row());
  return { ...view, store, rerenderRow: () => view.rerender(row()) };
};

const rowButton = () => screen.getByRole('button', { name: /^com_ui_conversation_label/ });
const unreadDot = (container: HTMLElement) =>
  container.querySelector('span[aria-hidden="true"].bg-status-info');

describe('Conversation row status', () => {
  beforeEach(() => {
    mockIsUnseen = false;
    mockUserId = 'user-1';
  });

  it('rings the avatar while running and keeps the row menu reachable', () => {
    renderRow({ isGenerating: true });

    const ring = screen.getByTestId('status-ring');
    expect(rowButton()).toContainElement(ring);
    expect(rowButton()).toHaveAccessibleName('com_ui_conversation_label, com_ui_generating');
    /* The trailing slot used to hold the spinner in place of the menu, so a running chat
       could not be renamed or archived from the list. */
    fireEvent.contextMenu(screen.getByTestId('convo-item'));
    expect(screen.getByTestId('convo-options')).toBeInTheDocument();
    expect(screen.getAllByTestId('status-ring')).toHaveLength(1);
    expect(rowButton()).toContainElement(ring);
  });

  it('sizes the ring in rem so it follows the avatar box at any UI scale', () => {
    renderRow({ isGenerating: true });

    expect(screen.getByTestId('status-ring').getAttribute('class')).toContain('size-[2.125rem]');
  });

  it('offsets the ring in rem so it stays centered on the avatar at any UI scale', () => {
    renderRow({ isGenerating: true });

    const className = screen.getByTestId('status-ring').getAttribute('class') ?? '';
    expect(className).toContain('-top-[0.4375rem]');
    expect(className).toContain('-left-[0.4375rem]');
    expect(className).not.toMatch(/\[\d+px\]/);
  });

  it('marks an unseen reply on the avatar and in the title weight', () => {
    mockIsUnseen = true;
    const { container } = renderRow();

    const dot = unreadDot(container);
    expect(dot).not.toBeNull();
    expect(rowButton()).toContainElement(dot as HTMLElement);
    expect(rowButton()).toHaveAccessibleName('com_ui_conversation_label, com_ui_unread');
    expect(screen.getByText('Tool Approval UI').parentElement).toHaveClass('font-semibold');
  });

  it('shows only the ring when a chat with an unseen reply runs again', () => {
    mockIsUnseen = true;
    const { container } = renderRow({ isGenerating: true });

    expect(screen.getByTestId('status-ring')).toBeInTheDocument();
    expect(unreadDot(container)).toBeNull();
    expect(rowButton()).toHaveAccessibleName('com_ui_conversation_label, com_ui_generating');
    expect(screen.getByText('Tool Approval UI').parentElement).not.toHaveClass('font-semibold');
  });

  it('draws no status on an idle, read chat', () => {
    const { container } = renderRow();

    expect(screen.queryByTestId('status-ring')).not.toBeInTheDocument();
    expect(unreadDot(container)).toBeNull();
    expect(rowButton()).toHaveAccessibleName('com_ui_conversation_label');
  });

  it('names the project of a filed chat listed under Chats', () => {
    renderRow({ convo: { ...conversation, chatProjectId: 'project-1' } as TConversation });

    expect(screen.getByTestId('convo-project-badge')).toHaveAttribute('title', 'com_ui_in_project');
    expect(rowButton()).toHaveAccessibleDescription('com_ui_in_project');
  });

  it('badges a chat the user switched to Work', () => {
    renderRow({}, { 'convo-1': 'work' });

    expect(screen.getByTestId('convo-mode-badge')).toHaveAttribute('title', 'com_ui_work');
    expect(rowButton()).toHaveAccessibleDescription('com_ui_work');
  });

  it('leaves a chat with no saved mode unbadged', () => {
    renderRow();

    expect(screen.queryByTestId('convo-mode-badge')).not.toBeInTheDocument();
  });

  it('reacts to mode changes without remounting and retains the project description', () => {
    const filed = { ...conversation, chatProjectId: 'project-1' } as TConversation;
    const { store } = renderRow({ convo: filed });
    const button = rowButton();
    const modes = getConversationModesAtom('user-1');

    expect(screen.queryByTestId('convo-mode-badge')).not.toBeInTheDocument();
    expect(button).toHaveAccessibleDescription('com_ui_in_project');

    act(() => store.set(modes, { 'convo-1': 'work' }));
    expect(rowButton()).toBe(button);
    expect(screen.getByTestId('convo-mode-badge')).toHaveAttribute('title', 'com_ui_work');
    expect(button).toHaveAccessibleDescription('com_ui_in_project com_ui_work');

    act(() => store.set(modes, { 'convo-1': 'chat' }));
    expect(rowButton()).toBe(button);
    expect(screen.queryByTestId('convo-mode-badge')).not.toBeInTheDocument();
    expect(button).toHaveAccessibleDescription('com_ui_in_project');
  });

  it('does not show a different account\'s saved mode after switching account', () => {
    const { store, rerenderRow } = renderRow({}, { 'convo-1': 'work' });
    expect(screen.getByTestId('convo-mode-badge')).toBeInTheDocument();

    mockUserId = 'user-2';
    act(() => {
      store.set(getConversationModesAtom('user-2'), {});
      rerenderRow();
    });
    expect(screen.queryByTestId('convo-mode-badge')).not.toBeInTheDocument();

    act(() => store.set(getConversationModesAtom('user-2'), { 'convo-1': 'work' }));
    expect(screen.getByTestId('convo-mode-badge')).toBeInTheDocument();
    mockUserId = 'user-1';
    act(() => rerenderRow());
    expect(screen.getByTestId('convo-mode-badge')).toBeInTheDocument();
  });
});
