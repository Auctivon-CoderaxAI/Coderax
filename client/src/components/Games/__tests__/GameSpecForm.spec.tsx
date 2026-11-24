import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TGameProject, TGameSpec, TSaveGameSpecRequest } from 'coderax-data-provider';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import GameSpecForm from '../GameSpecForm';

type SaveOptions = {
  onSuccess: (saved: TGameProject) => void;
  onError: (error: unknown) => void;
};

const mockMutate = jest.fn<void, [TSaveGameSpecRequest, SaveOptions]>();

jest.mock('~/data-provider', () => ({
  useSaveGameSpecMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

jest.mock('@coderax/client', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
      React.createElement('button', props, children),
  };
});

const SPEC: TGameSpec = {
  prompt: 'Relight the beacons.',
  genre: 'platformer',
  camera: 'side_view',
  players: 1,
  coreLoop: '',
  winCondition: '',
  artDirection: '',
};

function project(overrides: Partial<TGameProject> = {}): TGameProject {
  return {
    _id: 'game-1',
    name: 'Lantern Run',
    summary: '',
    status: 'spec_ready',
    revision: 1,
    specRevision: 1,
    spec: SPEC,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const promptField = () => screen.getByLabelText('com_games_prompt_label');

beforeEach(() => {
  mockMutate.mockReset();
});

describe('GameSpecForm', () => {
  it('keeps the draft revision when the project query refreshes', () => {
    const { rerender } = render(<GameSpecForm project={project()} />);

    fireEvent.click(screen.getByText('com_games_save_spec'));
    expect(mockMutate.mock.calls[0][0].expectedRevision).toBe(1);

    rerender(<GameSpecForm project={project({ revision: 2, specRevision: 2 })} />);

    fireEvent.click(screen.getByText('com_games_save_spec'));
    expect(mockMutate.mock.calls[1][0].expectedRevision).toBe(1);
  });

  it('does not mark edits made during a save as saved', () => {
    render(<GameSpecForm project={project()} />);

    fireEvent.change(promptField(), { target: { value: 'Prompt A' } });
    fireEvent.click(screen.getByText('com_games_save_spec'));

    fireEvent.change(promptField(), { target: { value: 'Prompt B' } });
    act(() => mockMutate.mock.calls[0][1].onSuccess(project({ revision: 2 })));

    expect(screen.queryByText(/com_games_save_saved/)).toBeNull();
    expect(screen.getByText('com_games_save_hint')).toBeTruthy();
  });

  it('advances the draft revision after a successful save', () => {
    render(<GameSpecForm project={project()} />);

    fireEvent.click(screen.getByText('com_games_save_spec'));
    act(() => mockMutate.mock.calls[0][1].onSuccess(project({ revision: 2, specRevision: 2 })));

    expect(screen.getByText(/com_games_save_saved/)).toBeTruthy();

    fireEvent.click(screen.getByText('com_games_save_spec'));
    expect(mockMutate.mock.calls[1][0].expectedRevision).toBe(2);
  });
});
