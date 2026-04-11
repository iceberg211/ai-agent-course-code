import { validateEnv } from './env.validation';

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
});

