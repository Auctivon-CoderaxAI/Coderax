import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TConversation } from 'coderax-data-provider';
import ModelBar from '../ModelBar';

const conversation = (overrides: Partial<TConversation> = {}) =>
  ({ model: 'qwen2.5-coder:7b', endpoint: 'ollama', ...overrides }) as TConversation;

describe('ModelBar', () => {
  it('reads out the active model and its endpoint', () => {
    render(<ModelBar conversation={conversation()} />);

    const bar = screen.getByTestId('composer-model-bar');
    expect(bar).toHaveTextContent('qwen2.5-coder:7b');
    expect(bar).toHaveTextContent('ollama');
  });

  it('omits the endpoint when the conversation has none', () => {
    render(<ModelBar conversation={conversation({ endpoint: null })} />);

    expect(screen.getByTestId('composer-model-bar')).toHaveTextContent('qwen2.5-coder:7b');
    expect(screen.queryByText('ollama')).not.toBeInTheDocument();
  });

  it('renders nothing before a model is attached', () => {
    const { container } = render(<ModelBar conversation={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
