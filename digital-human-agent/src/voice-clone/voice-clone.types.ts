export type VoiceCloneStatus =
  | 'not_started'
  | 'pending'
  | 'training'
  | 'ready'
  | 'failed';

export interface VoiceCloneState {
  personaId: string;
  status: VoiceCloneStatus;
  voiceId: string | null;
  providerTaskId: string | null;
  sampleFilename: string | null;
  updatedAt: string;
  errorMessage?: string;
}
