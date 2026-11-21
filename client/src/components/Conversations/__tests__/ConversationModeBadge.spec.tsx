import { render, screen } from '@testing-library/react';
import ConversationModeBadge from '../ConversationModeBadge';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('ConversationModeBadge', () => {
  it('draws an icon-only marker and exposes its label by id', () => {
    render(
      <ConversationModeBadge
        badge={{ mode: 'work', labelKey: 'com_ui_work' }}
        labelId="convo-mode-label"
      />,
    );

    const badge = screen.getByTestId('convo-mode-badge');
    expect(badge).toHaveAttribute('title', 'com_ui_work');
    expect(screen.getByText('com_ui_work')).toHaveAttribute('id', 'convo-mode-label');
  });
});
