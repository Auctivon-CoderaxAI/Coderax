import type winston from 'winston';

type ConsoleTransport = winston.transport & { silent?: boolean };

/**
 * The console transport is built once at module load from the environment, so
 * each case re-imports the logger with the env it is describing.
 */
const loadConsoleTransport = async (
  env: Record<string, string | undefined>,
): Promise<ConsoleTransport> => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    jest.resetModules();
    const { default: logger } = await import('./winston');
    return logger.transports.find(
      (candidate) => candidate.constructor.name === 'Console',
    ) as ConsoleTransport;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
};

const loadLoggerTransports = async (
  env: Record<string, string | undefined>,
  loggerModule: 'winston' | 'meiliLogger' = 'winston',
): Promise<winston.transport[]> => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    jest.resetModules();
    const { default: logger } =
      loggerModule === 'meiliLogger' ? await import('./meiliLogger') : await import('./winston');
    return logger.transports;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
};

describe('console transport level', () => {
  const baseEnv = { LOG_TO_FILE: 'false', CONSOLE_JSON: undefined, DEBUG_CONSOLE: undefined };

  it('defaults to info when nothing is set', async () => {
    const transport = await loadConsoleTransport({ ...baseEnv, CONSOLE_LOG_LEVEL: undefined });
    expect(transport.level).toBe('info');
    expect(transport.silent).toBeFalsy();
  });

  it('uses console-only logging on Vercel when file logging is otherwise enabled by default', async () => {
    const transports = await loadLoggerTransports({
      LOG_TO_FILE: undefined,
      VERCEL: '1',
      CONSOLE_JSON: undefined,
      DEBUG_CONSOLE: undefined,
    });
    expect(transports.map((transport) => transport.constructor.name)).toEqual(['Console']);
  });

  it('uses console-only logging for the Meilisearch logger on Vercel too', async () => {
    const transports = await loadLoggerTransports(
      {
        LOG_TO_FILE: undefined,
        VERCEL: '1',
        CONSOLE_LOG_LEVEL: undefined,
      },
      'meiliLogger',
    );
    expect(transports.map((transport) => transport.constructor.name)).toEqual(['Console']);
  });

  it('honors an explicit level', async () => {
    const transport = await loadConsoleTransport({ ...baseEnv, CONSOLE_LOG_LEVEL: 'error' });
    expect(transport.level).toBe('error');
  });

  it('silences the transport without handing winston an invalid level', async () => {
    const transport = await loadConsoleTransport({ ...baseEnv, CONSOLE_LOG_LEVEL: 'silent' });
    expect(transport.silent).toBe(true);
    expect(transport.level).toBe('info');
  });

  it('still defaults to debug under DEBUG_CONSOLE', async () => {
    const transport = await loadConsoleTransport({
      ...baseEnv,
      DEBUG_CONSOLE: 'true',
      CONSOLE_LOG_LEVEL: undefined,
    });
    expect(transport.level).toBe('debug');
  });

  it('lets an explicit level win over DEBUG_CONSOLE', async () => {
    const transport = await loadConsoleTransport({
      ...baseEnv,
      DEBUG_CONSOLE: 'true',
      CONSOLE_LOG_LEVEL: 'error',
    });
    expect(transport.level).toBe('error');
  });

  it('can be silenced under DEBUG_CONSOLE too', async () => {
    const transport = await loadConsoleTransport({
      ...baseEnv,
      DEBUG_CONSOLE: 'true',
      CONSOLE_LOG_LEVEL: 'silent',
    });
    expect(transport.silent).toBe(true);
  });

  it('falls back to the default rather than muting on an unknown level', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transport = await loadConsoleTransport({ ...baseEnv, CONSOLE_LOG_LEVEL: 'warning' });
      expect(transport.level).toBe('info');
      expect(transport.silent).toBeFalsy();
    } finally {
      warn.mockRestore();
    }
  });
});
