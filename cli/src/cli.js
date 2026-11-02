import { EXIT, CoderaxError, usageError } from './client.js';
import { VERSION, commands } from './commands.js';
import { maskToken, resolveSettings } from './config.js';

const GLOBAL_FLAGS = new Set([
  'json',
  'help',
  'version',
  'base-url',
  'token',
  'model',
  'endpoint',
  'chat-path',
  'url',
  'no-color',
]);

const ALIASES = new Map([
  ['-h', 'help'],
  ['--help', 'help'],
  ['-v', 'version'],
  ['--version', 'version'],
]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let wantsHelp = false;
  let wantsVersion = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (ALIASES.has(arg)) {
      const name = ALIASES.get(arg);
      if (name === 'help') {
        wantsHelp = true;
      } else {
        wantsVersion = true;
      }
      continue;
    }

    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split('=');
    if (!GLOBAL_FLAGS.has(rawName)) {
      throw usageError(`Unknown option "--${rawName}".`, 'Run `coderax --help`.');
    }

    const camel = rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (rawName === 'no-color') {
      flags.color = false;
      continue;
    }

    const value = inlineValue ?? (() => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        return true;
      }
      index += 1;
      return next;
    })();

    flags[camel] = value;
  }

  return { positional, flags, wantsHelp, wantsVersion };
}

/**
 * Runs the CLI in-process so tests can assert exit codes and output without
 * spawning a child. The binary in bin/ is a thin wrapper around this.
 */
export async function runCli(argv, options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const out = (text = '', { newline = true } = {}) => {
    stdout.write(newline ? `${text}\n` : String(text));
  };
  const err = (text = '') => {
    stderr.write(`${text}\n`);
  };

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    err(`error: ${error.message}`);
    if (error.hint) {
      err(`hint: ${error.hint}`);
    }
    return EXIT.USAGE;
  }

  const { positional, flags, wantsHelp, wantsVersion } = parsed;

  if (wantsVersion && positional.length === 0) {
    out(flags.json ? JSON.stringify({ version: VERSION }) : VERSION);
    return EXIT.OK;
  }

  const name = positional[0] ?? 'help';
  const command = commands[name];

  if (!command) {
    err(`error: unknown command "${name}".`);
    err('Run `coderax --help` for the command list.');
    return EXIT.USAGE;
  }

  if (wantsHelp && name !== 'help') {
    return commands.help(buildContext({ flags, positional: [], env, out, err, options }));
  }

  const ctx = buildContext({
    flags,
    positional: positional.slice(1),
    env,
    out,
    err,
    options,
  });

  try {
    return await command(ctx);
  } catch (error) {
    if (error instanceof CoderaxError) {
      err(`error: ${error.message}`);
      if (error.hint) {
        err(`hint: ${error.hint}`);
      }
      if (error.code === EXIT.CANCELLED) {
        err('cancelled.');
      }
      return error.code;
    }
    err(`error: ${error?.message ?? error}`);
    return EXIT.ERROR;
  }
}

function buildContext({ flags, positional, env, out, err, options }) {
  const settings = resolveSettings({
    env,
    flags: {
      baseUrl: typeof flags.baseUrl === 'string' ? flags.baseUrl : undefined,
      chatPath: typeof flags.chatPath === 'string' ? flags.chatPath : undefined,
      endpoint: typeof flags.endpoint === 'string' ? flags.endpoint : undefined,
      model: typeof flags.model === 'string' ? flags.model : undefined,
    },
  });

  return {
    args: positional,
    flags,
    env,
    settings,
    out,
    err,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    stdinIsTTY: options.stdinIsTTY ?? Boolean(process.stdin.isTTY),
    readSecret: options.readSecret ?? readStdin,
    json: Boolean(flags.json),
  };
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

export { maskToken };
