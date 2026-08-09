export interface HealthProbeResult {
  status: 'ok' | 'error';
  latencyMs?: number;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  checks: Record<string, HealthProbeResult & Record<string, any>>;
}
