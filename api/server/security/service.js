import {
  JobStore,
  authorizeToolRun,
  buildArgs,
  createApproval,
  createFinding,
  dedupeFindings,
  describeTools,
  getTool,
  parseTarget,
  redactSecrets,
  toJson,
  toMarkdown,
} from '@coderax/security-lab-core';

/**
 * Security Lab service.
 *
 * Dependencies are injected so the service can be tested without Mongo, Redis
 * or a container runtime:
 *   repo    – { createEngagement, getEngagement, listEngagements, addEvidence,
 *               addFinding, listFindings, listEvidence, addApproval, listApprovals,
 *               consumeApproval, audit }
 *   runner  – { enqueue({ jobId, bin, args, target, timeoutMs }), cancel(jobId) }
 *   resolve – async (host) => [{ address }]
 *
 * The in-memory JobStore is a development default. Production must back jobs
 * with the same durable store the rest of Coderax uses, or a restart loses
 * running-job state.
 */
export class SecurityService {
  constructor({ repo, runner, resolve, env = process.env, now = () => Date.now(), jobs } = {}) {
    if (!repo) throw new Error('SecurityService requires a repository');
    this.repo = repo;
    this.runner = runner ?? null;
    this.resolve = resolve ?? null;
    this.env = env;
    this.now = now;
    this.jobs = jobs ?? new JobStore({ now, timeoutMs: 90_000 });
  }

  listTools() {
    return describeTools(this.env);
  }

  async createEngagement({ userId, name, targets, depth, kind = 'client', statement = 'owner-attestation-v1' }) {
    if (!userId) throw Object.assign(new Error('Authentication required'), { status: 401 });
    if (!Array.isArray(targets) || targets.length === 0) {
      throw Object.assign(new Error('At least one target is required'), { status: 400 });
    }
    const parsed = targets.map((t) => parseTarget(t));
    const engagement = {
      id: `eng_${this.now().toString(36)}`,
      name: String(name ?? 'engagement').slice(0, 120),
      kind,
      depth,
      targets: parsed.map((t) => t.value),
      createdBy: userId,
      createdAt: new Date(this.now()).toISOString(),
      authorization: {
        attestedBy: userId,
        attestedAt: new Date(this.now()).toISOString(),
        statement,
      },
    };
    await this.repo.createEngagement(engagement);
    await this.repo.audit({
      type: 'engagement.created', engagementId: engagement.id, userId,
      detail: { targets: engagement.targets, depth, kind },
    });
    return engagement;
  }

  async requestApproval({ userId, engagementId, toolId, target }) {
    const engagement = await this.requireEngagement(engagementId, userId);
    const approval = createApproval({ toolId, target, requestedBy: userId, now: this.now() });
    await this.repo.addApproval(engagement.id, approval);
    await this.repo.audit({ type: 'approval.created', engagementId, userId, detail: { toolId, target } });
    return approval;
  }

  async run({ userId, engagementId, toolId, target, approvalId = null }) {
    const engagement = await this.requireEngagement(engagementId, userId);
    const tool = getTool(toolId);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${toolId}`), { status: 404 });

    const availability = describeTools(this.env).find((t) => t.id === toolId);
    if (!availability?.available) {
      throw Object.assign(
        new Error(`${toolId} is unavailable: ${availability?.reason ?? 'no runner'}`),
        { status: 409, code: 'tool_unavailable' },
      );
    }
    if (!this.runner) {
      throw Object.assign(new Error('No isolated runner is configured'), { status: 409, code: 'no_runner' });
    }

    const approvals = await this.repo.listApprovals(engagement.id);
    const decision = await authorizeToolRun({
      engagement, tool, target, approvals, now: this.now(), resolve: this.resolve,
    });
    await this.repo.audit({
      type: 'policy.decision', engagementId, userId,
      detail: { toolId, target, allowed: decision.allowed, code: decision.code ?? null },
    });
    if (!decision.allowed) {
      throw Object.assign(new Error(decision.reason ?? 'Denied by policy'), {
        status: decision.requiresApproval ? 428 : 403,
        code: decision.code,
        requiresApproval: Boolean(decision.requiresApproval),
      });
    }

    const job = this.jobs.create({ toolId, target: target ?? null, engagementId, userId });
    this.jobs.start(job.id);

    const { bin, args } = tool.binary
      ? buildArgs(toolId, { target })
      : { bin: null, args: [] };

    await this.runner.enqueue({ jobId: job.id, toolId, bin, args, target, engagementId, userId });
    if (approvalId) await this.repo.consumeApproval(engagement.id, approvalId);

    await this.repo.audit({ type: 'job.enqueued', engagementId, userId, detail: { jobId: job.id, toolId, target } });
    return this.jobs.get(job.id);
  }

  async cancel({ userId, engagementId, jobId }) {
    await this.requireEngagement(engagementId, userId);
    const job = this.jobs.cancel(jobId, { by: userId });
    if (this.runner) await this.runner.cancel(jobId);
    await this.repo.audit({ type: 'job.cancelled', engagementId, userId, detail: { jobId } });
    return job;
  }

  /** Called by the worker when output arrives. Output is untrusted data. */
  async recordEvidence({ engagementId, jobId, toolId, target, output, language = 'text' }) {
    const evidence = {
      id: `ev_${this.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      engagementId,
      jobId,
      toolId,
      target,
      language,
      output: redactSecrets(output),
      capturedAt: new Date(this.now()).toISOString(),
    };
    await this.repo.addEvidence(engagementId, evidence);
    return evidence;
  }

  async finishJob({ jobId, findings = [], evidenceIds = [] }) {
    return this.jobs.succeed(jobId, { findingIds: findings.map((f) => f.id), evidenceIds });
  }

  async findings(engagementId) {
    const rows = await this.repo.listFindings(engagementId);
    return dedupeFindings(rows);
  }

  async report({ userId, engagementId, format = 'md' }) {
    const engagement = await this.requireEngagement(engagementId, userId);
    const findings = await this.findings(engagementId);
    const evidence = await this.repo.listEvidence(engagementId);
    await this.repo.audit({ type: 'report.exported', engagementId, userId, detail: { format } });
    if (format === 'json') return toJson({ engagement, findings, evidence, meta: { now: this.now() } });
    return toMarkdown({ engagement, findings, evidence, meta: { now: this.now() } });
  }

  async requireEngagement(engagementId, userId) {
    const engagement = await this.repo.getEngagement(engagementId);
    if (!engagement) throw Object.assign(new Error('Engagement not found'), { status: 404 });
    // Tenant isolation: an engagement is only visible to its owner.
    if (engagement.createdBy !== userId) {
      throw Object.assign(new Error('Engagement not found'), { status: 404 });
    }
    return engagement;
  }
}

export function makeFinding(input) {
  return createFinding(input);
}
