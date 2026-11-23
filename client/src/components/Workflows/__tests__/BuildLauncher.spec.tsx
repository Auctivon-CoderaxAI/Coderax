import { fireEvent, render, screen } from '@testing-library/react';
import BuildLauncher from '../BuildLauncher';

const mockMutate = jest.fn();
jest.mock('~/data-provider', () => ({
  useStartWorkflowBuildMutation: () => ({ mutate: mockMutate, isError: true }),
}));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

it('reuses the launch key after a failed response and starts a new attempt for changed inputs', () => {
  render(<BuildLauncher agents={[{ id: 'agent-1' }]} onStarted={jest.fn()} onCancel={jest.fn()} />);
  const request = screen.getByRole('textbox');
  const submit = screen.getByRole('button', { name: 'com_ui_workflow_build_start' });
  fireEvent.change(request, { target: { value: 'Add settings' } });
  fireEvent.click(submit);
  fireEvent.click(submit);
  fireEvent.change(request, { target: { value: 'Add a dashboard' } });
  fireEvent.click(submit);

  const attempts = mockMutate.mock.calls.map(([payload]) => payload.launchKey);
  expect(mockMutate).toHaveBeenCalledTimes(3);
  expect(attempts[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[1]).toBe(attempts[0]);
  expect(attempts[2]).not.toBe(attempts[0]);
});
