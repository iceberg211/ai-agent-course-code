# digital-human-agent

企业知识库与数字人问答后端，技术栈为 `NestJS 11 + TypeORM + PostgreSQL(Supabase) + WebSocket + LangChain`。

## 本地开发

```bash
pnpm install
pnpm start:dev
```

常用入口：

- Swagger：`http://localhost:3001/api/docs`
- 文本问答：`POST /chat`
- 会话网关：`ws://localhost:3001/ws/conversation`
- 知识库：`/knowledge-bases`

## 环境变量

最小环境变量见 `./.env.example`。

检索相关重点变量：

- `ELASTICSEARCH_ENABLED=false`
- `ELASTICSEARCH_URL=http://localhost:9200`
- `ELASTICSEARCH_INDEX_PREFIX=digital-human`
- `HYBRID_KEYWORD_BACKEND=pg`

默认仍使用 PostgreSQL 关键词检索。只有在本地 ES 已启动、索引已回填后，才建议切换到 `HYBRID_KEYWORD_BACKEND=elastic`。

## ElasticSearch + Kibana

本项目把 ElasticSearch 作为 BM25 关键词检索的派生索引，PostgreSQL / Supabase 仍是唯一主数据源。

启动：

```bash
pnpm es:up
```

访问地址：

- ElasticSearch：`http://localhost:9200`
- Kibana：`http://localhost:5601`

回填已有 chunk：

```bash
pnpm es:backfill
```

关闭并清空本地数据卷：

```bash
pnpm es:down
```

建议验证顺序：

1. 保持 `HYBRID_KEYWORD_BACKEND=pg`
2. `pnpm es:up`
3. `pnpm es:backfill`
4. 用 Kibana Dev Tools 检查索引和查询命中
5. 再切到 `HYBRID_KEYWORD_BACKEND=elastic`

## 测试与构建

```bash
pnpm test --runInBand
pnpm build
```
