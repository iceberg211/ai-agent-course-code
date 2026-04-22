export interface HealthProbeResult {
  status: 'ok' | 'error';
  latencyMs?: number;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  checks: {
    app: HealthProbeResult;
    db: HealthProbeResult;
    digitalHuman: HealthProbeResult;
    llm: HealthProbeResult;
  };
}
