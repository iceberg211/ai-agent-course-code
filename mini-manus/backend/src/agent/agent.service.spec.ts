import { ConfigService } from '@nestjs/config';
import { AgentService } from '@/agent/agent.service';
import { EventPublisher } from '@/event/event.publisher';
import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { BrowserSessionService } from '@/browser/browser-session.service';

type ConfigValue = string | number | boolean | undefined;

function createConfig(values: Record<string, ConfigValue>) {
  return {
    get: jest.fn(<T = ConfigValue>(key: string, defaultValue?: T) => {
      const value = values[key];
      return (value === undefined ? defaultValue : value) as T;
    }),
  } as unknown as ConfigService;
}

function createService(values: Record<string, ConfigValue>) {
  return new AgentService(
    createConfig(values),
    { setAvailabilityChecker: jest.fn() } as unknown as ToolRegistry,
    {} as SkillRegistry,
    {} as WorkspaceService,
    { emit: jest.fn() } as unknown as EventPublisher,
    { closeRun: jest.fn() } as unknown as BrowserSessionService,
  );
}

describe('AgentService', () => {
  it('从配置读取模型名和结构化输出方式', () => {
    const service = createService({
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: 'https://example.com/v1',
      MODEL_NAME: 'qwen-plus',
      STRUCTURED_OUTPUT_METHOD: 'jsonMode',
      LLM_CACHE_ENABLED: 'false',
    });
    const llm = service.llm as unknown as {
      model?: string;
      modelName?: string;
    };

    expect(llm.model ?? llm.modelName).toBe('qwen-plus');
    expect(service.structuredOutputMethod).toBe('jsonMode');
  });

  it('非法结构化输出方式回退到 functionCalling', () => {
    const service = createService({
      OPENAI_API_KEY: 'test-key',
      STRUCTURED_OUTPUT_METHOD: 'invalid-method',
    });

    expect(service.structuredOutputMethod).toBe('functionCalling');
  });
});
