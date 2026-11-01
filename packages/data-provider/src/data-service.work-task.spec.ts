import { getWorkTask } from './data-service';
import * as endpoints from './api-endpoints';
import request from './request';
import type { TWorkTaskResponse } from './types/work';

jest.mock('./request', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const get = jest.mocked(request.get);

describe('getWorkTask', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('requests the task endpoint, forwards the abort signal, and returns the task', async () => {
    const conversationId = 'task/with space';
    const controller = new AbortController();
    const response: TWorkTaskResponse = {
      task: { id: 'work-task-1', title: 'Inspect source', state: 'running' },
    };
    get.mockResolvedValue(response);

    await expect(getWorkTask(conversationId, controller.signal)).resolves.toBe(response);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(endpoints.workTask(conversationId), {
      signal: controller.signal,
    });
  });

  it('requests the task endpoint without options when no abort signal is provided', async () => {
    const conversationId = 'work-task-2';
    const response: TWorkTaskResponse = {
      task: { id: conversationId, title: 'Review task', state: 'completed' },
    };
    get.mockResolvedValue(response);

    await expect(getWorkTask(conversationId)).resolves.toBe(response);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(endpoints.workTask(conversationId), undefined);
  });
});
