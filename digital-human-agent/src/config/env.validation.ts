type EnvMap = Record<string, unknown>;

const KEYWORD_BACKENDS = ['pg', 'elastic'] as const;

function asNonEmptyString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function asBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeLowercase(value: unknown, fallback: string): string {
  const normalized = asNonEmptyString(value).toLowerCase();
  return normalized || fallback;
}

export function validateEnv(config: EnvMap): EnvMap {
  const requiredKeys = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MODEL_NAME',
  ] as const;
  const errors: string[] = [];

  for (const key of requiredKeys) {
    if (!asNonEmptyString(config[key])) {
      errors.push(`${key} 不能为空`);
    }
  }

  const apiKey =
    asNonEmptyString(config.OPENAI_API_KEY) ||
    asNonEmptyString(config.DASHSCOPE_API_KEY);
  if (!apiKey) {
    errors.push('OPENAI_API_KEY 或 DASHSCOPE_API_KEY 至少配置一个');
  }

  const ttsProvider = normalizeLowercase(config.TTS_PROVIDER, 'dashscope');
  if (!['dashscope'].includes(ttsProvider)) {
    errors.push(`TTS_PROVIDER 暂仅支持 dashscope，当前为 ${ttsProvider}`);
  }
  const ttsTransport = normalizeLowercase(config.TTS_TRANSPORT, 'ws');
  if (!['ws', 'http', 'auto'].includes(ttsTransport)) {
    errors.push(`TTS_TRANSPORT 仅支持 ws/http/auto，当前为 ${ttsTransport}`);
  }
  const elasticsearchEnabled = asBooleanFlag(config.ELASTICSEARCH_ENABLED);
  const hybridKeywordBackend = normalizeLowercase(
    config.HYBRID_KEYWORD_BACKEND,
    'pg',
  );
  if (!KEYWORD_BACKENDS.includes(hybridKeywordBackend as 'pg' | 'elastic')) {
    errors.push(
      `HYBRID_KEYWORD_BACKEND 仅支持 pg/elastic，当前为 ${hybridKeywordBackend}`,
    );
  }

  if (
    asBooleanFlag(config.LANGSMITH_TRACING) &&
    !asNonEmptyString(config.LANGSMITH_API_KEY)
  ) {
    errors.push('LANGSMITH_TRACING=true 时，LANGSMITH_API_KEY 不能为空');
  }

  const provider =
    asNonEmptyString(config.DIGITAL_HUMAN_PROVIDER).toLowerCase() || 'mock';
  if (provider === 'simli') {
    if (!asNonEmptyString(config.SIMLI_API_KEY)) {
      errors.push('DIGITAL_HUMAN_PROVIDER=simli 时，SIMLI_API_KEY 不能为空');
    }
    if (!asNonEmptyString(config.SIMLI_FACE_ID)) {
      errors.push('DIGITAL_HUMAN_PROVIDER=simli 时，SIMLI_FACE_ID 不能为空');
    }
  }

  if (errors.length > 0) {
    throw new Error(`环境变量校验失败:\n- ${errors.join('\n- ')}`);
  }

  return {
    ...config,
    TTS_PROVIDER: ttsProvider,
    TTS_TRANSPORT: ttsTransport,
    ELASTICSEARCH_ENABLED: elasticsearchEnabled,
    HYBRID_KEYWORD_BACKEND: hybridKeywordBackend,
    DIGITAL_HUMAN_PROVIDER: provider,
  };
}
