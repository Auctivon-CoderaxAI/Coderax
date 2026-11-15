import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import TranscriptSkeleton from '../Loading';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => (key === 'com_ui_loading' ? 'Loading...' : key),
}));

describe('TranscriptSkeleton', () => {
  it('announces loading through a polite live region', () => {
    render(<TranscriptSkeleton />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading...');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('hides the decorative rows from assistive technology', () => {
    const { container } = render(<TranscriptSkeleton />);

    const rows = container.querySelector('[aria-hidden="true"]');
    expect(rows).not.toBeNull();
    expect(rows?.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('matches the message column width', () => {
    const { container, rerender } = render(<TranscriptSkeleton />);
    expect(container.querySelector('.md\\:max-w-3xl')).not.toBeNull();

    rerender(<TranscriptSkeleton fullWidth />);
    expect(container.querySelector('.max-w-full')).not.toBeNull();
  });

  /** The badge offset (`pt-9`) belongs to ChatView's `data-chat-pane` container,
   *  which wraps both this skeleton and MessagesView. A margin here would
   *  double it and shift the transcript when it replaces the skeleton. */
  it('does not add its own project badge offset', () => {
    const { container, rerender } = render(<TranscriptSkeleton />);
    expect(container.querySelector('.mt-9')).toBeNull();

    rerender(<TranscriptSkeleton hasProjectBadge />);
    expect(container.querySelector('.mt-9')).toBeNull();
    expect(container.querySelector('.pt-9')).toBeNull();
  });

  it('exposes hasProjectBadge as a data attribute', () => {
    const { rerender } = render(<TranscriptSkeleton />);
    expect(screen.getByTestId('transcript-skeleton')).not.toHaveAttribute('data-project-badge');

    rerender(<TranscriptSkeleton hasProjectBadge />);
    expect(screen.getByTestId('transcript-skeleton')).toHaveAttribute('data-project-badge', 'true');
  });
});