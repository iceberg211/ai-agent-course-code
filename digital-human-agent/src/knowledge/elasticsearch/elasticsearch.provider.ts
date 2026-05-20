import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import {
  DEFAULT_ELASTICSEARCH_URL,
  ELASTICSEARCH_CLIENT,
} from '@/common/constants';

export const elasticsearchProvider = {
  provide: ELASTICSEARCH_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Client | null => {
    const enabled = String(
      configService.get<string>('ELASTICSEARCH_ENABLED') ?? '',
    )
      .trim()
      .toLowerCase();
    const isEnabled = ['1', 'true', 'yes', 'on'].includes(enabled);
    if (!isEnabled) {
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
