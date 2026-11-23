/**
 * Local llama.cpp server for development.
 *
 *   npm run dev:model              install if missing, then serve 127.0.0.1:8080
 *   npm run dev:model -- --install install only, do not serve
 *
 * Installs a pinned llama.cpp CPU release for Linux x64 and a pinned revision of
 * the Qwen2.5-1.5B Instruct Q4_K_M GGUF into .dev/model/, then runs llama-server
 * there. Keeping both files inside the repository means the local model survives
 * restarts and archives; `coderax.yaml` points the `llamacpp` endpoint here.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { alias, binPath, ggufPath, host, modelDir, port, serverArgs } from './model-paths.mjs';

const release = 'b12597';
// SHA-256 published for this exact asset by the upstream GitHub release.
const binarySha256 = '34d3514902e08ceb05ca3f3e3ac2a928e4f4a8b5b40cd98838d0aeae4fd9dc42';
const binaryUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${release}/llama-${release}-bin-ubuntu-x64.tar.gz`;

/** Commit, not `main`, so an upstream change cannot silently alter the model. */
const ggufRevision = '91cad51170dc346986eccefdc2dd33a9da36ead9';
const ggufUrl = `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/${ggufRevision}/qwen2.5-1.5b-instruct-q4_k_m.gguf`;
const ggufSha256 = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e';

function fail(message) {
  console.error(`[model] ${message}`);
  process.exit(1);
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let nextReport = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (total > 0 && received >= nextReport) {
      console.log(
        `[model]   ${Math.round((received / total) * 100)}% of ${Math.round(total / 1e6)} MB`,
      );
      nextReport = received + total / 4;
    }
  });
  await pipeline(body, fs.createWriteStream(target));
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function installBinary() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    fail(
      `no prebuilt llama-server for ${process.platform}/${process.arch}; install llama.cpp yourself and put llama-server and its libraries in ${path.dirname(binPath)}`,
    );
  }
  console.log(`[model] downloading llama.cpp ${release}`);
  const staging = fs.mkdtempSync(path.join(modelDir, '.llama-'));
  try {
    const archive = path.join(staging, 'llama.tar.gz');
    const extracted = path.join(staging, 'bin');
    await download(binaryUrl, archive);
    const digest = await sha256(archive);
    if (digest !== binarySha256) {
      throw new Error(`llama.cpp archive checksum mismatch (got ${digest}); refusing to extract`);
    }
    fs.mkdirSync(extracted);
    // The archive has one top-level directory; keep only the server and its libraries.
    execFileSync(
      'tar',
      [
        '-xzf',
        archive,
        '-C',
        extracted,
        '--strip-components=1',
        '--wildcards',
        '*/llama-server',
        '*/lib*.so*',
      ],
      { stdio: 'inherit' },
    );
    fs.accessSync(path.join(extracted, 'llama-server'), fs.constants.X_OK);
    try {
      fs.renameSync(extracted, path.dirname(binPath));
    } catch (error) {
      // Another installer may have published its complete directory first.
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !fs.existsSync(binPath)) {
        throw error;
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log(`[model] installed ${binPath}`);
}

async function installModel() {
  console.log('[model] downloading Qwen2.5-1.5B-Instruct Q4_K_M');
  const staging = fs.mkdtempSync(path.join(modelDir, '.gguf-'));
  try {
    const partial = path.join(staging, 'model.part');
    await download(ggufUrl, partial);
    const digest = await sha256(partial);
    if (digest !== ggufSha256) {
      throw new Error(`GGUF checksum mismatch (got ${digest}); re-run to download it again`);
    }
    fs.renameSync(partial, ggufPath);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log(`[model] installed ${ggufPath}`);
}

function serve() {
  console.log(`[model] ${alias} on http://${host}:${port} (Ctrl+C stops it)`);
  const child = spawn(binPath, serverArgs, { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code) => process.exit(code ?? 1));
}

try {
  fs.mkdirSync(modelDir, { recursive: true });
  if (!fs.existsSync(binPath)) {
    await installBinary();
  }
  if (!fs.existsSync(ggufPath)) {
    await installModel();
  }
  if (!process.argv.includes('--install')) {
    serve();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
