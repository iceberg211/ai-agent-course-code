export function normalizeEnvValue(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

export function readOptionalEnvValue(value: string | undefined): string {
  return normalizeEnvValue(value);
}

export function readOptionalEnv(env: NodeJS.ProcessEnv, key: string): string {
  return readOptionalEnvValue(env[key]);
}

export function readFirstNonEmptyEnv(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
  fallback = '',
): string {
  for (const key of keys) {
    const value = readOptionalEnv(env, key);
    if (value) return value;
  }
  return fallback;
}

export function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback = false,
): boolean {
  const value = readOptionalEnv(env, key).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}
