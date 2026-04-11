export type DigitalHumanSpeakMode = 'pcm-stream' | 'text-direct';

export interface DigitalHumanSessionInfo {
  providerSessionId: string;
  speakMode: DigitalHumanSpeakMode;
  credentials: Record<string, unknown>;
}

export interface DigitalHumanHealthStatus {
  status: 'ok' | 'error';
  message?: string;
}

export interface DigitalHumanProvider {
  readonly name: string;
  createSession(
    personaId: string,
    voiceId?: string,
  ): Promise<DigitalHumanSessionInfo>;
  interrupt(providerSessionId: string, turnId?: string): Promise<void>;
  closeSession(providerSessionId: string): Promise<void>;
  speak?(
    providerSessionId: string,
    turnId: string,
    text: string,
  ): Promise<void>;
  healthCheck?(): Promise<DigitalHumanHealthStatus>;
}
