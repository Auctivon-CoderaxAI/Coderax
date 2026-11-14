/**
 * Address parsing and classification.
 *
 * Non-canonical IPv4 spellings (octal, decimal, hex, short forms) are rejected
 * rather than normalised, because `0177.0.0.1` and `2130706433` both reach
 * 127.0.0.1 through some resolvers and HTTP clients.
 */

const V4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function parseIPv4(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!V4_RE.test(s)) return null;
  const parts = s.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

export function ipv4ToInt(parts) {
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

export function intToIPv4(int) {
  return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.');
}

export function parseIPv6(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s.includes(':')) return null;
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  if (s.includes('.')) {
    const cut = s.lastIndexOf(':');
    if (cut === -1) return null;
    const v4 = parseIPv4(s.slice(cut + 1));
    if (!v4) return null;
    s = `${s.slice(0, cut + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const parsed = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    parsed.push(parseInt(g, 16));
  }
  return parsed;
}

export function mappedIPv4(groups) {
  if (!Array.isArray(groups) || groups.length !== 8) return null;
  const zeroPrefix = groups.slice(0, 5).every((g) => g === 0);
  if (!zeroPrefix || groups[5] !== 0xffff) return null;
  return [(groups[6] >> 8) & 255, groups[6] & 255, (groups[7] >> 8) & 255, groups[7] & 255];
}

const BLOCKED_V4 = [
  [[0, 0, 0, 0], 8, 'unspecified-address'],
  [[10, 0, 0, 0], 8, 'private-range'],
  [[100, 64, 0, 0], 10, 'carrier-grade-nat'],
  [[127, 0, 0, 0], 8, 'loopback'],
  [[169, 254, 0, 0], 16, 'link-local-metadata'],
  [[172, 16, 0, 0], 12, 'private-range'],
  [[192, 168, 0, 0], 16, 'private-range'],
  [[224, 0, 0, 0], 4, 'multicast'],
  [[240, 0, 0, 0], 4, 'reserved-range'],
];

export function ipv4InCidr(parts, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const baseParts = parseIPv4(base);
  const bits = Number(bitsRaw);
  if (!baseParts || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(parts) & mask) >>> 0) === ((ipv4ToInt(baseParts) & mask) >>> 0);
}

export function ipv6InCidr(groups, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const baseGroups = parseIPv6(base);
  const bits = Number(bitsRaw);
  if (!baseGroups || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i += 1) {
    if (remaining <= 0) return true;
    const width = Math.min(16, remaining);
    const mask = width === 16 ? 0xffff : (0xffff << (16 - width)) & 0xffff;
    if ((groups[i] & mask) !== (baseGroups[i] & mask)) return false;
    remaining -= width;
  }
  return true;
}

export function classifyAddress(input) {
  const v4 = parseIPv4(input);
  if (v4) {
    for (const [base, bits, reason] of BLOCKED_V4) {
      if (ipv4InCidr(v4, `${base.join('.')}/${bits}`)) {
        return { blocked: true, reason, family: 'ipv4' };
      }
    }
    return { blocked: false, reason: null, family: 'ipv4' };
  }

  const v6 = parseIPv6(input);
  if (!v6) return { blocked: true, reason: 'unparseable-address', family: 'ipv6' };

  const mapped = mappedIPv4(v6);
  if (mapped) {
    const inner = classifyAddress(mapped.join('.'));
    return { blocked: inner.blocked, reason: inner.reason, family: 'ipv6', mappedFrom: mapped.join('.') };
  }

  if (v6.every((g) => g === 0)) return { blocked: true, reason: 'unspecified-address', family: 'ipv6' };
  if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return { blocked: true, reason: 'loopback', family: 'ipv6' };
  if ((v6[0] & 0xfe00) === 0xfc00) return { blocked: true, reason: 'unique-local', family: 'ipv6' };
  if ((v6[0] & 0xffc0) === 0xfe80) return { blocked: true, reason: 'link-local', family: 'ipv6' };
  if ((v6[0] & 0xff00) === 0xff00) return { blocked: true, reason: 'multicast', family: 'ipv6' };
  return { blocked: false, reason: null, family: 'ipv6' };
}
