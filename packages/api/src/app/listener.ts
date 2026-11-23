/** Choose the Express bind address, preserving explicit HOST values. */
export function resolveListenerHost(env: {
  HOST?: string;
  CODERAX_LOCAL_DEV?: string;
  VERCEL?: string;
  [key: string]: string | undefined;
}): string {
  if (env.HOST) {
    return env.HOST;
  }
  if (env.CODERAX_LOCAL_DEV === '1') {
    return '127.0.0.1';
  }
  // Vercel needs a network listener; local tooling also sets VERCEL for shell handling.
  return env.VERCEL === '1' ? '0.0.0.0' : 'localhost';
}
