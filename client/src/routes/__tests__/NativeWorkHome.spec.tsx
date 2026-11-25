import React from 'react';
import { dataService } from 'coderax-data-provider';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TWorkModelsResponse, TWorkTasksResponse } from 'coderax-data-provider';
import NativeWorkHome from '../NativeWorkHome';

const messages: Record<string, string> = {
  com_cyvox_work_welcome_title: 'What would you like to work on?',
  com_cyvox_work_welcome_description: 'Describe the outcome you want.',
  com_cyvox_work_history_loading: 'Loading recent work…',
  com_cyvox_work_recent_heading: 'Recent tasks',
  com_cyvox_work_description_label: 'Describe what you want to get done',
  com_cyvox_work_description_placeholder: 'Tell me what you need to get done...',
  com_cyvox_model: 'Model',
  com_cyvox_cancel: 'Cancel',
  com_cyvox_work_start_task_aria: 'Start task',
  com_cyvox_tasks_unavailable: 'Unable to load recent work right now.',
  com_work_models_unavailable: 'Work models are unavailable.',
  com_work_no_models: 'No free or local agent models are configured for Work yet.',
  com_work_cancel_task_confirmation: 'Cancel this Work task?',
  com_work_cancel_failed: 'Work could not cancel this task.',
  com_work_task_selection_note: 'The selected free or local model applies to this task only.',
  com_cyvox_work_policy_note: 'Native tools retain their permission and approval controls.',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => messages[key] ?? key,
}));

jest.mock('coderax-data-provider', () => ({
  ...jest.requireActual('coderax-data-provider'),
  dataService: {
    getWorkModels: jest.fn(),
    getWorkTasks: jest.fn(),
    cancelWorkTask: jest.fn(),
  },
  MutationKeys: { cancelWorkTask: 'cancelWorkTask' },
  QueryKeys: { workModels: 'workModels', workTasks: 'workTasks' },
  WORK_AUTO_MODEL_ID: 'auto',
}));

function LocationDisplay() {
  const location = useLocation();
  const state = location.state as { workModel?: string } | null;
  return (
    <output data-testid="location-state">
      {location.pathname + location.search} {state?.workModel ?? ''}
    </output>
  );
}

function renderHome(models: TWorkModelsResponse, tasks: TWorkTasksResponse) {
  const getModels = jest.spyOn(dataService, 'getWorkModels').mockResolvedValue(models);
  const getTasks = jest.spyOn(dataService, 'getWorkTasks').mockResolvedValue(tasks);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/work']}>
        <NativeWorkHome />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { getModels, getTasks, queryClient };
}

describe('native Work home', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts through the native Work route with the selected model and no extra confirmation', async () => {
    const { getModels, getTasks, queryClient } = renderHome(
      {
        models: [
          { id: 'auto', label: 'Automatic', auto: true },
          { id: 'ollama/llama3', label: 'Llama 3' },
        ],
      },
      { tasks: [] },
    );
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByRole('option', { name: 'Llama 3' });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'ollama/llama3' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe what you want to get done' }), {
      target: { value: '  Make a rollout plan  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));

    await waitFor(() =>
      expect(screen.getByTestId('location-state')).toHaveTextContent(
        '/work/new?prompt=Make+a+rollout+plan&submit=true ollama/llama3',
      ),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getTasks).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('shows a truthful empty-model state and keeps task start disabled', async () => {
    const { queryClient } = renderHome({ models: [] }, { tasks: [] });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No free or local agent models are configured for Work yet.',
    );
    expect(screen.getByRole('button', { name: 'Start task' })).toBeDisabled();
    queryClient.clear();
  });

  it('cancels only the selected task through the owner-scoped native task service', async () => {
    const { queryClient } = renderHome(
      {
        models: [
          { id: 'auto', label: 'Automatic', auto: true },
          { id: 'local', label: 'Local' },
        ],
      },
      { tasks: [{ id: 'task-1', title: 'Refresh the report', state: 'running' }] },
    );
    const cancel = jest.spyOn(dataService, 'cancelWorkTask').mockResolvedValue({ canceled: true });
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    await screen.findByRole('button', { name: 'Cancel Refresh the report' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Refresh the report' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task-1'));
    queryClient.clear();
  });
});
