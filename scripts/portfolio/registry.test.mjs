import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, ownerAllowed, parseOwnerAllowlist, agentCreatePayload, readRegistry, parseLimit, buildReviewWorkflow } from './registry.mjs';

const repo = (owner, name, extras = {}) => ({
  owner: { login: owner }, name, full_name: `${owner}/${name}`,
  html_url: `https://github.com/${owner}/${name}`,
  private: true, default_branch: 'main', permissions: { pull: true },
  archived: false, disabled: false, fork: false, ...extras,
});
const owners = parseOwnerAllowlist('nnabdelshahid,CoderaxAI,Auctivon-*');

test('explicit owner scopes, prefix support and global wildcard rejection', () => {
  assert.deepEqual(owners, ['nnabdelshahid','coderaxai','auctivon-*']);
  assert.equal(ownerAllowed('Auctivon-Finance', owners), true);
  assert.equal(ownerAllowed('another', owners), false);
  assert.throws(() => parseOwnerAllowlist('*'));
  assert.throws(() => parseOwnerAllowlist('WellsFargo-Engineering-Ops'));
  assert.throws(() => parseOwnerAllowlist(''));
});

test('never registers employer repos even when prefix scope is wide', () => {
  const catalog = buildRegistry([repo('nnabdelshahid','safe'),repo('WellsFargo-Engineering-Ops','AMP'),repo('CoderaxAI','wells-fargo-secrets')], owners);
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.agents[0].repository, 'nnabdelshahid/safe');
});

test('rejects unpermitted, archived, forked and spoofed API records', () => {
  const all = [repo('CoderaxAI','ok'),repo('CoderaxAI','hidden',{permissions:{pull:false}}),repo('CoderaxAI','old',{archived:true}),repo('CoderaxAI','fork',{fork:true}),repo('CoderaxAI','spoof',{html_url:'https://not-github.example/fake'})];
  assert.deepEqual(buildRegistry(all, owners).agents.map((agent)=>agent.repository), ['CoderaxAI/ok']);
});

test('id stable independent of input ordering, dedupes multiple identities and defaults to no writes', () => {
  const first = buildRegistry([repo('CoderaxAI','Coderax'),repo('nnabdelshahid','Portfolio')], owners, '2026-10-30T00:00:00Z');
  const second = buildRegistry([repo('nnabdelshahid','Portfolio'),repo('CoderaxAI','Coderax'),repo('CoderaxAI','Coderax')], owners, first.generatedAt);
  assert.deepEqual(first.agents, second.agents);
  assert.equal(first.agents.every((a)=>a.status==='unbound' && !a.permissions.write && !a.permissions.deploy && !a.permissions.merge), true);
  assert.equal(first.counts.bound,0);
  assert.equal(first.modelStrategy,'shared');
});

test('agent provisioning payload is read-only and uses a shared explicit model', () => {
  const agent = buildRegistry([repo('CoderaxAI','Coderax')], owners).agents[0];
  const payload = agentCreatePayload(agent,'openAI','configured-model');
  assert.equal(payload.provider,'openAI');
  assert.equal(payload.model,'configured-model');
  assert.equal(payload.subagents.shareFiles,false);
  assert.match(payload.instructions,/read-only mode/i);
  assert.throws(()=>agentCreatePayload(agent,'', 'model'));
});

test('tampered catalog cannot pregrant write actions or spoof employer scope', () => {
  const catalog = buildRegistry([repo('CoderaxAI','Coderax')], owners);
  assert.equal(readRegistry(catalog),catalog);
  const tampered=structuredClone(catalog);
  tampered.agents[0].permissions.deploy=true;
  assert.throws(()=>readRegistry(tampered));
  const employer=structuredClone(catalog);
  employer.agents[0].repository='WellsFargo-Engineering-Ops/private';
  assert.throws(()=>readRegistry(employer));
});

test('bounded provisioning batches', () => {
  assert.equal(parseLimit(undefined),10);
  assert.equal(parseLimit('100'),100);
  assert.throws(()=>parseLimit('1000'));
  assert.throws(()=>parseLimit('0'));
});


test('real bound agent builds a valid parallel and dependent Coderax DAG', () => {
  const registry = buildRegistry([repo('CoderaxAI', 'Coderax')], owners);
  const agent = {...registry.agents[0],status:'bound',coderaxAgentId:'agent-verified-by-server'};
  const workflow = buildReviewWorkflow(agent);
  assert.equal(workflow.agentId, 'agent-verified-by-server');
  assert.deepEqual(workflow.steps[0].dependsOn, []);
  assert.deepEqual(workflow.steps[1].dependsOn, []);
  assert.deepEqual(workflow.steps[2].dependsOn, ['inventory','security']);
  assert.equal(workflow.settings.maxParallel,2);
  assert.throws(()=>buildReviewWorkflow(registry.agents[0]));
});

test('tampered source and virtual identity cannot be imported', () => {
  const registry = buildRegistry([repo('CoderaxAI','Coderax')], owners);
  const injected = structuredClone(registry);
  injected.agents[0].source='https://evil.example/';
  assert.throws(()=>readRegistry(injected));
  const renamed = structuredClone(registry);
  renamed.agents[0].name='Root agent';
  assert.throws(()=>readRegistry(renamed));
});

test('tampered catalog cannot enable PR creation, omit a deny or add unknown privileges', () => {
  const source = buildRegistry([repo('CoderaxAI', 'Coderax')], owners);
  for (const [permission, value] of [['createPr', true], ['read', false], ['write', true], ['merge', true], ['deploy', true]]) {
    const modified = structuredClone(source);
    modified.agents[0].permissions[permission] = value;
    assert.throws(() => readRegistry(modified), /permission ceilings/);
  }
  const missing = structuredClone(source);
  delete missing.agents[0].permissions.createPr;
  assert.throws(() => readRegistry(missing), /permission ceilings/);
  const extra = structuredClone(source);
  extra.agents[0].permissions.credentialExport = true;
  assert.throws(() => readRegistry(extra), /permission ceilings/);
});

test('imported agent metadata and binding status are fail-closed', () => {
  const source = buildRegistry([repo('CoderaxAI', 'Coderax')], owners);
  for (const [field, value] of [['owner', 'Other'], ['orchestration', 'Other'], ['deploymentExecutor', 'Other'], ['modelDeployment', 'own'], ['visibility', 'undisclosed'], ['branch', '../main']]) {
    const modified = structuredClone(source);
    modified.agents[0][field] = value;
    assert.throws(() => readRegistry(modified), /metadata mismatch/);
  }
  const unverified = structuredClone(source);
  unverified.agents[0].status = 'bound';
  assert.throws(() => readRegistry(unverified), /valid Coderax agent ID/);

  const spoofed = structuredClone(source);
  spoofed.agents[0].coderaxAgentId = 'agent-not-yet-verified';
  assert.throws(() => readRegistry(spoofed), /Unbound agents/);

  const validShape = structuredClone(source);
  validShape.agents[0].status = 'bound';
  validShape.agents[0].coderaxAgentId = 'agent-verified-by-server';
  assert.equal(readRegistry(validShape), validShape);
  // Even a valid local shape is not proof of live binding; --apply-workflows
  // must check Agent Management before using this ID.
});
