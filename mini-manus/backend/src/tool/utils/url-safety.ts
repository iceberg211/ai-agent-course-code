const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/metadata\.google/i,
];

export function assertSafeHttpUrl(url: string): void {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Only http/https URLs are allowed');
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url)) {
      throw new Error('URL points to a blocked address');
    }
  }
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
