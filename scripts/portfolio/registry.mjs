/**
 * Repository-agent discovery and policy — no network or model calls in this module.
 * A repository identity is a virtual agent until Coderax Agent Management readback binds it.
 */
import { createHash } from 'node:crypto';

export const REGISTRY_VERSION = 1;
export const MAX_REPOS = 1000;
export const DEFAULT_MAX_WRITES = 10;
const REPO_NAME = /^[A-Za-z0-9_.-]+$/;
const BLOCKED_OWNER = /(?:^|[-_.])wells[-_.]?fargo(?:$|[-_.])/i;

export function parseOwnerAllowlist(value) {
  const values = String(value ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0 || values.includes('*')) {
    throw new Error('CODERAX_PORTFOLIO_ALLOW_OWNERS must explicitly enumerate approved owners (no global *).');
  }
  for (const owner of values) {
    if (!/^[a-z0-9][a-z0-9-]*(?:\*)?$/.test(owner) || owner === '*') {
      throw new Error(`Invalid owner scope: ${owner}`);
    }
    if (BLOCKED_OWNER.test(owner)) throw new Error('Employer organizations cannot join the personal Coderax registry.');
  }
  return [...new Set(values)];
}

export function ownerAllowed(owner, allowlist) {
  const name = String(owner ?? '').toLowerCase();
  if (!name || BLOCKED_OWNER.test(name)) return false;
  return allowlist.some((scope) => scope.endsWith('*')
    ? name.startsWith(scope.slice(0, -1))
    : name === scope);
}

export function validateRepository(repo, allowedOwners) {
  if (!repo || typeof repo !== 'object' || !repo.owner || !repo.name) return null;
  const owner = repo.owner.login;
  const name = repo.name;
  if (typeof owner !== 'string' || typeof name !== 'string' || !REPO_NAME.test(owner) || !REPO_NAME.test(name)) return null;
  if (!ownerAllowed(owner, allowedOwners)) return null;
  if (repo.archived === true || repo.disabled === true || repo.fork === true) return null;
  if (repo.permissions?.pull !== true) return null;
  if (repo.html_url !== `https://github.com/${owner}/${name}`) return null;
  // Never auto-enroll enterprise/employer repositories in a personal workspace.
  if (BLOCKED_OWNER.test(`${owner}-${name}`)) return null;
  return { owner, name, fullName: `${owner}/${name}`, url: repo.html_url, private: repo.private === true,
    defaultBranch: typeof repo.default_branch === 'string' && REPO_NAME.test(repo.default_branch) ? repo.default_branch : 'main' };
}

export function agentIdentity(repo) {
  const normalized = `${repo.owner}/${repo.name}`.toLowerCase();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return {
    id: `repo_${digest}`,
    name: `Repo Steward: ${repo.owner}/${repo.name}`,
    repository: repo.fullName,
    source: repo.url,
    owner: repo.owner,
    branch: repo.defaultBranch,
    visibility: repo.private ? 'private' : 'public',
    status: 'unbound',
    orchestration: 'Coderax',
    deploymentExecutor: 'DeploymentPlatform',
    modelDeployment: 'shared',
    permissions: { read: true, write: false, createPr: false, merge: false, deploy: false },
  };
}

export function buildRegistry(repositories, allowedOwners, generatedAt = new Date().toISOString()) {
  if (!Array.isArray(repositories)) throw new TypeError('repositories must be an array');
  if (repositories.length > MAX_REPOS * 4) throw new Error('Discovery result exceeds input safety bound');
  const byName = new Map();
  for (const raw of repositories) {
    const repo = validateRepository(raw, allowedOwners);
    if (repo) byName.set(repo.fullName.toLowerCase(), agentIdentity(repo));
  }
  if (byName.size > MAX_REPOS) throw new Error('Registry exceeds supported capacity');
  const agents = [...byName.values()].sort((a, b) => a.repository.toLowerCase().localeCompare(b.repository.toLowerCase()));
  return { schemaVersion: REGISTRY_VERSION, generatedAt, orchestrator: 'Coderax',
    deploymentExecutor: 'DeploymentPlatform', modelStrategy: 'shared',
    counts: { discovered: repositories.length, enrolled: agents.length, bound: 0 }, agents };
}

export function readRegistry(raw) {
  if (!raw || raw.schemaVersion !== REGISTRY_VERSION || !Array.isArray(raw.agents)) throw new Error('Invalid registry schema');
  if (raw.agents.length > MAX_REPOS) throw new Error('Registry too large');
  const ids = new Set();
  for (const agent of raw.agents) {
    if (!agent || typeof agent !== 'object' || typeof agent.repository !== 'string' || !/^[-\w.]+\/[-\w.]+$/.test(agent.repository)) throw new Error('Invalid repository agent');
    const [owner, name] = agent.repository.split('/');
    if (!ownerAllowed(owner, [owner.toLowerCase()])) throw new Error('Employer repository prohibited');
    const expected = agentIdentity({ owner, name, fullName: agent.repository, url: `https://github.com/${owner}/${name}`, defaultBranch: 'main', private: agent.visibility === 'private' });
    if (agent.id !== expected.id || agent.name !== expected.name || agent.source !== expected.source) throw new Error('Repository agent identity mismatch');
    if (ids.has(agent.id)) throw new Error('Duplicate agent ID');
    ids.add(agent.id);
    if (BLOCKED_OWNER.test(`${owner}-${name}`)) throw new Error('Employer repository prohibited');
    if (agent.permissions?.write || agent.permissions?.merge || agent.permissions?.deploy) throw new Error('Registry cannot pregrant privileged write/deploy actions');
  }
  return raw;
}

export function agentCreatePayload(agent, provider, model) {
  if (!agent || !/^repo_[a-f0-9]{24}$/.test(agent.id)) throw new Error('Invalid repository identity');
  if (!provider || !model || typeof provider !== 'string' || typeof model !== 'string') throw new Error('Shared provider and model must be explicitly configured');
  if (provider.length > 100 || model.length > 150) throw new Error('Provider/model names too long');
  if (BLOCKED_OWNER.test(agent.repository.replace('/', '-'))) throw new Error('Employer isolation policy');
  return {
    name: agent.name,
    description: `Read-only repository steward for ${agent.repository}. Coordinated by Coderax; deployments are handled separately by DeploymentPlatform.`,
    instructions: [
      `You are the repository specialist for ${agent.repository}.`,
      'Never assume that a GitHub or DeploymentPlatform integration is connected: verify tool readiness first.',
      'Do not access other repositories or organizations without separately granted authorization.',
      'Operate in read-only mode by default. Never merge, push, delete, deploy, spend, or leak secrets without an explicit authorized workflow and applicable approval.',
      'Exchange task/result/status with the parent Coderax agent using the existing authenticated workflow/handoff system; do not invent completed actions.',
      'When reviewing code, use only verified source and cite commits and test evidence.',
    ].join('\n'),
    provider,
    model,
    subagents: { enabled: true, allowSelf: true, shareFiles: false },
  };
}

export function parseLimit(value, fallback = DEFAULT_MAX_WRITES) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 100) throw new Error('write limit must be an integer 1–100');
  return number;
}

/**
 * Creates a runnable, read-only Coderax workflow using the existing durable DAG
 * engine. Each step uses a verified real Agent Management ID; no placeholder
 * repository identity is ever sent as an agentId.
 */
export function buildReviewWorkflow(agent) {
  if (agent.status !== 'bound' || typeof agent.coderaxAgentId !== 'string' || !agent.coderaxAgentId.trim()) {
    throw new Error('Repository must have a verified Coderax agent binding');
  }
  if (typeof agent.repository !== 'string' || BLOCKED_OWNER.test(agent.repository.replace('/', '-'))) throw new Error('Employer repository prohibited');
  const agentId = agent.coderaxAgentId;
  return {
    name: `Repo review: ${agent.repository}`.slice(0, 120),
    description: `Read-only multi-agent readiness and security review of ${agent.repository}. No writes or deployments.`,
    agentId,
    settings: { maxParallel: 2 },
    steps: [
      {
        id: 'inventory', title: 'Inspect repository readiness', agentId, dependsOn: [],
        instruction: `Inspect ${agent.repository} for the default branch, dependencies, CI, test coverage, open risks and integration boundaries. Read only. Provide verifiable evidence and do not invent tool access.`,
      },
      {
        id: 'security', title: 'Independent security review', agentId, dependsOn: [],
        instruction: `Independently review ${agent.repository} for secret exposure, permission escalation, unsafe workflows and deployment risks. Read only; cite evidence and do not modify code.`,
      },
      {
        id: 'synthesis', title: 'Reconcile findings and propose actions', agentId, dependsOn: ['inventory', 'security'],
        instruction: `Compare the independent ${agent.repository} findings; reconcile conflicts, report CI/deployment blockers, and propose authorized next actions. Never claim changes were applied.`,
      },
    ],
  };
}
