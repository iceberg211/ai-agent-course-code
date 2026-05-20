export type TtsOutputFormat = 'mp3' | 'pcm';

export interface TtsSynthesizeStreamParams {
  text: string;
  voiceId: string | null;
  signal: AbortSignal;
  onChunk: (chunk: Buffer) => void;
  outputFormat: TtsOutputFormat;
}

export interface TtsProvider {
  readonly name: string;
  synthesizeStream(params: TtsSynthesizeStreamParams): Promise<void>;
}
