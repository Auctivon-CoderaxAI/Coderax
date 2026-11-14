import { classifyAddress, ipv4InCidr, parseIPv4, parseIPv6, ipv6InCidr } from './ip.js';

export class ScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
  }
}

const HOST_RE = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isIpLiteral(s) {
  return Boolean(parseIPv4(s) || parseIPv6(s));
}

export function parseTarget(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ScopeError('invalid_target', 'Target must be a non-empty string');
  }
  let raw = input.trim();

  if (raw.includes('@')) throw new ScopeError('invalid_target', 'Targets must not carry credentials');
  if (/\s/.test(raw)) throw new ScopeError('invalid_target', 'Targets must not contain whitespace');
  if (raw.includes('\0')) throw new ScopeError('invalid_target', 'Targets must not contain control bytes');

  if (raw.includes('://')) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new ScopeError('invalid_target', `Unparseable URL: ${raw}`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ScopeError('invalid_scheme', `Only http and https targets are supported, got ${url.protocol}`);
    }
    if (url.username || url.password) throw new ScopeError('invalid_target', 'Targets must not carry credentials');
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new ScopeError('invalid_target', 'Declare origins, not paths');
    }
    raw = url.hostname;
  }

  raw = raw.replace(/\.$/, '').toLowerCase();

  if (raw.includes('/')) {
    const [base, bits] = raw.split('/');
    if (!/^\d{1,3}$/.test(bits ?? '')) throw new ScopeError('invalid_target', `Bad CIDR: ${input}`);
    if (parseIPv4(base)) {
      const n = Number(bits);
      if (n < 0 || n > 32) throw new ScopeError('invalid_target', `Bad CIDR prefix: ${input}`);
      if (n < 8) throw new ScopeError('scope_too_broad', `CIDR ${input} is wider than /8`);
      return { kind: 'cidr', value: `${base}/${n}`, family: 'ipv4' };
    }
    if (parseIPv6(base)) {
      const n = Number(bits);
      if (n < 0 || n > 128) throw new ScopeError('invalid_target', `Bad CIDR prefix: ${input}`);
      if (n < 16) throw new ScopeError('scope_too_broad', `CIDR ${input} is wider than /16`);
      return { kind: 'cidr', value: `${base}/${n}`, family: 'ipv6' };
    }
    throw new ScopeError('invalid_target', `CIDR base is not an address: ${input}`);
  }

  if (isIpLiteral(raw)) return { kind: 'ip', value: raw };

  if (/^[0-9.]+$/.test(raw)) throw new ScopeError('invalid_target', `Non-canonical address: ${input}`);

  const bare = raw.startsWith('*.') ? raw.slice(2) : raw;
  if (!HOST_RE.test(raw) || !bare.split('.').every((l) => LABEL_RE.test(l))) {
    throw new ScopeError('invalid_target', `Not a valid hostname: ${input}`);
  }
  return { kind: raw.startsWith('*.') ? 'wildcard' : 'host', value: raw };
}

function targetMatchesHost(target, host) {
  if (target.kind === 'host') return target.value === host;
  if (target.kind === 'wildcard') {
    const base = target.value.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return false;
}

function targetMatchesAddress(target, address) {
  if (target.kind === 'ip') return target.value === address;
  if (target.kind !== 'cidr') return false;
  const v4 = parseIPv4(address);
  if (v4 && target.family === 'ipv4') return ipv4InCidr(v4, target.value);
  const v6 = parseIPv6(address);
  if (v6 && target.family === 'ipv6') return ipv6InCidr(v6, target.value);
  return false;
}

export function nameInScope(host, targets) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (isIpLiteral(h)) return targets.some((t) => targetMatchesAddress(t, h));
  return targets.some((t) => targetMatchesHost(t, h));
}

export function assertAuthorized(engagement) {
  if (!engagement || typeof engagement !== 'object') {
    throw new ScopeError('no_engagement', 'An engagement is required');
  }
  const auth = engagement.authorization;
  if (!auth || typeof auth !== 'object') {
    throw new ScopeError('not_authorized', 'Engagement has no recorded authorization');
  }
  if (typeof auth.attestedBy !== 'string' || !auth.attestedBy.trim()) {
    throw new ScopeError('not_authorized', 'Authorization must record who attested it');
  }
  if (!auth.attestedAt || Number.isNaN(Date.parse(auth.attestedAt))) {
    throw new ScopeError('not_authorized', 'Authorization must record when it was attested');
  }
  if (!auth.statement || typeof auth.statement !== 'string') {
    throw new ScopeError('not_authorized', 'Authorization must reference the statement that was accepted');
  }
  if (!Array.isArray(engagement.targets) || engagement.targets.length === 0) {
    throw new ScopeError('no_targets', 'Engagement must declare at least one target');
  }
  return engagement.targets.map((t) => parseTarget(typeof t === 'string' ? t : t.value));
}

export function engagementTargets(engagement) {
  return assertAuthorized(engagement);
}

/**
 * Call twice: at plan time and again immediately before connect. The second
 * call is what defeats DNS rebinding.
 */
export async function assertTargetInScope(targetInput, engagement, options = {}) {
  const parsedTarget = parseTarget(targetInput);
  const targets = engagementTargets(engagement);
  const resolve = options.resolve;

  if (parsedTarget.kind === 'cidr') {
    throw new ScopeError('invalid_target', 'A job target must be a host or an address, not a CIDR block');
  }

  if (parsedTarget.kind === 'ip') {
    const inScope = targets.some((t) => targetMatchesAddress(t, parsedTarget.value));
    if (!inScope) {
      throw new ScopeError('out_of_scope', `${parsedTarget.value} is not declared in this engagement`);
    }
    const cls = classifyAddress(parsedTarget.value);
    if (cls.blocked) {
      throw new ScopeError('blocked_address', `Refusing ${parsedTarget.value}: ${cls.reason}`);
    }
    return { host: parsedTarget.value, addresses: [parsedTarget.value] };
  }

  if (!nameInScope(parsedTarget.value, targets)) {
    throw new ScopeError('out_of_scope', `${parsedTarget.value} is not declared in this engagement`);
  }

  if (typeof resolve !== 'function') {
    return { host: parsedTarget.value, addresses: null, unresolved: true };
  }

  let records;
  try {
    records = await resolve(parsedTarget.value);
  } catch {
    throw new ScopeError('resolution_failed', `Could not resolve ${parsedTarget.value}`);
  }
  const addresses = (records ?? []).map((r) => (typeof r === 'string' ? r : r.address)).filter(Boolean);
  if (addresses.length === 0) {
    throw new ScopeError('resolution_failed', `${parsedTarget.value} resolved to no addresses`);
  }
  for (const address of addresses) {
    const cls = classifyAddress(address);
    if (cls.blocked) {
      throw new ScopeError('blocked_address', `Refusing ${parsedTarget.value} → ${address}: ${cls.reason}`);
    }
  }
  return { host: parsedTarget.value, addresses };
}
