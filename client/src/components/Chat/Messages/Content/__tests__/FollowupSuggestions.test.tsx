import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import FollowupSuggestions, { parseFollowupArgs } from '../FollowupSuggestions';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    key === 'com_ui_suggested_followups' ? 'Suggested follow-ups' : key,
}));

jest.mock('~/Providers', () => ({
  useMessageContext: () => ({ conversationId: 'convo-1' }),
  useShareContext: jest.fn(() => ({})),
}));

const { useShareContext } = jest.requireMock('~/Providers') as {
  useShareContext: jest.Mock;
};

const args = JSON.stringify({
  suggestions: [
    { label: 'Add retry tests', prompt: 'Add retry with backoff to the deploy poller tests.' },
    { label: 'Split the provider', prompt: 'Split the provider into transport and retry modules.' },
  ],
});

/** Reads the same atom `useTextarea` drains, which is where a click lands. */
function ComposerProbe() {
  const text = useRecoilValue(store.pendingComposerTextByConvoId('convo-1'));
  return <span data-testid="composer-text">{text ?? ''}</span>;
}

function renderCard(value: string | Record<string, unknown>) {
  return render(
    <RecoilRoot>
      <FollowupSuggestions args={value} />
      <ComposerProbe />
    </RecoilRoot>,
  );
}

describe('parseFollowupArgs', () => {
  test('parses a complete set of chips', () => {
    expect(parseFollowupArgs(args)).toEqual([
      { label: 'Add retry tests', prompt: 'Add retry with backoff to the deploy poller tests.' },
      {
        label: 'Split the provider',
        prompt: 'Split the provider into transport and retry modules.',
      },
    ]);
  });

  test('accepts an already-parsed object', () => {
    expect(parseFollowupArgs({ suggestions: [{ label: 'A', prompt: 'Do a thing' }] })).toEqual([
      { label: 'A', prompt: 'Do a thing' },
    ]);
  });

  test('returns null while the args are still streaming', () => {
    expect(parseFollowupArgs('{"suggestions":[{"label":"Add retry')).toBeNull();
  });

  test('returns null for a chip with no prompt', () => {
    expect(
      parseFollowupArgs('{"suggestions":[{"label":"Add retry tests","prompt":"  "}]}'),
    ).toBeNull();
  });

  test('returns null for an empty list', () => {
    expect(parseFollowupArgs('{"suggestions":[]}')).toBeNull();
  });

  /** The card renders from raw args, not the server's normalized result, so a
   *  repeated direction would otherwise collide on one React key. */
  test('drops a direction the model repeated under another label', () => {
    expect(
      parseFollowupArgs(
        JSON.stringify({
          suggestions: [
            { label: 'Add retry tests', prompt: 'Add retry with backoff.' },
            { label: 'Retries', prompt: '  add   RETRY with\nbackoff. ' },
            { label: 'Split the provider', prompt: 'Split the provider.' },
          ],
        }),
      ),
    ).toEqual([
      { label: 'Add retry tests', prompt: 'Add retry with backoff.' },
      { label: 'Split the provider', prompt: 'Split the provider.' },
    ]);
  });
});

describe('FollowupSuggestions', () => {
  afterEach(() => {
    useShareContext.mockReturnValue({});
  });

  test('labels each chip and keeps the full prompt in its tooltip', () => {
    renderCard(args);

    const chip = screen.getByRole('button', { name: 'Add retry tests' });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute('title', 'Add retry with backoff to the deploy poller tests.');
    expect(screen.getByText('Suggested follow-ups')).toBeInTheDocument();
  });

  test('clicking a chip puts its full prompt in the composer', () => {
    renderCard(args);
    expect(screen.getByTestId('composer-text')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Split the provider' }));

    expect(screen.getByTestId('composer-text')).toHaveTextContent(
      'Split the provider into transport and retry modules.',
    );
  });

  test('renders nothing in a shared transcript, where there is no composer', () => {
    useShareContext.mockReturnValue({ isSharedConvo: true });

    renderCard(args);

    expect(screen.queryByTestId('followup-suggestions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('renders nothing until the args parse', () => {
    renderCard('{"suggestions":[{"label":"Add');
    expect(screen.queryByTestId('followup-suggestions')).not.toBeInTheDocument();
  });
});
