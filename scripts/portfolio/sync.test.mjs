import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRegistry, parseOwnerAllowlist, stewardDescription } from './registry.mjs';

const syncPath = join(dirname(fileURLToPath(import.meta.url)), 'sync.mjs');
const owners = parseOwnerAllowlist('CoderaxAI');

const githubRepo = (owner, name) => ({
  owner: { login: owner },
  name,
  html_url: `https://github.com/${owner}/${name}`,
  private: true,
  default_branch: 'main',
  permissions: { pull: true },
  archived: false,
  disabled: false,
  fork: false,
});

function boundCatalog(entries) {
  const registry = buildRegistry(
    entries.map(({ owner, name }) => githubRepo(owner, name)),
    owners,
  );
  for (const agent of registry.agents) {
    const entry = entries.find(({ owner, name }) => `${owner}/${name}` === agent.repository);
    agent.status = 'bound';
    agent.coderaxAgentId = entry.id;
  }
  registry.counts.bound = registry.agents.length;
  return registry;
}

const liveAgent = (id, repository, description = stewardDescription(repository)) => ({
  id,
  name: `Repo Steward: ${repository}`,
  description,
});

async function startMockAgentApi({ agents = [], agentListStatus = 200 } = {}) {
  const state = { agentReads: [], workflowReads: [], workflowPosts: [] };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const send = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (pathname === '/api/agents/v1/agents') {
      state.agentReads.push(request.headers.authorization);
      if (agentListStatus !== 200) return send(agentListStatus, { error: 'unavailable' });
      return send(200, { data: agents, has_more: false });
    }
    if (pathname === '/api/workflows' && request.method === 'GET') {
      state.workflowReads.push(request.headers.authorization);
      return send(200, { workflows: state.workflowPosts });
    }
    if (pathname === '/api/workflows' && request.method === 'POST') {
      state.workflowPosts.push({ authorization: request.headers.authorization, ...body });
      return send(201, body);
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function runSync(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [syncPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function applyWorkflows(catalog, api, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'coderax-portfolio-'));
  try {
    const input = join(directory, 'registry.json');
    await writeFile(input, JSON.stringify(catalog));
    return await runSync(['--input', input, '--apply-workflows'], {
      CODERAX_PORTFOLIO_ALLOW_OWNERS: 'CoderaxAI',
      CODERAX_API_BASE_URL: api.base,
      CODERAX_WORKFLOW_ACCESS_TOKEN: 'workflow-token',
      CODERAX_AGENT_ACCESS_TOKEN: '',
      ...env,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('apply-workflows verifies every bound agent by saved ID before writing', async () => {
  const catalog = boundCatalog([
    { owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' },
    { owner: 'CoderaxAI', name: 'beta', id: 'agent-beta' },
  ]);
  const api = await startMockAgentApi({
    agents: [
      liveAgent('agent-alpha', 'CoderaxAI/alpha'),
      // A namesake must never shadow the identity saved in the catalog.
      {
        id: 'agent-namesake',
        name: 'Repo Steward: CoderaxAI/beta',
        description: 'Unrelated agent',
      },
      liveAgent('agent-beta', 'CoderaxAI/beta'),
    ],
  });
  try {
    const result = await applyWorkflows(catalog, api, {
      CODERAX_AGENT_ACCESS_TOKEN: 'agent-read-token',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.state.workflowPosts.map((post) => post.agentId).sort(), [
      'agent-alpha',
      'agent-beta',
    ]);
    assert.deepEqual([...new Set(api.state.agentReads)], ['Bearer agent-read-token']);
    assert.equal(
      api.state.workflowPosts.every((post) => post.authorization === 'Bearer workflow-token'),
      true,
    );
    const output = JSON.parse(result.stdout);
    assert.equal(output.workflowResult.created, 2);
    assert.equal(output.workflowResult.verified, 2);
  } finally {
    await api.close();
  }
});

test('apply-workflows fails closed when a bound agent no longer exists', async () => {
  const catalog = boundCatalog([{ owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' }]);
  const api = await startMockAgentApi({ agents: [] });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unverified or changed agent binding for CoderaxAI\/alpha/);
    assert.equal(api.state.workflowReads.length, 0);
    assert.equal(api.state.workflowPosts.length, 0);
  } finally {
    await api.close();
  }
});

test('apply-workflows fails closed when the saved ID now belongs to another agent', async () => {
  const catalog = boundCatalog([{ owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' }]);
  const api = await startMockAgentApi({ agents: [liveAgent('agent-changed', 'CoderaxAI/alpha')] });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unverified or changed agent binding for CoderaxAI\/alpha/);
    assert.equal(api.state.workflowPosts.length, 0);
  } finally {
    await api.close();
  }
});

test('apply-workflows fails closed when the steward description changed', async () => {
  const catalog = boundCatalog([{ owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' }]);
  const api = await startMockAgentApi({
    agents: [liveAgent('agent-alpha', 'CoderaxAI/alpha', 'Scoped write agent')],
  });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unverified or changed agent binding for CoderaxAI\/alpha/);
    assert.equal(api.state.workflowPosts.length, 0);
  } finally {
    await api.close();
  }
});

test('apply-workflows fails closed when the agent listing fails', async () => {
  const catalog = boundCatalog([{ owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' }]);
  const api = await startMockAgentApi({ agentListStatus: 503 });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Request rejected \(HTTP 503\)/);
    assert.equal(api.state.workflowPosts.length, 0);
  } finally {
    await api.close();
  }
});

test('no workflow is written when a later bound agent fails verification', async () => {
  const catalog = boundCatalog([
    { owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' },
    { owner: 'CoderaxAI', name: 'beta', id: 'agent-beta' },
  ]);
  const api = await startMockAgentApi({ agents: [liveAgent('agent-alpha', 'CoderaxAI/alpha')] });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /CoderaxAI\/beta/);
    assert.equal(api.state.workflowReads.length, 0);
    assert.equal(api.state.workflowPosts.length, 0);
  } finally {
    await api.close();
  }
});

test('falls back to the workflow token when no separate agent token is configured', async () => {
  const catalog = boundCatalog([{ owner: 'CoderaxAI', name: 'alpha', id: 'agent-alpha' }]);
  const api = await startMockAgentApi({ agents: [liveAgent('agent-alpha', 'CoderaxAI/alpha')] });
  try {
    const result = await applyWorkflows(catalog, api);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual([...new Set(api.state.agentReads)], ['Bearer workflow-token']);
    assert.equal(api.state.workflowPosts.length, 1);
  } finally {
    await api.close();
  }
});
