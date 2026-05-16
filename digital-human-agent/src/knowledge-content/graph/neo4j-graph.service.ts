import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jGraph } from '@langchain/community/graphs/neo4j_graph';

@Injectable()
export class Neo4jGraphService implements OnModuleDestroy {
  private readonly logger = new Logger(Neo4jGraphService.name);
  private graph: Neo4jGraph | null = null;

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.readBoolean('NEO4J_GRAPH_ENABLED', false);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const graph = await this.getGraph();
    return graph.query<T>(cypher, params);
  }

  async verifyConnectivity(): Promise<void> {
    const graph = await this.getGraph();
    await graph.verifyConnectivity();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.graph) return;
    await this.graph.close().catch((error) => {
      this.logger.warn(
        `关闭 Neo4j 连接失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    this.graph = null;
  }

  private async getGraph(): Promise<Neo4jGraph> {
    if (!this.isEnabled()) {
      throw new Error('NEO4J_GRAPH_ENABLED=false，当前未启用 Neo4j 图谱检索');
    }

    if (this.graph) return this.graph;

    this.graph = new Neo4jGraph({
      url: this.readString('NEO4J_URL') || 'bolt://localhost:7687',
      username: this.readString('NEO4J_USERNAME') || 'neo4j',
      password: this.readString('NEO4J_PASSWORD') || '12345678',
      database: this.readString('NEO4J_DATABASE') || 'neo4j',
      timeoutMs: this.readNumber('NEO4J_TIMEOUT_MS', 8000),
    });
    await this.graph.verifyConnectivity();
    return this.graph;
  }

  private readString(key: string): string {
    return String(this.configService.get<string>(key) ?? process.env[key] ?? '')
      .trim();
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const rawValue = this.readString(key);
    if (!rawValue) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
  }

  private readNumber(key: string, fallback: number): number {
    const value = Number(this.readString(key));
    return Number.isFinite(value) ? value : fallback;
  }
}
