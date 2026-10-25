export type MeiliLoggerEnvironment = {
  vercel?: string;
  logToFile?: string | boolean;
};

/** Vercel function filesystems are read-only; log file writes are disabled there by default. */
export const shouldUseMeiliFileLogging = ({
  vercel,
  logToFile = true,
}: MeiliLoggerEnvironment): boolean => {
  const enabled =
    (typeof logToFile === 'string' && logToFile.toLowerCase() !== 'false') || logToFile === true;
  return vercel !== '1' && enabled;
};
