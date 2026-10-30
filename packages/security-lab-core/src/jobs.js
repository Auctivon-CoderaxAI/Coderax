export const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out'];
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const ALLOWED = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'timed_out'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

export class JobStore {
  constructor({ now = () => Date.now(), timeoutMs = 90_000, maxConcurrent = 4 } = {}) {
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.maxConcurrent = maxConcurrent;
    this.jobs = new Map();
    this.seq = 0;
  }

  create({ toolId, target, engagementId, userId } = {}) {
    if (!toolId) throw new JobError('invalid_job', 'A job needs a tool');
    this.seq += 1;
    const at = this.now();
    const job = {
      id: `job_${this.seq.toString(36)}`,
      toolId,
      target: target ?? null,
      engagementId: engagementId ?? null,
      userId: userId ?? null,
      state: 'queued',
      progress: 0,
      createdAt: new Date(at).toISOString(),
      startedAt: null,
      finishedAt: null,
      deadline: null,
      error: null,
      evidenceIds: [],
      findingIds: [],
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  list(filter = {}) {
    let out = [...this.jobs.values()];
    if (filter.state) out = out.filter((j) => j.state === filter.state);
    if (filter.engagementId) out = out.filter((j) => j.engagementId === filter.engagementId);
    return out.map((j) => ({ ...j }));
  }

  runningCount() {
    return [...this.jobs.values()].filter((j) => j.state === 'running').length;
  }

  _transition(job, next, patch = {}) {
    const allowed = ALLOWED[job.state] ?? [];
    if (!allowed.includes(next)) {
      throw new JobError('invalid_transition', `Cannot move job from ${job.state} to ${next}`);
    }
    job.state = next;
    Object.assign(job, patch);
    if (TERMINAL.has(next)) job.finishedAt = new Date(this.now()).toISOString();
    return { ...job };
  }

  start(id) {
    const job = this.jobs.get(id);
    if (!job) throw new JobError('not_found', `Unknown job ${id}`);
    if (job.state === 'queued' && this.runningCount() >= this.maxConcurrent) {
      throw new JobError('concurrency_limit', `At most ${this.maxConcurrent} jobs may run at once`);
    }
    const at = this.now();
    return this._transition(job, 'running', { startedAt: new Date(at).toISOString(), deadline: at + this.timeoutMs });
  }

  progress(id, fraction) {
    const job = this.jobs.get(id);
    if (!job) throw new JobError('not_found', `Unknown job ${id}`);
    if (job.state !== 'running') throw new JobError('not_running', `Job ${id} is ${job.state}`);
    const n = Number(fraction);
    if (!Number.isFinite(n)) throw new JobError('invalid_progress', 'Progress must be a number');
    job.progress = Math.max(job.progress, Math.min(1, Math.max(0, n)));
    return { ...job };
  }

  succeed(id, { evidenceIds = [], findingIds = [] } = {}) {
    const job = this.jobs.get(id);
    if (!job) throw new JobError('not_found', `Unknown job ${id}`);
    return this._transition(job, 'succeeded', { progress: 1, evidenceIds, findingIds });
  }

  fail(id, { error = 'unknown error' } = {}) {
    const job = this.jobs.get(id);
    if (!job) throw new JobError('not_found', `Unknown job ${id}`);
    return this._transition(job, 'failed', { error: String(error) });
  }

  cancel(id, { by = null } = {}) {
    const job = this.jobs.get(id);
    if (!job) throw new JobError('not_found', `Unknown job ${id}`);
    return this._transition(job, 'cancelled', { error: by ? `cancelled by ${by}` : 'cancelled' });
  }

  sweep() {
    const at = this.now();
    const timedOut = [];
    for (const job of this.jobs.values()) {
      if (job.state === 'running' && job.deadline && at >= job.deadline) {
        timedOut.push(this._transition(job, 'timed_out', { error: 'execution exceeded its time budget' }));
      }
    }
    return timedOut;
  }

  static isTerminal(state) {
    return TERMINAL.has(state);
  }
}
