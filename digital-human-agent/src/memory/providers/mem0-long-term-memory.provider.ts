import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddMemoryInput,
  DeleteMemoryInput,
  LongTermMemoryProvider,
  MemoryRecord,
  SearchMemoryInput,
} from '@/memory/memory.types';

@Injectable()
export class Mem0LongTermMemoryProvider implements LongTermMemoryProvider {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async add(input: AddMemoryInput): Promise<MemoryRecord> {
    if (!this.isEnabled()) {
      throw new Error('MEM0_API_KEY 未配置');
    }
    const data = await this.request('/memories', {
      method: 'POST',
      body: {
        user_id: input.ownerId,
        memory: input.content,
        metadata: {
          category: input.category ?? 'preference',
          department: input.department ?? null,
          visibility: input.visibility ?? 'private',
          sourceConversationId: input.sourceConversationId ?? null,
          confidence: input.confidence ?? 0.7,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          ...(input.metadata ?? {}),
        },
      },
    });
    return this.toMemoryRecord(data, input);
  }

  async search(input: SearchMemoryInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const search = new URLSearchParams();
    if (input.ownerId) search.set('user_id', input.ownerId);
    if (input.query) search.set('query', input.query);
    search.set('limit', String(Math.min(Math.max(input.limit ?? 5, 1), 20)));
    const data = await this.request(`/memories/search?${search.toString()}`, {
      method: 'GET',
    });
    const rows = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
    return rows.map((item: any) => this.toMemoryRecord(item, {
      ownerId: input.ownerId ?? '',
      content: String(item.memory ?? item.content ?? ''),
    }));
  }

  async delete(input: DeleteMemoryInput): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.request(`/memories/${encodeURIComponent(input.id)}`, {
      method: 'DELETE',
    });
  }

  private async request(
    path: string,
    options: { method: string; body?: unknown },
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`mem0 请求失败 ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private toMemoryRecord(data: any, fallback: Partial<AddMemoryInput>): MemoryRecord {
    const metadata = data?.metadata ?? fallback.metadata ?? {};
    const createdAt = data?.created_at ? new Date(data.created_at) : new Date();
    const updatedAt = data?.updated_at ? new Date(data.updated_at) : createdAt;
    return {
      id: String(data?.id ?? data?.memory_id ?? crypto.randomUUID()),
      ownerId: String(data?.user_id ?? fallback.ownerId ?? ''),
      department: metadata.department ?? fallback.department ?? null,
      visibility: metadata.visibility ?? fallback.visibility ?? 'private',
      category: metadata.category ?? fallback.category ?? 'preference',
      content: String(data?.memory ?? data?.content ?? fallback.content ?? ''),
      sourceConversationId:
        metadata.sourceConversationId ?? fallback.sourceConversationId ?? null,
      confidence: Number(metadata.confidence ?? fallback.confidence ?? 0.7),
      expiresAt:
        metadata.expiresAt || fallback.expiresAt
          ? new Date(metadata.expiresAt ?? fallback.expiresAt)
          : null,
      metadata,
      createdAt,
      updatedAt,
    };
  }

  private get baseUrl(): string {
    const raw =
      this.configService.get<string>('MEM0_BASE_URL') ||
      'https://api.mem0.ai/v1';
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }

  private get apiKey(): string {
    return String(this.configService.get<string>('MEM0_API_KEY') ?? '').trim();
  }
}
