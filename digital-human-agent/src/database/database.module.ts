import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { supabaseProvider, SUPABASE_CLIENT } from './supabase.provider';

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

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        url: normalizeEnvValue(process.env.DATABASE_URL),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: false,
        ssl: { rejectUnauthorized: false },
        logging:
          process.env.TYPEORM_LOGGING === 'true'
            ? ['error', 'warn', 'query']
            : ['error', 'warn'],
      }),
    }),
  ],
  providers: [supabaseProvider],
  exports: [supabaseProvider, SUPABASE_CLIENT],
})
export class DatabaseModule {}
