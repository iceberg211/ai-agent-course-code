import { validateEnv } from '@/config/env.validation';

describe('validateEnv', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://localhost:5432/test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    MODEL_NAME: 'qwen-plus',
    OPENAI_API_KEY: 'sk-test',
  };

  it('基础必填项满足时通过校验', () => {
    const result = validateEnv(baseEnv);
    expect(result.DIGITAL_HUMAN_PROVIDER).toBe('mock');
    expect(result.TTS_PROVIDER).toBe('dashscope');
    expect(result.TTS_TRANSPORT).toBe('ws');
    expect(result.HYBRID_KEYWORD_BACKEND).toBe('pg');
  });

  it('DIGITAL_HUMAN_PROVIDER=simli 时缺失配置会报错', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        DIGITAL_HUMAN_PROVIDER: 'simli',
      }),
    ).toThrow('SIMLI_API_KEY');
  });

  it('simli 配置完整时通过校验', () => {
    const result = validateEnv({
      ...baseEnv,
      DIGITAL_HUMAN_PROVIDER: 'simli',
      SIMLI_API_KEY: 'simli-key',
      SIMLI_FACE_ID: 'face-id',
    });
    expect(result.DIGITAL_HUMAN_PROVIDER).toBe('simli');
  });

  it('启用 LangSmith tracing 但缺少 API Key 时会报错', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY: '',
      }),
    ).toThrow('LANGSMITH_API_KEY');
  });

  it('TTS_PROVIDER 非法时会报错', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        TTS_PROVIDER: 'tencent',
      }),
    ).toThrow('TTS_PROVIDER');
  });

  it('TTS_TRANSPORT 非法时会报错', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        TTS_TRANSPORT: 'grpc',
      }),
    ).toThrow('TTS_TRANSPORT');
  });

  it('HYBRID_KEYWORD_BACKEND=elastic 时会被规范化', () => {
    const result = validateEnv({
      ...baseEnv,
      HYBRID_KEYWORD_BACKEND: 'ELASTIC',
    });

    expect(result.HYBRID_KEYWORD_BACKEND).toBe('elastic');
  });

  it('HYBRID_KEYWORD_BACKEND 非法时会报错', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        HYBRID_KEYWORD_BACKEND: 'redis',
      }),
    ).toThrow('HYBRID_KEYWORD_BACKEND');
  });
});
