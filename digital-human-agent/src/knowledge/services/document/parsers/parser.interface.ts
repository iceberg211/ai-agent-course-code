export interface ParseInput {
  filename: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface ParsedAsset {
  assetType: 'image' | 'audio' | 'video';
  filename: string;
  mimeType: string;
  storageKey: string;
  pageNo?: number | null;
  startMs?: number | null;
  endMs?: number | null;
  caption?: string | null;
  ocrText?: string | null;
  metadata?: Record<string, any> | null;
}

export interface ParseOutput {
  markdown: string;
  assets: ParsedAsset[];
  metadata: Record<string, unknown>;
}

export interface DocumentParserProvider {
  supports(input: ParseInput): boolean;
  parse(
    input: ParseInput,
    context: { knowledgeBaseId: string; ingestRunId: string },
  ): Promise<ParseOutput>;
}
