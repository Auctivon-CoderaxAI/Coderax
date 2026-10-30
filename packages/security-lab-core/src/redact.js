export function sanitizeText(input) {
  let s = String(input ?? '');
  s = s.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '');
  s = s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s;
}

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted:private-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted:aws-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted:github-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted:slack-token]'],
  [/\bsk-[A-Za-z0-9]{16,}\b/g, '[redacted:api-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted:jwt]'],
  [/(\bbearer\s+)[A-Za-z0-9._\-+/=]{6,}/gi, '$1[redacted]'],
  [/((?:authorization|token|api[_-]?key|secret|password)\s*[:=]\s*)(?!\[redacted)[^\s,;"']+/gi, '$1[redacted]'],
];

export function redactSecrets(input) {
  let s = sanitizeText(input);
  for (const [re, replacement] of RULES) s = s.replace(re, replacement);
  return s;
}

export function formatTerminalOutput(input, { maxChars = 20000 } = {}) {
  const s = redactSecrets(input);
  return s.length > maxChars ? `${s.slice(0, maxChars)}\n… output truncated` : s;
}

const INJECTION_HINTS = [
  /ignore (?:all )?(?:previous|prior|above) instructions?/i,
  /disregard (?:the )?(?:system|developer) (?:prompt|message)/i,
  /you are now (?:a|an|in) /i,
  /exfiltrate|send (?:the )?(?:secret|token|key)s? to/i,
  /\bfunction call\b.*\bexec(?:ute)?\b/i,
];

export function looksLikeInjection(input) {
  const s = String(input ?? '');
  return INJECTION_HINTS.some((re) => re.test(s));
}

export function wrapUntrusted(input) {
  const body = redactSecrets(input).replace(/```/g, '``\u200b`');
  return `<tool_output trust="untrusted">\n${body}\n</tool_output>`;
}
