import { contractSchemas, isTerminalEvent, isTerminalTaskState } from './contracts';

const schemas = contractSchemas();

const at = '2026-11-26T00:00:00.000Z';

describe('WorkflowEngine contract 1.0.0', () => {
  it('accepts a documented chat reply', () => {
    const parsed = schemas.ChatReply.parse({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      text: 'done',
      agent: 'coderax',
      model: { providerId: 'local', modelId: 'free' },
      createdAt: at,
    });
    expect(parsed.agent).toBe('coderax');
  });

  it('rejects an undocumented field rather than passing it through', () => {
    expect(() =>
      schemas.ChatReply.parse({
        conversationId: 'conv_1',
        messageId: 'msg_1',
        text: 'done',
        agent: 'coderax',
        model: { providerId: 'local', modelId: 'free' },
        createdAt: at,
        engineToken: 'leak',
      }),
    ).toThrow();
  });

  it('accepts a task accepted response with generation fencing', () => {
    const accepted = schemas.TaskAccepted.parse({
      taskId: 'task_1',
      conversationId: 'conv_1',
      state: 'queued',
      generation: 3,
      eventsPath: '/v1/work/task_1/events',
    });
    expect(accepted.generation).toBe(3);
  });

  it('validates a task status with artifacts', () => {
    const status = schemas.TaskStatus.parse({
      taskId: 'task_1',
      conversationId: 'conv_1',
      state: 'completed',
      agent: 'coderax',
      mode: 'cloud',
      generation: 1,
      createdAt: at,
      updatedAt: at,
      cancelRequested: false,
      steps: [],
      result: { artifacts: [{ path: 'report.md', bytes: 12 }] },
    });
    expect(status.result?.artifacts[0].path).toBe('report.md');
  });

  it('rejects a permission decision without an exact request id', () => {
    expect(() => schemas.PermissionDecisionRequest.parse({ decision: 'approved' })).toThrow();
  });

  it('parses a sequenced execution event and recognises terminal types', () => {
    const event = schemas.ExecutionEvent.parse({
      v: 1,
      eventId: 'evt_1',
      taskId: 'task_1',
      seq: 4,
      at,
      agent: 'coderax',
      generation: 1,
      type: 'text.delta',
      payload: { text: 'hello' },
    });
    expect(event.type).toBe('text.delta');
    expect(isTerminalEvent('task.completed')).toBe(true);
    expect(isTerminalEvent('text.delta')).toBe(false);
  });

  it('rejects an event with a sequence below 1', () => {
    expect(() =>
      schemas.ExecutionEvent.parse({
        v: 1,
        eventId: 'evt_1',
        taskId: 'task_1',
        seq: 0,
        at,
        agent: 'coderax',
        generation: 1,
        type: 'task.queued',
      }),
    ).toThrow();
  });

  it('parses the stable problem body', () => {
    const problem = schemas.Problem.parse({
      type: 'https://coderax.dev/problems/not_found',
      title: 'not found',
      status: 404,
      code: 'not_found',
      retryable: false,
    });
    expect(problem.code).toBe('not_found');
  });

  it('recognises terminal task states', () => {
    expect(isTerminalTaskState('interrupted')).toBe(true);
    expect(isTerminalTaskState('running')).toBe(false);
  });
});
