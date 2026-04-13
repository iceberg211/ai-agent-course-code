import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  createPostgresConnectionOptions,
  requireDatabaseUrl,
} from './database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = requireDatabaseUrl(
          config.get<string>('DATABASE_URL'),
          'DATABASE_URL',
        );

        return {
          ...createPostgresConnectionOptions(databaseUrl),
          entities: [__dirname + '/../**/*.entity.{ts,js}'],
          migrations: [__dirname + '/../migrations/*.{ts,js}'],
          synchronize: false,
          logging:
            config.get('NODE_ENV') === 'development'
              ? ['error', 'warn', 'migration']
              : ['error'],
        };
      },
    }),
  ],
})
export class DatabaseModule {}
