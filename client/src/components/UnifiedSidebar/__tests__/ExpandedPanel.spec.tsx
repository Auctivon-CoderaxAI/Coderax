import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import { MessagesSquare, NotebookPen } from 'lucide-react';
import { render, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NavLink } from '~/common';
import { ActivePanelProvider, DEFAULT_PANEL } from '~/Providers';

const mockNewConversation = jest.fn();
const mockClearMessagesCache = jest.fn();

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  const customShortcutsAtom = atom({
    key: 'mock-customShortcuts',
    default: {},
  });
  const shortcutsEnabledAtom = atom({
    key: 'mock-shortcutsEnabled',
    default: true,
  });
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `mock-conversationByIndex-${counter++}`, default: null }),
      conversationIdByIndex: () =>
        atom({ key: `mock-conversationIdByIndex-${counter++}`, default: null }),
      customShortcuts: customShortcutsAtom,
      shortcutsEnabled: shortcutsEnabledAtom,
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
  useShowMarketplace: () => false,
}));

/**
 * Stands in for the real hook, which reaches `useNewConvo` by deep path and so
 * escapes the `~/hooks` mock above. Mirrors its contract closely enough that
 * the panel-switch assertions still exercise the `onNewChat` wiring.
 */
jest.mock('~/hooks/Chat/useNewChat', () => ({
  __esModule: true,
  default: ({ onNewChat }: { onNewChat?: () => void } = {}) => ({
    newConversation: mockNewConversation,
    startNewChat: () => {
      mockNewConversation();
      onNewChat?.();
    },
    handleNewChatClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      mockClearMessagesCache();
      mockNewConversation();
      onNewChat?.();
    },
  }),
}));

jest.mock('~/utils', () => ({
  clearMessagesCache: (...args: unknown[]) => mockClearMessagesCache(...args),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  CLOSE_SIDEBAR_ID: 'close-sidebar',
}));

jest.mock('~/components/Nav/AccountSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="account-settings" />,
}));

import ExpandedPanel from '../ExpandedPanel';

const createLinks = (): NavLink[] => [
  {
    title: 'com_ui_chat_history' as const,
    icon: MessagesSquare,
    id: DEFAULT_PANEL,
  },
  {
    title: 'com_ui_prompts' as const,
    icon: NotebookPen,
    id: 'prompts',
  },
];

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPanel({
  expanded = true,
  links = createLinks(),
  onCollapse = jest.fn(),
  onExpand = jest.fn(),
  onNavigate,
  onLeaveInsights = jest.fn(),
  initialPanel = DEFAULT_PANEL,
  initialPath = '/c/new',
  switchToHistory = true,
}: {
  expanded?: boolean;
  links?: NavLink[];
  onCollapse?: jest.Mock;
  onExpand?: jest.Mock;
  onNavigate?: jest.Mock;
  onLeaveInsights?: jest.Mock;
  initialPanel?: string;
  initialPath?: string;
  switchToHistory?: boolean;
} = {}) {
  if (initialPanel !== DEFAULT_PANEL) {
    localStorage.setItem('side:active-panel', initialPanel);
  }

  const result = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={createQueryClient()}>
        <RecoilRoot>
          <ActivePanelProvider>
            <ExpandedPanel
              links={links}
              expanded={expanded}
              onCollapse={onCollapse}
              onExpand={onExpand}
              onNavigate={onNavigate}
              onLeaveInsights={onLeaveInsights}
              switchToHistory={switchToHistory}
            />
          </ActivePanelProvider>
        </RecoilRoot>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return { ...result, onCollapse, onExpand, onLeaveInsights };
}

describe('ExpandedPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  /**
   * Active state: a route-backed link (insights, cyvox-*) wins via routeActiveId;
   * otherwise the stored panel resolves through resolveActivePanel (effectiveActive),
   * falling back to the first link when the stored id is unknown.
   */
  describe('active state (routeActiveId / effectiveActive)', () => {
    const routeLinks = (): NavLink[] => [
      ...createLinks(),
      {
        title: 'com_insights_navigation' as const,
        icon: NotebookPen,
        id: 'insights',
        onClick: jest.fn(),
      },
      {
        title: 'com_cyvox_robot' as const,
        icon: NotebookPen,
        id: 'cyvox-robot',
        onClick: jest.fn(),
      },
    ];

    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');

    it('marks the default panel active when nothing is stored', () => {
      renderPanel();
      expect(pressed('com_ui_chat_history')).toBe('true');
      expect(pressed('com_ui_prompts')).toBe('false');
    });

    it('marks the stored panel active', () => {
      renderPanel({ initialPanel: 'prompts' });
      expect(pressed('com_ui_prompts')).toBe('true');
      expect(pressed('com_ui_chat_history')).toBe('false');
    });

    it('falls back to the first link when the stored panel is unavailable', () => {
      renderPanel({ initialPanel: 'parameters' });
      expect(pressed('com_ui_chat_history')).toBe('true');
    });

    it('marks insights active on an /insights route, overriding the stored panel', () => {
      renderPanel({ links: routeLinks(), initialPanel: 'prompts', initialPath: '/insights' });
      expect(pressed('com_insights_navigation')).toBe('true');
      expect(pressed('com_ui_prompts')).toBe('false');
      expect(pressed('com_ui_chat_history')).toBe('false');
    });

    it('marks insights active on a nested /insights route', () => {
      renderPanel({ links: routeLinks(), initialPath: '/insights/reports' });
      expect(pressed('com_insights_navigation')).toBe('true');
    });

    it('derives the cyvox link id from the route segment', () => {
      renderPanel({ links: routeLinks(), initialPath: '/cyvox/robot' });
      expect(pressed('com_cyvox_robot')).toBe('true');
      expect(pressed('com_insights_navigation')).toBe('false');
      expect(pressed('com_ui_chat_history')).toBe('false');
    });

    it('activates no link for an unknown cyvox segment', () => {
      renderPanel({ links: routeLinks(), initialPath: '/cyvox/unknown' });
      [
        'com_ui_chat_history',
        'com_ui_prompts',
        'com_insights_navigation',
        'com_cyvox_robot',
      ].forEach((name) => expect(pressed(name)).toBe('false'));
    });

    it('does not treat /cyvox without a trailing segment as a route', () => {
      renderPanel({ links: routeLinks(), initialPath: '/cyvox' });
      expect(pressed('com_ui_chat_history')).toBe('true');
    });

    it('leaves the route and switches panel when a panel link is clicked on a route', () => {
      const { onLeaveInsights, onCollapse } = renderPanel({
        links: routeLinks(),
        initialPath: '/insights',
      });
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));
      expect(onLeaveInsights).toHaveBeenCalledTimes(1);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    it('leaves the route when the stored panel link is clicked on a route', () => {
      const { onLeaveInsights, onCollapse } = renderPanel({
        links: routeLinks(),
        initialPath: '/cyvox/robot',
      });
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_chat_history' }));
      expect(onLeaveInsights).toHaveBeenCalledTimes(1);
      expect(onCollapse).not.toHaveBeenCalled();
    });

    it('does not call onLeaveInsights off a route', () => {
      const { onLeaveInsights } = renderPanel({ links: routeLinks() });
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));
      expect(onLeaveInsights).not.toHaveBeenCalled();
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    /**
     * Collapsed on a route: the panel link stores the panel and expands. Leaving
     * the route is the host's onExpand responsibility, so onLeaveInsights is not called.
     */
    it('expands instead of leaving the route when collapsed on a route', () => {
      const { onLeaveInsights, onExpand } = renderPanel({
        links: routeLinks(),
        expanded: false,
        initialPath: '/insights',
      });
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));
      expect(onExpand).toHaveBeenCalledTimes(1);
      expect(onLeaveInsights).not.toHaveBeenCalled();
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    /** The active route link delegates to its own onClick rather than collapsing. */
    it('runs the route link handler instead of collapsing when it is active', () => {
      const links = routeLinks();
      const insights = links.find((l) => l.id === 'insights') as NavLink;
      const { onCollapse, onLeaveInsights } = renderPanel({ links, initialPath: '/insights' });
      expect(pressed('com_insights_navigation')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'com_insights_navigation' }));
      expect(insights.onClick).toHaveBeenCalledTimes(1);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(onLeaveInsights).not.toHaveBeenCalled();
    });

    /** The route wins over the stored panel even when the stored panel is unknown. */
    it('ignores an unavailable stored panel on a route', () => {
      renderPanel({ links: routeLinks(), initialPanel: 'parameters', initialPath: '/cyvox/robot' });
      expect(pressed('com_cyvox_robot')).toBe('true');
      expect(pressed('com_ui_chat_history')).toBe('false');
    });
  });

  describe('NavIconButton collapse toggle', () => {
    it('keeps chat history expanded when its active icon is clicked', () => {
      const { onCollapse } = renderPanel({ expanded: true });
      const activeButton = screen.getByRole('button', { name: 'com_ui_chat_history' });
      fireEvent.click(activeButton);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(screen.getByTestId('close-sidebar-button')).toBeInTheDocument();
    });

    it('switches panel when clicking an inactive icon while expanded', () => {
      const { onCollapse } = renderPanel({ expanded: true });
      const inactiveButton = screen.getByRole('button', { name: 'com_ui_prompts' });
      fireEvent.click(inactiveButton);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    it('expands sidebar when clicking any icon while collapsed', () => {
      const { onExpand } = renderPanel({ expanded: false });
      const activeButton = screen.getByRole('button', { name: 'com_ui_chat_history' });
      fireEvent.click(activeButton);
      expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('sets active panel and expands when clicking an inactive icon while collapsed', () => {
      const { onExpand } = renderPanel({ expanded: false });
      const inactiveButton = screen.getByRole('button', { name: 'com_ui_prompts' });
      fireEvent.click(inactiveButton);
      expect(onExpand).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    it('notifies mobile navigation after a route link is selected', () => {
      const onClick = jest.fn();
      const onNavigate = jest.fn();
      const links = [
        ...createLinks(),
        {
          title: 'com_insights_navigation' as const,
          icon: NotebookPen,
          id: 'insights',
          onClick,
        },
      ];

      renderPanel({ links, onNavigate });
      fireEvent.click(screen.getByRole('button', { name: 'com_insights_navigation' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves chat sidebar controls without unrelated launchers', () => {
    renderPanel({ links: createLinks().slice(0, 1) });
    expect(screen.getByTestId('close-sidebar-button')).toBeInTheDocument();
    expect(screen.getByTestId('new-chat-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_chat_history' })).toBeInTheDocument();
    expect(screen.getByTestId('account-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-nav-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-agents-marketplace-button')).not.toBeInTheDocument();
  });

  describe('NewChatButton panel switch', () => {
    it('switches to chat history panel on new chat click when setting is enabled', () => {
      renderPanel({ expanded: true, initialPanel: 'prompts' });

      const newChatLink = screen.getByTestId('new-chat-button');
      fireEvent.click(newChatLink);

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe(DEFAULT_PANEL);
    });

    it('does not switch panel on new chat click when setting is disabled', () => {
      renderPanel({
        expanded: true,
        initialPanel: 'prompts',
        switchToHistory: false,
      });

      const newChatLink = screen.getByTestId('new-chat-button');
      fireEvent.click(newChatLink);

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });
  });
});
