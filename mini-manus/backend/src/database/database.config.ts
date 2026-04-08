const SSL_OPTIONS = { rejectUnauthorized: false } as const;

export function requireDatabaseUrl(
  value: string | undefined,
  envName: 'DATABASE_URL' | 'DIRECT_URL',
): string {
  if (!value) {
    throw new Error(`${envName} is required`);
  }

  return value;
}

export function createPostgresConnectionOptions(url: string) {
  return {
    type: 'postgres' as const,
    url,
    ssl: SSL_OPTIONS,
  };
}
