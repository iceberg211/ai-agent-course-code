import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SUPABASE_CLIENT } from '../database/supabase.provider';
import { KnowledgeDocument } from './knowledge-document.entity';

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  similarity: number;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDINGS_MODEL_NAME ?? 'text-embedding-v3',
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' '],
  });

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async ingestDocument(
    personaId: string,
    filename: string,
    content: string,
    category?: string,
  ): Promise<KnowledgeDocument> {
    // 1. 创建文档记录
    const doc = await this.docRepo.save(
      this.docRepo.create({ personaId, filename, status: 'processing' }),
    );

    try {
      // 2. 切分
      const chunks = await this.splitter.createDocuments([content]);

      // 3. 向量化（批量）
      const texts = chunks.map((c) => c.pageContent);
      const embeddings = await this.embeddings.embedDocuments(texts);

      // 4. 写入 Supabase
      const rows = chunks.map((chunk, i) => ({
        persona_id: personaId,
        document_id: doc.id,
        chunk_index: i,
        content: chunk.pageContent,
        source: filename,
        category: category ?? null,
        embedding: JSON.stringify(embeddings[i]),
      }));

      const { error } = await this.supabase
        .from('persona_knowledge')
        .insert(rows);

      if (error) throw new Error(error.message);

      // 5. 更新状态
      await this.docRepo.update(doc.id, {
        status: 'completed',
        chunkCount: chunks.length,
      });

      return this.docRepo.findOneBy({
        id: doc.id,
      }) as Promise<KnowledgeDocument>;
    } catch (err) {
      this.logger.error('Ingest failed', err);
      await this.docRepo.update(doc.id, { status: 'failed' });
      throw err;
    }
  }

  async retrieve(
    personaId: string,
    query: string,
    topK = 5,
    threshold = 0.6,
  ): Promise<KnowledgeChunk[]> {
    const [queryEmbedding] = await this.embeddings.embedDocuments([query]);

    const { data, error } = await this.supabase.rpc('match_knowledge', {
      query_embedding: queryEmbedding,
      p_persona_id: personaId,
      match_threshold: threshold,
      match_count: topK,
    });

    if (error) throw new Error(error.message);
    return (data as KnowledgeChunk[]) ?? [];
  }

  listDocuments(personaId: string): Promise<KnowledgeDocument[]> {
    return this.docRepo.find({
      where: { personaId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    // persona_knowledge 的 ON DELETE CASCADE 会级联删向量
    await this.docRepo.delete(documentId);
  }
}
