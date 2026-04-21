import { Client } from '@elastic/elasticsearch';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_ELASTICSEARCH_URL,
  ELASTICSEARCH_CLIENT,
} from '@/common/constants';

function readBoolean(
  configService: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const rawValue = String(configService.get<string>(key) ?? '').trim();
  if (!rawValue) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
}

export const elasticsearchProvider = {
  provide: ELASTICSEARCH_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Client | null => {
    const enabled = readBoolean(configService, 'ELASTICSEARCH_ENABLED', false);
    if (!enabled) {
      return null;
    }

    const node =
      (configService.get<string>('ELASTICSEARCH_URL') ??
        DEFAULT_ELASTICSEARCH_URL) ||
      DEFAULT_ELASTICSEARCH_URL;

    return new Client({
      node: node.trim(),
      maxRetries: 2,
      requestTimeout: 5000,
    });
  },
};
