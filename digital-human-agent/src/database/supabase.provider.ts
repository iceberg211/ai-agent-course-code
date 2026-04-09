import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

function normalizeEnvValue(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

export const supabaseProvider = {
  provide: SUPABASE_CLIENT,
  useFactory: (): SupabaseClient =>
    createClient(
      normalizeEnvValue(process.env.SUPABASE_URL),
      normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ),
};
