/**
 * Secret scrubbing for anything that leaves Coderax: provider requests, log
 * lines and diagnostics. Redaction is pattern-based and also removes the exact
 * values of sensitive environment variables, because a provider key has no
 * recognisable prefix in every deployment.
 */

export type ScrubOptions = {
  env?: Record<string, string | undefined>;
  /** Extra exact values to remove, for callers holding a credential handle. */
  knownSecrets?: readonly string[];
};

export type ScrubResult = {
  text: string;
  redactions: number;
};

const PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bgsk_[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED_TOKEN]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED_TOKEN]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, replacement: 'Bearer [REDACTED]' },
  {
    pattern:
      /("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,}]+)/gi,
    replacement: '$1"[REDACTED]"',
  },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/gi,
    replacement: '$1$2[REDACTED]',
  },
];

const SENSITIVE_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_?KEY)/i;

function exactValues(options: ScrubOptions): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value && SENSITIVE_ENV.test(name)) {
      values.add(value);
    }
  }
  for (const value of options.knownSecrets ?? []) {
    if (value) {
      values.add(value);
    }
  }
  // Longest first so a key that contains another value is fully removed.
  return [...values].sort((a, b) => b.length - a.length);
}

export function scrubSecrets(text: string, options: ScrubOptions = {}): ScrubResult {
  let output = text;
  let redactions = 0;
  for (const value of exactValues(options)) {
    if (!output.includes(value)) {
      continue;
    }
    const parts = output.split(value);
    redactions += parts.length - 1;
    output = parts.join('[REDACTED]');
  }
  for (const { pattern, replacement } of PATTERNS) {
    output = output.replace(pattern, (...args: unknown[]) => {
      redactions += 1;
      return replacement.replace(/\$(\d)/g, (_, index: string) =>
        String(args[Number(index)] ?? ''),
      );
    });
  }
  return { text: output, redactions };
}

/** Safe log metadata: a message with every recognisable secret removed. */
export function redactForLog(message: unknown, options: ScrubOptions = {}): string {
  const text = message instanceof Error ? `${message.name}: ${message.message}` : String(message);
  return scrubSecrets(text, options).text;
}
