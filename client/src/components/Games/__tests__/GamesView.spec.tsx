import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import GamesView from '../GamesView';

const mockUseProjects = jest.fn();
const mockUseCapabilities = jest.fn();

jest.mock('~/data-provider', () => ({
  useGameProjectsInfiniteQuery: (...args: unknown[]) => mockUseProjects(...args),
  useGameCapabilitiesQuery: (...args: unknown[]) => mockUseCapabilities(...args),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@coderax/client', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
      React.createElement('button', props, children),
    Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement('div', { ...props, 'data-testid': 'skeleton' }),
    EmptyState: ({
      title,
      description,
      action,
    }: {
      title?: string;
      description?: string;
      action?: ReactNode;
    }) =>
      React.createElement('section', null, [
        title ? React.createElement('p', { key: 'title' }, title) : null,
        description ? React.createElement('p', { key: 'description' }, description) : null,
        React.createElement('div', { key: 'action' }, action),
      ]),
  };
});

const capabilitiesReady = {
  data: {
    executor: 'unavailable',
    builds: false,
    playtests: false,
    agentSessions: false,
    reason: 'No verified cloud workload executor is available in this deployment.',
  },
  isLoading: false,
  isError: false,
};

function projectsResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ projects: [], nextCursor: null }] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <GamesView />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseProjects.mockReset();
  mockUseCapabilities.mockReset();
  mockUseCapabilities.mockReturnValue(capabilitiesReady);
});

describe('GamesView', () => {
  it('shows a loading skeleton while the list is pending', () => {
    mockUseCapabilities.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseProjects.mockReturnValue(projectsResult({ data: undefined, isLoading: true }));

    renderView();

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('shows the empty state when the owner has no games', () => {
    mockUseProjects.mockReturnValue(projectsResult());

    renderView();

    expect(screen.getByText('com_games_empty_title')).toBeTruthy();
    expect(screen.getByText('com_games_empty_body')).toBeTruthy();
  });

  it('shows a retryable error state when the list fails', () => {
    const refetch = jest.fn();
    mockUseProjects.mockReturnValue(projectsResult({ isError: true, refetch }));

    renderView();

    expect(screen.getByText('com_games_error_list_title')).toBeTruthy();
    screen.getByText('com_games_retry').click();
    expect(refetch).toHaveBeenCalled();
  });

  it('renders saved games with their spec status', () => {
    mockUseProjects.mockReturnValue(
      projectsResult({
        data: {
          pages: [
            {
              projects: [
                {
                  _id: 'game-1',
                  name: 'Lantern Run',
                  summary: 'A quiet platformer.',
                  status: 'spec_ready',
                  revision: 2,
                  specRevision: 1,
                  spec: {
                    prompt: 'Relight beacons.',
                    genre: 'platformer',
                    camera: 'side_view',
                    players: 1,
                    coreLoop: '',
                    winCondition: '',
                    artDirection: '',
                  },
                  createdAt: '2026-11-01T00:00:00.000Z',
                  updatedAt: '2026-11-02T00:00:00.000Z',
                },
              ],
              nextCursor: null,
            },
          ],
        },
      }),
    );

    renderView();

    expect(screen.getByText('Lantern Run')).toBeTruthy();
    expect(screen.getByText('com_games_status_spec_ready')).toBeTruthy();
    expect(screen.getByText('com_games_genre_platformer')).toBeTruthy();
  });

  it('keeps the unavailable surfaces explicit when capabilities cannot be read', () => {
    mockUseCapabilities.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUseProjects.mockReturnValue(projectsResult());

    renderView();

    expect(screen.getByText('com_games_capability_error_title')).toBeTruthy();
  });

  it('blocks pagination while any list fetch is running', () => {
    const fetchNextPage = jest.fn();
    const page = {
      data: {
        pages: [
          {
            projects: [
              {
                _id: 'game-1',
                name: 'Lantern Run',
                summary: '',
                status: 'draft',
                revision: 1,
                specRevision: 0,
                spec: null,
                createdAt: '2026-11-01T00:00:00.000Z',
                updatedAt: '2026-11-02T00:00:00.000Z',
              },
            ],
            nextCursor: 'cursor-1',
          },
        ],
      },
    };

    mockUseProjects.mockReturnValue(
      projectsResult({ ...page, hasNextPage: true, isFetching: true, fetchNextPage }),
    );
    const { rerender } = renderView();
    const busyButton = screen.getByText('com_games_load_more') as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    fireEvent.click(busyButton);
    expect(fetchNextPage).not.toHaveBeenCalled();

    mockUseProjects.mockReturnValue(
      projectsResult({ ...page, hasNextPage: true, isFetching: false, fetchNextPage }),
    );
    rerender(
      <MemoryRouter>
        <GamesView />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('com_games_load_more'));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('states the executor gate instead of implying builds are available', () => {
    mockUseProjects.mockReturnValue(projectsResult());

    renderView();

    expect(screen.getByText('com_games_unavailable_title')).toBeTruthy();
    expect(screen.getByText(capabilitiesReady.data.reason)).toBeTruthy();
    expect(screen.getByText('409 EXECUTOR_UNAVAILABLE')).toBeTruthy();
  });
});
