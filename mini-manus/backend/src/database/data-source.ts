import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';
import {
  createPostgresConnectionOptions,
  requireDatabaseUrl,
} from './database.config';

dotenv.config();

const connectionUrl = requireDatabaseUrl(
  process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL',
);

export const AppDataSource = new DataSource({
  ...createPostgresConnectionOptions(connectionUrl),
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging:
    process.env.NODE_ENV === 'development'
      ? ['error', 'warn', 'migration']
      : ['error'],
});
