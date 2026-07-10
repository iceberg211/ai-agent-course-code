import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddMemoryInput,
  DeleteMemoryInput,
  LongTermMemoryProvider,
  MemoryRecord,
  SearchMemoryInput,
} from '@/memory/memory.types';
import { withTimeout } from '@/common/utils';

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
    const dataRecord = this.toRecord(data);
    const rows = Array.isArray(dataRecord?.results)
      ? dataRecord.results
      : Array.isArray(data)
        ? data
        : [];
    return rows.map((item) => {
      const row = this.toRecord(item);
      return this.toMemoryRecord(item, {
        ownerId: input.ownerId ?? '',
        content: this.toText(row?.memory ?? row?.content),
      });
    });
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
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await withTimeout(
      'mem0_request',
      (signal) =>
        fetch(url, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal,
        }),
      {
        timeoutMs: this.timeoutMs,
        timeoutMessage: 'mem0 请求超时',
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`mem0 请求失败 ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json() as Promise<unknown>;
  }

  private toMemoryRecord(
    data: unknown,
    fallback: Partial<AddMemoryInput>,
  ): MemoryRecord {
    const row = this.toRecord(data);
    const metadata =
      this.toRecord(row?.metadata) ?? fallback.metadata ?? ({} as const);
    const createdAt = this.toDate(row?.created_at) ?? new Date();
    const updatedAt = this.toDate(row?.updated_at) ?? createdAt;
    const visibility = this.toMemoryVisibility(
      metadata.visibility ?? fallback.visibility,
    );
    const category = this.toMemoryCategory(
      metadata.category ?? fallback.category,
    );
    const expiresAtValue = metadata.expiresAt ?? fallback.expiresAt;
    return {
      id: this.toText(row?.id ?? row?.memory_id) || crypto.randomUUID(),
      ownerId: this.toText(row?.user_id ?? fallback.ownerId),
      department:
        this.toNullableText(metadata.department) ?? fallback.department ?? null,
      visibility,
      category,
      content: this.toText(row?.memory ?? row?.content ?? fallback.content),
      sourceConversationId:
        this.toNullableText(metadata.sourceConversationId) ??
        fallback.sourceConversationId ??
        null,
      confidence: this.toFiniteNumber(
        metadata.confidence ?? fallback.confidence,
        0.7,
      ),
      expiresAt: this.toDate(expiresAtValue),
      metadata,
      createdAt,
      updatedAt,
    };
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
      ? String(value)
      : '';
  }

  private toNullableText(value: unknown): string | null {
    const text = this.toText(value).trim();
    return text || null;
  }

  private toDate(value: unknown): Date | null {
    if (
      !(value instanceof Date) &&
      typeof value !== 'string' &&
      typeof value !== 'number'
    ) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toFiniteNumber(value: unknown, fallback: number): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  }

  private toMemoryVisibility(value: unknown): MemoryRecord['visibility'] {
    return value === 'department' || value === 'company' ? value : 'private';
  }

  private toMemoryCategory(value: unknown): MemoryRecord['category'] {
    return value === 'profile' ||
      value === 'business_context' ||
      value === 'task_goal' ||
      value === 'conversation_summary'
      ? value
      : 'preference';
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

  private get timeoutMs(): number {
    const raw = Number(this.configService.get<string>('MEM0_TIMEOUT_MS'));
    if (!Number.isFinite(raw) || raw <= 0) return 4_000;
    return Math.min(15_000, Math.max(500, Math.floor(raw)));
  }
}
