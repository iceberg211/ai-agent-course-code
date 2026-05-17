declare module '@langchain/community/graphs/neo4j_graph' {
  export class Neo4jGraph {
    constructor(options: {
      url: string;
      username: string;
      password: string;
      database?: string;
      timeoutMs?: number;
    });

    query<T extends Record<string, unknown> = Record<string, unknown>>(
      cypher: string,
      params?: Record<string, unknown>,
    ): Promise<T[]>;

    verifyConnectivity(): Promise<void>;
    close(): Promise<void>;
  }
}
