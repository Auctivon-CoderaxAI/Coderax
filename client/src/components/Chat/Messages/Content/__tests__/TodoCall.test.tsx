import React from 'react';
import { render, screen } from '@testing-library/react';
import TodoCall, { parseTodoArgs } from '../TodoCall';

const translations: Record<string, string> = {
  com_ui_plan: 'Plan',
  com_ui_plan_status_cancelled: 'Cancelled',
  com_ui_plan_status_completed: 'Completed',
  com_ui_plan_status_in_progress: 'In progress',
  com_ui_plan_status_pending: 'Pending',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    key === 'com_ui_plan_progress'
      ? `${values?.[0]} of ${values?.[1]} done`
      : (translations[key] ?? key),
}));

const plan = JSON.stringify({
  todos: [
    { content: 'Read the workspace source', status: 'completed' },
    { content: 'Implement the plan tool', status: 'in_progress' },
    { content: 'Run the focused tests', status: 'pending' },
    { content: 'Drop the old card', status: 'cancelled' },
  ],
});

describe('parseTodoArgs', () => {
  test('parses a complete plan', () => {
    expect(parseTodoArgs(plan)).toHaveLength(4);
  });

  test('accepts an already-parsed object', () => {
    expect(parseTodoArgs({ todos: [{ content: 'a', status: 'pending' }] })).toEqual([
      { content: 'a', status: 'pending' },
    ]);
  });

  test('returns null while the args are still streaming', () => {
    expect(parseTodoArgs('{"todos":[{"content":"Read the work')).toBeNull();
  });

  test('returns null for an unknown status', () => {
    expect(parseTodoArgs('{"todos":[{"content":"a","status":"blocked"}]}')).toBeNull();
  });

  test('returns null for a blank item', () => {
    expect(parseTodoArgs('{"todos":[{"content":"   ","status":"pending"}]}')).toBeNull();
  });
});

describe('TodoCall', () => {
  test('renders every item with its own status', () => {
    render(<TodoCall args={plan} />);

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument();
    expect(screen.getByText('Implement the plan tool')).toBeInTheDocument();
    expect(screen.getByText('Run the focused tests')).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(1);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  test('renders nothing for a cleared plan', () => {
    const { container } = render(<TodoCall args={'{"todos":[]}'} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing until the args parse', () => {
    const { container } = render(<TodoCall args={'{"todos":[{"content":"Read'} />);
    expect(container).toBeEmptyDOMElement();
  });
});
