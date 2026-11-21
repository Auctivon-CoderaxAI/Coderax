/**
 * Where the local model lives and how to run it.
 *
 * Shared by `dev:model` (install and serve) and `dev:up` (start it as part of
 * the stack) so the paths, alias and server flags have a single definition.
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const modelDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.dev/model',
);
export const binPath = path.join(modelDir, 'bin', 'llama-server');
export const ggufPath = path.join(modelDir, 'qwen2.5-1.5b-instruct-q4_k_m.gguf');

export const host = '127.0.0.1';
export const port = 8080;
export const alias = 'qwen2.5-1.5b-instruct';
const threads = Math.max(2, Math.min(8, os.cpus().length - 2));

export const serverArgs = [
  '-m',
  ggufPath,
  '--host',
  host,
  '--port',
  String(port),
  '--alias',
  alias,
  '--jinja',
  '-c',
  '4096',
  '-t',
  String(threads),
];
