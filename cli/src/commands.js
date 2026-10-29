import fs from 'node:fs';
import path from 'node:path';

import {
  PRODUCTS,
  STATUS_LABELS,
  getOrderedProducts,
} from '../../packages/product-registry/index.js';

import {
  EXIT,
  CoderaxError,
  CoderaxClient,
  unavailableError,
  usageError,
} from './client.js';
import {
  clearCredentials,
  configDir,
  loadConfig,
  maskToken,
  resolveSettings,
  saveConfig,
  saveCredentials,
} from './config.js';

const VERSION = readVersion();

function readVersion() {
  try {
    const file = new URL('../package.json', import.meta.url);
    return JSON.parse(fs.readFileSync(file, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

const CONFIG_KEYS = Object.freeze({
  'base-url': 'baseUrl',
  'chat-path': 'chatPath',
  endpoint: 'endpoint',
  model: 'model',
});

function client(ctx) {
  return new CoderaxClient({
    baseUrl: ctx.settings.baseUrl,
    token: ctx.settings.token,
    fetchImpl: ctx.fetchImpl,
  });
}

function table(rows, headers) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell).padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '\u2500'.repeat(width))), ...rows.map(line)];
}

export const commands = {
  async help(ctx) {
    ctx.out(`Coderax CLI ${VERSION} \u2014 five products, one account.

Usage: coderax <command> [options]

Products
  products              List Desktop, CLI, Web, Cloud and Chat with real status
  chat [message]        Stream a chat response
  work [message]        Stream a Work-mode response
  models                List models available to your account
  agents                List agents available to your account
  cloud                 Report Cloud availability
  projects              List Cloud projects (unavailable until Cloud ships)

Account
  login [--token <t>]   Store an API token (verified before saving)
  logout                Remove stored credentials
  status                Show configuration and authentication state

Configuration
  config [list]         Show configuration
  config get <key>      Read one key (base-url, chat-path, endpoint, model)
  config set <key> <v>  Write one key
  doctor                Diagnose configuration, credentials and connectivity
  update                Show how to update this installation

Options
  --json                Machine-readable output on stdout
  --base-url <url>      Override the API origin for this invocation
  --model <id>          Override the model for this invocation
  --help, --version

Exit codes
  0 ok \u00b7 1 error \u00b7 2 usage \u00b7 3 unauthenticated \u00b7 4 network \u00b7 5 not found
  6 unavailable \u00b7 130 cancelled
`);
    return EXIT.OK;
  },

  async version(ctx) {
    ctx.out(ctx.json ? JSON.stringify({ version: VERSION }) : VERSION);
    return EXIT.OK;
  },

  async products(ctx) {
    const products = getOrderedProducts();

    if (ctx.json) {
      ctx.out(JSON.stringify({ products }, null, 2));
      return EXIT.OK;
    }

    const rows = products.map((product) => [
      product.name,
      STATUS_LABELS[product.status],
      product.status === 'live' ? product.tagline : product.availabilityNote,
    ]);
    ctx.out(table(rows, ['PRODUCT', 'STATUS', 'DETAIL']).join('\n'));
    ctx.out('');
    ctx.out('Launch states are verified, not aspirational. See `coderax doctor`.');
    return EXIT.OK;
  },

  async status(ctx) {
    const { settings, env } = ctx;
    const payload = {
      version: VERSION,
      baseUrl: settings.baseUrl || null,
      authenticated: Boolean(settings.token),
      token: maskToken(settings.token),
      tokenSource: settings.tokenSource,
      account: settings.account,
      configDir: configDir(env),
      model: settings.model || null,
      endpoint: settings.endpoint,
    };

    if (ctx.json) {
      ctx.out(JSON.stringify(payload, null, 2));
      return EXIT.OK;
    }

    ctx.out(`Coderax CLI      ${VERSION}`);
    ctx.out(`API              ${payload.baseUrl ?? '(not configured)'}`);
    ctx.out(
      `Authentication   ${payload.authenticated ? `yes (${payload.token}, via ${payload.tokenSource})` : 'no \u2014 run `coderax login`'}`,
    );
    if (payload.account) {
      ctx.out(`Account          ${payload.account}`);
    }
    ctx.out(`Config           ${payload.configDir}`);
    return EXIT.OK;
  },

  async login(ctx) {
    const token = ctx.flags.token || ctx.env.CODERAX_TOKEN || (await ctx.readSecret());

    if (!token) {
      throw usageError('No token provided.', 'Use `coderax login --token <token>` or pipe it on stdin.');
    }

    const probe = new CoderaxClient({
      baseUrl: ctx.settings.baseUrl,
      token,
      fetchImpl: ctx.fetchImpl,
    });

    let account = null;
    try {
      const user = await probe.request('/api/user');
      account = user?.email ?? user?.username ?? user?.name ?? null;
    } catch (error) {
      // A 404 means the deployment does not expose /api/user; anything else is
      // a real rejection and must not be stored.
      if (error.code !== EXIT.NOT_FOUND) {
        throw error;
      }
    }

    saveCredentials({ token, account, savedAt: new Date().toISOString() }, ctx.env);
    ctx.out(
      ctx.json
        ? JSON.stringify({ authenticated: true, token: maskToken(token), account })
        : `Signed in${account ? ` as ${account}` : ''}. Token stored with 0600 permissions.`,
    );
    return EXIT.OK;
  },

  async logout(ctx) {
    const removed = clearCredentials(ctx.env);
    ctx.out(ctx.json ? JSON.stringify({ removed }) : removed ? 'Signed out.' : 'No stored credentials.');
    return EXIT.OK;
  },

  async chat(ctx) {
    return streamPrompt(ctx, 'chat');
  },

  async work(ctx) {
    return streamPrompt(ctx, 'work');
  },

  async models(ctx) {
    const result = await client(ctx).request('/api/models');
    const models = Array.isArray(result) ? result : (result?.data ?? []);

    if (ctx.json) {
      ctx.out(JSON.stringify({ models }, null, 2));
      return EXIT.OK;
    }
    if (models.length === 0) {
      ctx.out('No models returned for this account.');
      return EXIT.OK;
    }
    ctx.out(
      table(
        models.map((model) => [
          model.id ?? model.model ?? model.name ?? '(unnamed)',
          model.provider ?? model.endpoint ?? '',
        ]),
        ['MODEL', 'PROVIDER'],
      ).join('\n'),
    );
    return EXIT.OK;
  },

  async agents(ctx) {
    const result = await client(ctx).request('/api/agents');
    const agents = Array.isArray(result) ? result : (result?.data ?? []);

    if (ctx.json) {
      ctx.out(JSON.stringify({ agents }, null, 2));
      return EXIT.OK;
    }
    if (agents.length === 0) {
      ctx.out('No agents returned for this account.');
      return EXIT.OK;
    }
    ctx.out(
      table(
        agents.map((agent) => [
          agent.id ?? '(no id)',
          agent.name ?? '(unnamed)',
          agent.description ?? '',
        ]),
        ['ID', 'NAME', 'DESCRIPTION'],
      ).join('\n'),
    );
    return EXIT.OK;
  },

  async cloud(ctx) {
    const cloud = PRODUCTS.find((product) => product.id === 'cloud');
    const message = `Coderax Cloud is ${STATUS_LABELS[cloud.status].toLowerCase()}: ${cloud.availabilityNote}`;

    if (ctx.json) {
      ctx.out(JSON.stringify({ status: cloud.status, message, roadmap: cloud.roadmap }, null, 2));
      return EXIT.UNAVAILABLE;
    }
    ctx.out(message);
    ctx.out('');
    ctx.out('Roadmap:');
    for (const item of cloud.roadmap) {
      ctx.out(`  \u2022 ${item}`);
    }
    ctx.err('Nothing was executed and nothing was billed.');
    return EXIT.UNAVAILABLE;
  },

  async projects(ctx) {
    if (ctx.json) {
      ctx.out(
        JSON.stringify(
          {
            projects: [],
            unavailable: true,
            reason: 'Cloud workspaces are not implemented in this repository yet.',
          },
          null,
          2,
        ),
      );
      return EXIT.UNAVAILABLE;
    }
    ctx.err('Cloud workspaces are not implemented yet, so there are no projects to list.');
    return EXIT.UNAVAILABLE;
  },

  async config(ctx) {
    const [action = 'list', key, ...rest] = ctx.args;

    if (action === 'list') {
      const config = loadConfig(ctx.env);
      if (ctx.json) {
        ctx.out(JSON.stringify(config, null, 2));
        return EXIT.OK;
      }
      ctx.out(`Config file  ${path.join(configDir(ctx.env), 'config.json')}`);
      for (const [name, value] of Object.entries(config)) {
        ctx.out(`  ${name.padEnd(10)} ${value === '' ? '(unset)' : value}`);
      }
      return EXIT.OK;
    }

    if (action === 'get') {
      if (!key || !(key in CONFIG_KEYS)) {
        throw usageError(
          `Unknown key "${key ?? ''}".`,
          `Known keys: ${Object.keys(CONFIG_KEYS).join(', ')}`,
        );
      }
      const value = loadConfig(ctx.env)[CONFIG_KEYS[key]];
      ctx.out(ctx.json ? JSON.stringify({ [key]: value }) : String(value || '(unset)'));
      return EXIT.OK;
    }

    if (action === 'set') {
      if (!key || !(key in CONFIG_KEYS)) {
        throw usageError(
          `Unknown key "${key ?? ''}".`,
          `Known keys: ${Object.keys(CONFIG_KEYS).join(', ')}`,
        );
      }
      const value = rest.join(' ').trim();
      if (!value) {
        throw usageError(`Missing value for "${key}".`);
      }
      const config = loadConfig(ctx.env);
      config[CONFIG_KEYS[key]] = value;
      saveConfig(config, ctx.env);
      ctx.out(ctx.json ? JSON.stringify({ [key]: value }) : `${key} = ${value}`);
      return EXIT.OK;
    }

    throw usageError(`Unknown config action "${action}".`, 'Use list, get or set.');
  },

  async doctor(ctx) {
    const checks = [];
    const major = Number(process.versions.node.split('.')[0]);

    checks.push({
      name: 'node',
      ok: major >= 18,
      detail: process.versions.node,
      hint: major >= 18 ? '' : 'Node 18.17 or newer is required.',
    });

    const dir = configDir(ctx.env);
    let dirMode = null;
    try {
      dirMode = (fs.statSync(dir).mode & 0o777).toString(8);
    } catch {
      dirMode = null;
    }
    checks.push({
      name: 'config-dir',
      ok: dirMode === null || dirMode === '700',
      detail: dirMode === null ? `${dir} (not created yet)` : `${dir} (${dirMode})`,
      hint: dirMode === null || dirMode === '700' ? '' : 'Run `chmod 700` on the config directory.',
    });

    checks.push({
      name: 'base-url',
      ok: Boolean(ctx.settings.baseUrl),
      detail: ctx.settings.baseUrl || '(unset)',
      hint: ctx.settings.baseUrl
        ? ''
        : 'Run `coderax config set base-url https://your-deployment`.',
    });

    checks.push({
      name: 'auth',
      ok: Boolean(ctx.settings.token),
      detail: ctx.settings.token
        ? `${maskToken(ctx.settings.token)} via ${ctx.settings.tokenSource}`
        : 'no token',
      hint: ctx.settings.token ? '' : 'Run `coderax login`.',
    });

    if (ctx.settings.baseUrl) {
      try {
        await client(ctx).request('/api/health');
        checks.push({ name: 'reachability', ok: true, detail: 'GET /api/health ok', hint: '' });
      } catch (error) {
        checks.push({
          name: 'reachability',
          ok: false,
          detail: error.message,
          hint: 'Confirm the deployment URL and that /api/health is exposed.',
        });
      }
    }

    const ok = checks.every((check) => check.ok);

    if (ctx.json) {
      ctx.out(JSON.stringify({ ok, version: VERSION, checks }, null, 2));
      return ok ? EXIT.OK : EXIT.ERROR;
    }
    for (const check of checks) {
      ctx.out(`${check.ok ? '\u2713' : '\u2717'} ${check.name.padEnd(14)} ${check.detail}`);
      if (!check.ok && check.hint) {
        ctx.out(`  \u2192 ${check.hint}`);
      }
    }
    return ok ? EXIT.OK : EXIT.ERROR;
  },

  async update(ctx) {
    const message =
      'This build is not published to a registry yet. Update by pulling the '
      + 'Coderax repository and running `node cli/bin/coderax.js` again, or '
      + 'reinstall once @coderax/cli is published.';
    ctx.out(ctx.json ? JSON.stringify({ version: VERSION, message }) : message);
    return EXIT.OK;
  },
};

async function streamPrompt(ctx, mode) {
  if (!ctx.args.length && !ctx.stdinIsTTY) {
    throw usageError('No message provided.', `Usage: coderax ${mode} "your prompt"`);
  }
  const text = ctx.args.join(' ').trim();
  if (!text) {
    throw usageError('No message provided.', `Usage: coderax ${mode} "your prompt"`);
  }
  // Report the most fundamental prerequisite first: without an origin there is
  // nothing to authenticate against, so "run login" would be misleading.
  if (!ctx.settings.baseUrl) {
    throw usageError(
      'No Coderax API base URL configured.',
      'Run `coderax config set base-url https://your-deployment` or set CODERAX_BASE_URL.',
    );
  }
  if (!ctx.settings.token) {
    throw new CoderaxError('Not signed in.', {
      code: EXIT.UNAUTHENTICATED,
      hint: 'Run `coderax login` first.',
    });
  }

  const api = client(ctx);
  const body = {
    text,
    mode,
    endpoint: ctx.settings.endpoint,
    model: ctx.settings.model || undefined,
  };

  const streamed = [];
  const assembled = await api.stream(
    ctx.flags.url || ctx.settings.chatPath,
    {
      body,
      signal: ctx.signal,
      onEvent: (event) => {
        if (event.type === 'delta') {
          streamed.push(event.text);
          if (!ctx.json) {
            ctx.out(event.text, { newline: false });
          }
        }
      },
    },
  );

  if (ctx.json) {
    ctx.out(JSON.stringify({ mode, text: assembled || streamed.join(''), events: streamed.length }, null, 2));
  } else if (assembled || streamed.length) {
    ctx.out('');
  } else {
    ctx.err('The server accepted the request but streamed no text.');
    return EXIT.ERROR;
  }

  return EXIT.OK;
}

export { VERSION, unavailableError };
