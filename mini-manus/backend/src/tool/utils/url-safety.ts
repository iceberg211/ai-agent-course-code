import * as net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google',
  'metadata.google.internal',
]);

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local'];

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  ) {
    return true;
  }

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4[1]) : false;
}

function assertSafeHostname(hostname: string): void {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();

  if (
    BLOCKED_HOSTNAMES.has(normalized) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    throw new Error('URL 指向被禁止的主机名');
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4 && isBlockedIpv4(normalized)) {
    throw new Error('URL 指向被禁止的 IPv4 地址');
  }
  if (ipVersion === 6 && isBlockedIpv6(normalized)) {
    throw new Error('URL 指向被禁止的 IPv6 地址');
  }
}

export function assertSafeHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL 格式不合法');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只允许 http/https URL');
  }

  assertSafeHostname(parsed.hostname);
}

export function inferFilenameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (!lastSegment) return fallback;
    return sanitizeFilename(lastSegment) || fallback;
  } catch {
    return fallback;
  }
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}
