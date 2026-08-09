import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SUPABASE_CLIENT } from '@/common/constants';
import { normalizeEnvValue, readBooleanEnv } from '@/common/utils';
import { supabaseProvider } from '@/database/supabase.provider';

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
        extra: {
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        },
        logging: readBooleanEnv(process.env, 'TYPEORM_LOGGING')
          ? ['error', 'warn', 'query']
          : ['error', 'warn'],
      }),
    }),
  ],
  providers: [supabaseProvider],
  exports: [supabaseProvider, SUPABASE_CLIENT],
})
export class DatabaseModule {}
