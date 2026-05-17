import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '@/common/constants';
import { normalizeEnvValue } from '@/common/utils';

export const supabaseProvider = {
  provide: SUPABASE_CLIENT,
  useFactory: (): SupabaseClient =>
    createClient(
      normalizeEnvValue(process.env.SUPABASE_URL),
      normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ),
};
