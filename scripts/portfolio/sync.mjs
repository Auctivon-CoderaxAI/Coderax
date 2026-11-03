#!/usr/bin/env node
/**
 * Coderax portfolio agent inventory. Read-only by default.
 * Explicit --apply-agents uses the existing OIDC-protected Agent Management API;
 * never grant repository write permissions from inventory data.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildRegistry, parseOwnerAllowlist, readRegistry, agentCreatePayload, parseLimit, buildReviewWorkflow, stewardDescription } from './registry.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const value = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const fail = (message) => { throw new Error(message); };

async function jsonResponse(response) {
  if (!response.ok) throw new Error(`Request rejected (HTTP ${response.status})`);
  return response.json();
}

function approvedBaseURL(text, label) {
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} URL invalid`); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${label} must be an HTTPS origin (HTTP allowed for loopback development only)`);
  }
  return url.origin;
}

async function fetchGithubRepos(token) {
  const repos = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner,organization_member&sort=full_name&direction=asc`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(20000) });
    const records = await jsonResponse(response);
    if (!Array.isArray(records)) fail('GitHub response is not a repository array');
    repos.push(...records);
    if (records.length < 100) return repos;
  }
  fail('GitHub pagination limit reached (2000 repos); refuse incomplete sync');
}

async function listCoderaxAgents(base, token) {
  const found = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const url = new URL('/api/agents/v1/agents', base);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const data = await jsonResponse(response);
    const agents = data?.data;
    if (!Array.isArray(agents)) fail('Invalid Coderax agent listing');
    // Agent names are not unique; preserve all server-issued IDs.
    for (const agent of agents) if (agent && typeof agent.name === 'string' && typeof agent.id === 'string') found.push(agent);
    if (!data.has_more) return found;
    if (!data.after || cursor === data.after) fail('Invalid Coderax agent pagination cursor');
    cursor = data.after;
  }
  fail('Coderax agent pagination limit reached');
}

async function applyAgents(registry, options) {
  const base = approvedBaseURL(process.env.CODERAX_API_BASE_URL ?? '', 'Coderax');
  const token = process.env.CODERAX_AGENT_ACCESS_TOKEN;
  const provider = process.env.CODERAX_SHARED_MODEL_PROVIDER;
  const model = process.env.CODERAX_SHARED_MODEL_ID;
  if (!token || !provider || !model) fail('Applying requires CODERAX_AGENT_ACCESS_TOKEN, CODERAX_SHARED_MODEL_PROVIDER, and CODERAX_SHARED_MODEL_ID');
  const maxWrites = parseLimit(options.maxWrites);
  const current = await listCoderaxAgents(base, token);
  const created = [];
  let writes = 0;
  for (const agent of registry.agents) {
    const namesakes = current.filter((candidate) => candidate.name === agent.name);
    if (namesakes.length > 1) fail(`Ambiguous agent name for ${agent.repository}; resolve duplicates manually`);
    if (namesakes.length === 1) {
      const matching = namesakes[0];
      // Ownership by name alone is insufficient for an existing unmanaged agent.
      if (matching.description !== stewardDescription(agent.repository)) {
        throw new Error(`Agent name collision for ${agent.repository}; resolve manually before sync`);
      }
      agent.status = 'bound';
      agent.coderaxAgentId = matching.id;
      continue;
    }
    if (writes >= maxWrites) continue;
    const payload = agentCreatePayload(agent, provider, model);
    const response = await fetch(new URL('/api/agents/v1/agents', base), {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    const record = await jsonResponse(response);
    if (record?.name !== agent.name || typeof record.id !== 'string') fail('Coderax create response did not confirm the agent identity');
    created.push({ repository: agent.repository, id: record.id });
    current.push(record);
    agent.status = 'bound';
    agent.coderaxAgentId = record.id;
    writes++;
  }
  // Read back created identities; do not claim provisioned from a POST alone.
  const verified = await listCoderaxAgents(base, token);
  for (const entry of created) {
    const expected = registry.agents.find((agent) => agent.repository === entry.repository);
    const readback = verified.find((candidate) => candidate.id === entry.id);
    if (!readback || readback.name !== expected.name || readback.description !== stewardDescription(entry.repository)) {
      fail(`Agent readback mismatch: ${entry.repository}`);
    }
  }
  registry.counts.bound = registry.agents.filter((agent) => agent.status === 'bound').length;
  return { created: created.length, bound: registry.counts.bound, remaining: registry.agents.length - registry.counts.bound };
}

async function applyWorkflows(registry, maxWrites) {
  const base = approvedBaseURL(process.env.CODERAX_API_BASE_URL ?? '', 'Coderax');
  const token = process.env.CODERAX_WORKFLOW_ACCESS_TOKEN;
  if (!token) fail('Applying workflows requires CODERAX_WORKFLOW_ACCESS_TOKEN (a scoped Coderax session token)');
  // A saved catalog is editable: attest to every live binding before any workflow write.
  const boundAgents = registry.agents.filter((agent) => agent.status === 'bound');
  if (boundAgents.length) {
    const liveAgents = await listCoderaxAgents(base, process.env.CODERAX_AGENT_ACCESS_TOKEN || token);
    const liveById = new Map(liveAgents.map((agent) => [agent.id, agent]));
    for (const agent of boundAgents) {
      const live = liveById.get(agent.coderaxAgentId);
      if (!live || live.name !== agent.name || live.description !== stewardDescription(agent.repository)) {
        fail(`Unverified or changed agent binding for ${agent.repository}; refresh it through --apply-agents`);
      }
    }
  }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const listings = await jsonResponse(await fetch(new URL('/api/workflows', base), { headers, signal: AbortSignal.timeout(20000) }));
  if (!Array.isArray(listings.workflows)) fail('Invalid Coderax workflows listing');
  const existing = new Map(listings.workflows.map((workflow) => [workflow.name, workflow]));
  let created = 0;
  for (const agent of registry.agents) {
    if (agent.status !== 'bound') continue;
    const workflow = buildReviewWorkflow(agent);
    if (existing.has(workflow.name)) {
      const record = existing.get(workflow.name);
      if (record.agentId !== workflow.agentId || record.description !== workflow.description) fail(`Workflow name collision: ${agent.repository}`);
      continue;
    }
    if (created >= maxWrites) break;
    const response = await fetch(new URL('/api/workflows', base), { method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(workflow),
      signal: AbortSignal.timeout(20000), });
    const createdRecord = await jsonResponse(response);
    if (createdRecord?.name !== workflow.name && createdRecord?.workflow?.name !== workflow.name) fail(`Workflow creation unconfirmed for ${agent.repository}`);
    created++;
  }
  // Verify persisted workflows and their agent bindings with a second read.
  const verified = await jsonResponse(await fetch(new URL('/api/workflows', base), { headers, signal: AbortSignal.timeout(20000) }));
  if (!Array.isArray(verified.workflows)) fail('Workflow readback malformed');
  const byName = new Map(verified.workflows.map((workflow) => [workflow.name, workflow]));
  for (const agent of registry.agents.filter((agent) => agent.status === 'bound')) {
    const workflow = buildReviewWorkflow(agent);
    const match = byName.get(workflow.name);
    if (match && match.agentId !== workflow.agentId) fail(`Workflow binding mismatch: ${agent.repository}`);
  }
  return { created, verified: registry.agents.filter((agent) => agent.status === 'bound' && byName.has(buildReviewWorkflow(agent).name)).length };
}

async function main() {
  if (has('--help')) {
    process.stdout.write('Usage: node scripts/portfolio/sync.mjs [--input <existing.json>] [--out <path>] [--apply-agents] [--apply-workflows] [--max-writes <1..100>]\n');
    return;
  }
  if (has('--apply-workflows') && !has('--apply-agents') && !has('--input')) fail('--apply-workflows requires a bound catalog (--input or --apply-agents)');
  if (has('--apply-agents') && !has('--out')) fail('--apply-agents requires --out to retain the verified binding catalog');
  const allowlist = parseOwnerAllowlist(process.env.CODERAX_PORTFOLIO_ALLOW_OWNERS);
  let registry;
  if (has('--input')) {
    const input = value('--input');
    if (!input || input.startsWith('--')) fail('--input requires a file');
    registry = readRegistry(JSON.parse(await readFile(resolve(input), 'utf8')));
    registry.agents = registry.agents.filter((agent) => allowlist.some((owner) => {
      const repoOwner = agent.repository.split('/')[0].toLowerCase();
      return owner.endsWith('*') ? repoOwner.startsWith(owner.slice(0, -1)) : repoOwner === owner;
    }));
    registry.counts.enrolled = registry.agents.length;
    registry.counts.bound = registry.agents.filter((agent) => agent.status === 'bound').length;
  } else {
    const tokens = [process.env.CODERAX_GITHUB_TOKEN, process.env.CODERAX_GITHUB_TOKEN_SECONDARY].filter(Boolean);
    if (!tokens.length) fail('Set CODERAX_GITHUB_TOKEN (and optionally CODERAX_GITHUB_TOKEN_SECONDARY) for authorized read-only discovery');
    const records = (await Promise.all(tokens.map(fetchGithubRepos))).flat();
    registry = buildRegistry(records, allowlist);
  }
  let result = { created: 0, bound: registry.counts.bound ?? 0, remaining: registry.agents.length };
  if (has('--apply-agents')) result = await applyAgents(registry, { maxWrites: value('--max-writes') });
  let workflowResult = { created: 0, verified: 0 };
  if (has('--apply-workflows')) workflowResult = await applyWorkflows(registry, parseLimit(value('--max-writes')));
  if (has('--out')) {
    const output = resolve(value('--out'));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, flag: 'w' });
  }
  process.stdout.write(`${JSON.stringify({ discovered: registry.counts.discovered, enrolled: registry.agents.length, ...result, workflowResult, agentsApplied: has('--apply-agents'), workflowsApplied: has('--apply-workflows') })}\n`);
}

main().catch((error) => { process.stderr.write(`portfolio sync: ${error.message}\n`); process.exitCode = 1; });
