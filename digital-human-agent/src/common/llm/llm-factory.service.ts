import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_OPENAI_COMPAT_BASE_URL,
} from '@/common/constants';
import { normalizeEnvValue } from '@/common/utils';

export interface CreateChatModelOptions {
  model?: string;
  modelEnvKeys?: readonly string[];
  defaultModel?: string;
  temperature?: number;
  streaming?: boolean;
}

@Injectable()
export class LlmFactoryService {
  constructor(private readonly configService: ConfigService) {}

  createChatModel(options: CreateChatModelOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      model: this.resolveModel(options),
      temperature: options.temperature ?? 0,
      streaming: options.streaming,
      configuration: {
        baseURL:
          this.readString('OPENAI_BASE_URL') || DEFAULT_OPENAI_COMPAT_BASE_URL,
        apiKey: this.readString('OPENAI_API_KEY'),
      },
    });
  }

  resolveModel(options: CreateChatModelOptions = {}): string {
    if (options.model?.trim()) {
      return options.model.trim();
    }

    const envKeys = [...(options.modelEnvKeys ?? []), 'MODEL_NAME'];
    for (const key of envKeys) {
      const value = this.readString(key);
      if (value) return value;
    }

    return options.defaultModel ?? DEFAULT_LLM_MODEL_NAME;
  }

  private readString(key: string): string {
    const value = this.configService.get<string>(key);
    return normalizeEnvValue(value);
  }
}

export function createDefaultLlmFactoryService(): LlmFactoryService {
  return new LlmFactoryService(new ConfigService());
}
