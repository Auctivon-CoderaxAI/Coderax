/** Resolve the Express listener from explicit environment inputs. */
export function resolveApiListener({
  HOST,
  PORT,
  VERCEL,
  CODERAX_LOCAL_DEV,
}: {
  HOST?: string;
  PORT?: string;
  VERCEL?: string;
  CODERAX_LOCAL_DEV?: string;
}): { host: string; port: number } {
  const localDev = CODERAX_LOCAL_DEV === '1';
  const hostedOnVercel = VERCEL === '1' && !localDev;
  const defaultHost = localDev ? '127.0.0.1' : 'localhost';
  return {
    host: HOST || (hostedOnVercel ? '0.0.0.0' : defaultHost),
    // Express supports PORT=0 for automatic free port assignment.
    port: isNaN(Number(PORT)) ? 3080 : Number(PORT),
  };
}
