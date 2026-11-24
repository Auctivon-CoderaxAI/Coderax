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

  it('keeps the reason out of the layout until the caller asks for it', () => {
    const reason = 'Requires a connected repository';
    render(<CapabilityBadge status="blocked" label="Blocked" reason={reason} />);

    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(screen.getByTitle(reason)).toHaveTextContent('Blocked');
  });

  it('states the reason inline when the caller opts in', () => {
    const reason = 'Requires video generation capacity';
    render(<CapabilityBadge status="blocked" label="Blocked" reason={reason} showReason={true} />);

    expect(screen.getByText(reason)).toBeInTheDocument();
  });
});
