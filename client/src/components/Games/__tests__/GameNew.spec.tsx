import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import GameNew from '../GameNew';

jest.mock('~/data-provider', () => ({
  useCreateGameProjectMutation: () => ({ mutate: jest.fn(), isLoading: false }),
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
  };
});

describe('GameNew', () => {
  it('clears the name error once the owner types a name', () => {
    render(
      <MemoryRouter>
        <GameNew />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('com_games_create'));
    expect(screen.getByText('com_games_name_required')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('com_games_name_label'), {
      target: { value: 'Lantern Run' },
    });

    expect(screen.queryByText('com_games_name_required')).toBeNull();
    expect(screen.getByLabelText('com_games_name_label').getAttribute('aria-invalid')).toBeNull();
  });
});
