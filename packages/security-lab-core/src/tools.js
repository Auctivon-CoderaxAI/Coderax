import { toolAvailability } from './policy.js';

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

export const TOOLS = [
  {
    id: 'dns.lookup',
    name: 'DNS lookup',
    description: 'A, AAAA, CNAME, MX and TXT records for one host.',
    capability: 'passive',
    scope: 'network',
    builtin: true,
  },
  {
    id: 'tls.inspect',
    name: 'TLS inspection',
    description: 'Certificate chain, key type, protocol version and expiry.',
    capability: 'passive',
    scope: 'network',
    builtin: true,
  },
  {
    id: 'http.fingerprint',
    name: 'HTTP fingerprint',
    description: 'Status, headers, security headers and server banner for one origin.',
    capability: 'passive',
    scope: 'network',
    builtin: true,
  },
  {
    id: 'nmap',
    name: 'Nmap service discovery',
    description: 'Top ports with version detection at conservative timing.',
    capability: 'active_readonly',
    scope: 'network',
    binary: 'nmap',
    baseArgs: ['-sV', '-T3', '--top-ports', '100', '--max-retries', '2'],
    targetFlag: null,
  },
  {
    id: 'nuclei',
    name: 'Nuclei templates',
    description: 'Non-intrusive template set, rate limited.',
    capability: 'active_readonly',
    scope: 'network',
    binary: 'nuclei',
    baseArgs: ['-severity', 'info,low,medium,high,critical', '-rl', '20', '-ni'],
    targetFlag: '-u',
  },
  {
    id: 'semgrep',
    name: 'Semgrep static analysis',
    description: 'OWASP rules over a workspace checkout.',
    capability: 'local',
    scope: 'workspace',
    binary: 'semgrep',
    baseArgs: ['--config', 'p/owasp-top-ten', '--json', '--quiet'],
    targetFlag: null,
  },
  {
    id: 'trivy',
    name: 'Trivy dependency scan',
    description: 'Known vulnerabilities in dependencies and images.',
    capability: 'local',
    scope: 'workspace',
    binary: 'trivy',
    baseArgs: ['fs', '--quiet', '--format', 'json'],
    targetFlag: null,
  },
  {
    id: 'gitleaks',
    name: 'Gitleaks secret scan',
    description: 'Detect committed credentials without printing them.',
    capability: 'local',
    scope: 'workspace',
    binary: 'gitleaks',
    baseArgs: ['detect', '--no-banner', '--report-format', 'json', '--redact'],
    targetFlag: null,
  },
  {
    id: 'zap.baseline',
    name: 'ZAP baseline scan',
    description: 'Passive baseline against an authorized web target.',
    capability: 'active_readonly',
    scope: 'network',
    binary: 'zap-baseline.py',
    baseArgs: ['-m', '5', '-T', '60'],
    targetFlag: '-t',
  },
  {
    id: 'zap.active',
    name: 'ZAP active scan',
    description: 'Active scanning. Requires per-action approval and intrusive depth.',
    capability: 'intrusive',
    scope: 'network',
    binary: 'zap-full-scan.py',
    baseArgs: ['-m', '10', '-T', '120'],
    targetFlag: '-t',
  },
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) ?? null;
}

const SAFE_OPTION = /^[A-Za-z0-9._:-]+$/;

function assertArgument(value, label) {
  const s = String(value);
  if (s.includes('\0') || /[\r\n]/.test(s)) throw new ToolError('invalid_argument', `${label} contains control characters`);
  // Checked before the character whitelist: a leading dash is argument
  // injection, and that is the diagnosis an operator needs to see.
  if (s.startsWith('-')) throw new ToolError('argument_injection', `${label} must not begin with a dash`);
  if (!SAFE_OPTION.test(s)) throw new ToolError('invalid_argument', `${label} contains unsupported characters`);
  if (s.length > 253) throw new ToolError('invalid_argument', `${label} is too long`);
  return s;
}

export function buildArgs(toolId, { target, options = {} } = {}) {
  const tool = getTool(toolId);
  if (!tool) throw new ToolError('unknown_tool', `Unknown tool: ${toolId}`);
  if (!tool.binary) throw new ToolError('no_binary', `${toolId} is built in and has no external binary`);
  if (tool.scope === 'workspace' && !target) throw new ToolError('target_required', `${toolId} needs a workspace path`);

  const safeTarget = target ? assertArgument(target, 'target') : null;
  const argv = [...(tool.baseArgs ?? [])];

  for (const [key, value] of Object.entries(options)) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(key)) throw new ToolError('invalid_option', `Bad option name: ${key}`);
    if (typeof value === 'boolean') {
      if (value) argv.push(`--${key}`);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new ToolError('invalid_option', `Option ${key} must be a string, number or boolean`);
    }
    argv.push(`--${key}`, assertArgument(value, `option ${key}`));
  }

  if (safeTarget) {
    if (tool.targetFlag) argv.push(tool.targetFlag, safeTarget);
    else argv.push(safeTarget);
  }

  return { bin: tool.binary, args: argv, shell: false };
}

export function describeTools(env = {}) {
  return TOOLS.map((tool) => {
    const availability = toolAvailability(tool, env);
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      capability: tool.capability,
      scope: tool.scope,
      available: availability.available,
      reason: availability.reason,
    };
  });
}
