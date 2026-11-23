#!/usr/bin/env node
/**
 * Real Freebuff cloud-agent smoke test.
 *
 * Runs the source-built Freebuff SDK against a verified $0 OpenRouter model and
 * asks it to create one file with a tool call. It prints event types, the final
 * text, and the workspace listing; it never prints a credential or provider
 * payload. Exits nonzero when no file was created or the run failed.
 *
 * Usage:
 *   FREEBUFF_SDK_PATH=/abs/path/to/freebuff/sdk/dist/index.cjs \
 *   OPENROUTER_API_KEY=... node scripts/probe-freebuff-agent.mjs
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const baseUrl = (process.env.FREEBUFF_CLOUD_BASE_URL || 'https://openrouter.ai/api/v1').replace(
  /\/+$/,
  '',
);
const model = process.env.FREEBUFF_CLOUD_MODEL || 'nvidia/nemotron-3.5-lightning:free';
const apiKey = process.env.OPENROUTER_API_KEY;
const sdkPath = process.env.FREEBUFF_SDK_PATH;

function redact(value) {
  const text = String(value ?? '');
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}

async function main() {
  if (!sdkPath) {
    throw new Error('FREEBUFF_SDK_PATH must point at the source-built SDK entrypoint');
  }
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set on this machine');
  }
  const sdk = require(sdkPath);
  if (typeof sdk.CodebuffClient !== 'function') {
    throw new Error('The configured SDK does not export CodebuffClient');
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'coderax-freebuff-smoke-'));
  const createdAt = new Date().toISOString();
  const client = new sdk.CodebuffClient({
    byok: {
      id: 'coderax-freebuff-smoke',
      revision: 1,
      name: 'Coderax free cloud model',
      provider: 'openrouter',
      model,
      baseUrl,
      credentialRef: 'env:OPENROUTER_API_KEY',
      createdAt,
      updatedAt: createdAt,
      apiKey,
    },
    cwd: workspace,
    agentDirs: [],
    agentDefinitions: [],
    disableAgentRegistry: true,
    includeHomeSkills: false,
    skillsLoader: async () => ({}),
    confineFileToolsToProject: true,
    refuseNonTextFileReads: true,
    maxAgentSteps: 6,
  });

  const eventTypes = [];
  let text = '';
  try {
    await client.run({
      agent: {
        id: 'coderax-freebuff-smoke',
        displayName: 'Freebuff cloud smoke agent',
        model: `openrouter/${model}`,
        outputMode: 'last_message',
        toolNames: ['read_files', 'write_file', 'list_directory', 'set_output', 'end_turn'],
        spawnableAgents: [],
        systemPrompt: 'You are Freebuff in Coderax Work. Create exactly the requested file.',
        instructionsPrompt:
          'Use write_file once. Do not use shell commands, contact external services, or access secrets.',
      },
      prompt:
        'Create a file named smoke.txt whose only line is CLOUD_AGENT_OK. Then finish with a one-line summary.',
      signal: AbortSignal.timeout(180_000),
      handleStreamChunk: (chunk) => {
        if (typeof chunk === 'string') {
          text += chunk;
        }
      },
      handleEvent: (event) => {
        if (event && typeof event.type === 'string') {
          eventTypes.push(event.type);
          if (event.type === 'tool_call' && typeof event.toolName === 'string') {
            process.stdout.write(`tool_call ${event.toolName}\n`);
          }
        }
      },
      onUsage: () => {},
    });

    const entries = await fs.readdir(workspace);
    process.stdout.write(`event_types ${[...new Set(eventTypes)].join(',') || 'none'}\n`);
    process.stdout.write(`workspace ${entries.join(',') || 'empty'}\n`);
    if (text.trim()) {
      process.stdout.write(`final_text ${redact(text.trim()).slice(0, 200)}\n`);
    }
    if (!entries.includes('smoke.txt')) {
      throw new Error('The agent completed without creating smoke.txt');
    }
    const content = (await fs.readFile(path.join(workspace, 'smoke.txt'), 'utf8')).trim();
    process.stdout.write(`smoke_content ${redact(content).slice(0, 100)}\n`);
    if (!content.includes('CLOUD_AGENT_OK')) {
      throw new Error('smoke.txt did not contain the requested marker');
    }
    process.stdout.write('FREEBUFF_AGENT_OK (cloud tool call and file write verified)\n');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`FREEBUFF_AGENT_CHECK_FAILED: ${redact(error?.message || error)}\n`);
  if (error?.stack) {
    process.stderr.write(`${redact(error.stack).split('\n').slice(0, 4).join('\n')}\n`);
  }
  process.exitCode = 1;
});
