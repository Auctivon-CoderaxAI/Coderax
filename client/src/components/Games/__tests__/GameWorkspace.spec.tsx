import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import GameWorkspace from '../GameWorkspace';

jest.mock('~/data-provider', () => ({
  useGameProjectQuery: () => ({
    data: {
      _id: 'game-1',
      name: 'Lantern Run',
      summary: '',
      status: 'spec_ready',
      revision: 1,
      specRevision: 1,
      spec: {
        prompt: 'Relight the beacons.',
        genre: 'platformer',
        camera: 'side_view',
        players: 1,
        coreLoop: '',
        winCondition: '',
        artDirection: '',
      },
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
  useGameCapabilitiesQuery: () => ({
    data: { reason: 'No verified cloud workload executor is available.' },
    isLoading: false,
    isError: false,
  }),
  useSaveGameSpecMutation: () => ({ mutate: jest.fn(), isLoading: false }),
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
  };
});

describe('GameWorkspace', () => {
  it('keeps an unsaved spec draft when switching workspace tabs', () => {
    render(
      <MemoryRouter initialEntries={['/games/game-1?tab=spec']}>
        <Routes>
          <Route path="/games/:gameId" element={<GameWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('com_games_prompt_label'), {
      target: { value: 'A draft that is not saved yet.' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'com_games_tab_overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'com_games_tab_spec' }));

    expect((screen.getByLabelText('com_games_prompt_label') as HTMLTextAreaElement).value).toBe(
      'A draft that is not saved yet.',
    );
  });
});
