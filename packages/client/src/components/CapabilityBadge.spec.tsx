import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { CapabilityStatus } from './CapabilityBadge';
import CapabilityBadge from './CapabilityBadge';

const statuses: CapabilityStatus[] = [
  'live',
  'preview',
  'experimental',
  'planned',
  'blocked',
  'retired',
];

describe('CapabilityBadge', () => {
  it.each(statuses)('always carries a word for %s, never colour alone', (status) => {
    render(<CapabilityBadge status={status} label={status} />);
    expect(screen.getByText(status)).toBeInTheDocument();
  });

  it('takes its tone from the status family', () => {
    const { container, rerender } = render(<CapabilityBadge status="live" label="Live" />);
    expect(container.firstElementChild).toHaveClass('text-status-success');

    rerender(<CapabilityBadge status="planned" label="Planned" />);
    expect(container.firstElementChild).toHaveClass('text-status-neutral');

    rerender(<CapabilityBadge status="blocked" label="Blocked" />);
    expect(container.firstElementChild).toHaveClass('text-status-warning');
  });

  it('states the reason inline, not only as a tooltip', () => {
    render(
      <CapabilityBadge status="blocked" label="Blocked" reason="Requires a connected repository" />,
    );

    expect(screen.getByText('Requires a connected repository')).toBeInTheDocument();
    expect(screen.getByTitle('Requires a connected repository')).toHaveTextContent('Blocked');
  });

  it('drops the inline reason where the screen already states it', () => {
    const reason = 'Requires video generation capacity';
    render(<CapabilityBadge status="blocked" label="Blocked" reason={reason} showReason={false} />);

    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });
});
