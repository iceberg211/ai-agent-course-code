# 数字人 Agent 执行计划

> 配套文档：[技术方案](./数字人-Agent-技术方案.md)（解释"为什么"）
> 本文档解释"怎么做"——具体文件、命令、验收标准，边做边勾。

---

## 📊 当前进度总览

> 最后更新：2026-04-11

| 阶段 | 内容 | 状态 |
|------|------|------|
| 环境前置 | SDK 选型验证 | ⚠️ 部分完成（架构方案已定，Simli 待接入）|
| **第一阶段** | 纯语音对话（ASR → Agent → TTS）| ✅ **代码全部落地** |
| **第二阶段** | RAG 两阶段检索 + 知识库管理 UI | ✅ **代码全部落地** |
| **第三阶段** | 语音克隆 | ✅ **代码落地（训练流程为 Mock）** |
| **第四阶段** | 数字人 SDK 接入 | 🔧 **Provider 接口已重设计，待落地 Simli 实现** |
| **附加工作** | 代码重构（Gateway 拆分、前端 Hook 模块化）| ✅ **已完成** |

> **说明**：「代码落地」= 模块实现完整、TypeScript 编译通过；「已验收运行」= 端到端跑通过。
> **架构决策（2026-04-10）**：采用 Provider 模式 + `speakMode` 标志位，首选 Simli（`pcm-stream`）。
> `DigitalHumanService` 接口需按新设计重构，`WebRtcHandler` 整体移除，`TtsPipelineService` 加 PCM 输出分支。

---

## 评审结论与本轮调整（2026-04-11）

本次按 `nestjs-best-practices` 做执行计划审阅，已同步以下调整：

- [x] **架构与 DI 对齐**（`arch-*` / `di-*`）：第四阶段补充 `DIGITAL_HUMAN_PROVIDER` 注入令牌与 Provider 工厂约束，避免 Gateway 直接依赖具体厂商实现
- [x] **错误处理对齐**（`error-*`）：补充数字人外部调用失败的超时、重试、降级策略与统一异常映射要求
- [x] **配置管理对齐**（`devops-use-config-module`）：新增 `ConfigModule + Joi` 环境变量校验为阶段门禁
- [x] **健康检查对齐**（`micro-use-health-checks`）：新增 `/health` 与依赖探针（DB、Simli、LLM）验收项
- [x] **测试基线对齐**（`test-*`）：新增第四阶段最小 e2e 与集成测试清单
- [x] **前端 TS 一致性修订**：将文档内遗留 `.js` 路径更新为 `.ts`
- [x] **AI SDK 文本层修订**：将 `@ai-sdk/vue` 接入描述统一为 `Chat` 实现，避免版本歧义
- [x] **重构记录纠偏**：附录明确标注 `webrtc.handler.ts` 为当前状态，第四阶段完成后移除

---

## 环境前置

```bash
# Node.js >= 20, pnpm >= 9
node -v && pnpm -v

# Supabase CLI
pnpm add -g supabase

# NestJS CLI
pnpm add -g @nestjs/cli
```

前置验证（第四阶段动工前完成，见技术方案第 14 节）：

> **架构决策（2026-04-10）**：
> 数字人 Provider 采用 **Strategy Pattern + `speakMode` 标志位**，详见技术方案第 9 节。
> WebRTC 在**前端 ↔ Provider 服务器**之间建立，后端不再参与 SDP/ICE 信令交换。
> 推荐首选 **Simli**（`pcm-stream` 模式），保留后端 TTS 和语音克隆能力。

- [ ] **Simli 选型验证**：注册 simli.ai 免费账号，跑通 `e2eSessionToken` → `SimliClient.start()` 最小 demo
  - > ⚠️ **当前状态**：`DigitalHumanProvider` 接口已按新架构定义，Mock 实现待替换
- [ ] **PCM 格式对齐**：确认后端 TTS（DashScope/OpenAI）输出 PCM 格式与 Simli 要求一致（采样率/位深/声道）
- [ ] **`sendAudioData()` 分片验证**：按句多次调用，确认口型连续不跳帧
- [ ] **前端状态机事件**：确认 SimliClient 提供"开始/结束播报"回调，驱动 `speaking` 状态切换
- [ ] **`voice_id` 通用性**：后端 TTS 克隆的 voice_id 在数字人模式下可复用
- [ ] **打断延迟**：`simliClient.stop()` 后 < 500ms 内视频静止

---

## 项目初始化

```bash
nest new digital-human-agent
cd digital-human-agent
```

**安装依赖：**

```bash
# 核心框架
pnpm add @nestjs/websockets @nestjs/platform-ws ws

# Supabase + pgvector
pnpm add @supabase/supabase-js

# TypeORM（结构化数据）
pnpm add @nestjs/typeorm typeorm pg

# LangChain + LangGraph
pnpm add langchain @langchain/core @langchain/langgraph
pnpm add @langchain/openai                   # Embeddings + LLM
pnpm add @langchain/community                # SupabaseVectorStore + reranker

# 工具
pnpm add uuid class-transformer class-validator
pnpm add -D @types/ws @types/uuid

# 前端文本层（可选，AI SDK）
pnpm -C frontend add ai @ai-sdk/vue
```

**目录结构：**

```
src/
├── gateway/           # WebSocket Gateway（信令 + 音频 + 控制）
├── realtime-session/  # 运行时会话状态（AbortController、缓冲区等）
├── agent/             # LangGraph 对话图
├── knowledge/         # RAG 管线（Chunking + Embedding + pgvector）
├── persona/           # 角色 CRUD
├── asr/               # ASR 封装
├── tts/               # 流式 TTS 封装（纯语音模式）
├── digital-human/     # 数字人 SDK 封装
├── conversation/      # 对话历史持久化
└── database/          # Supabase client + TypeORM 配置

supabase/
└── migrations/        # DDL 文件
frontend/              # Vue 3 + Vite 前端（独立项目，端口 5173）
├── src/
│   ├── App.vue                   # 主组件（三栏布局）
│   ├── main.ts
│   ├── style.css                 # 全局样式 + CSS 变量
│   └── hooks/
│       ├── useWebSocket.ts       # WS 连接管理 + 事件总线
│       └── useAudio.ts           # MediaRecorder + MediaSource
└── vite.config.ts                # proxy: /api → 3001, /ws → 3001
```

---

## 前端设计规范

> 前端使用 **Vue 3 + Vite**，与后端（NestJS，端口 3001）完全分离，开发时运行在端口 5173。
> Vite proxy 将 `/api/*` 和 `/ws/*` 转发到后端，生产环境用 Nginx 反代。

前端选型边界（和技术方案保持一致）：

- [ ] 后端推理编排保持 `LangGraph/LangChain` 单链路，不新增 AI SDK Core 编排
- [ ] `@ai-sdk/vue` 仅用于文本聊天 UI 状态与流式渲染
- [ ] 语音链路（WS 二进制 + ASR/TTS + WebRTC）保持现有实现，不因文本层改造而变化

### 布局结构

```
┌──────────────────────────────────────────────────────────┐
│  左侧角色面板 240px  │  中间对话区 flex:1  │  知识库抽屉 300px  │
│                     │                    │  （按钮切换显示）  │
│  🤖 数字人 Agent    │  [顶栏: 角色名]     │                   │
│  ─────────────      │                    │  ⬆ 上传文档       │
│  角色列表           │  对话消息流         │                   │
│  · 李老师 ←active   │  （流式追加 token） │  文档列表          │
│  · 张教授           │                    │  · 文件名  就绪    │
│                     │  [空态引导文字]      │  · 文件名  处理中  │
│  ─────────────      │                    │                   │
│  🟢 已连接          │  ─────────────────  │                   │
│                     │  [状态] [🎤] [提示] │                   │
└──────────────────────────────────────────────────────────┘
```

### 色彩系统（亮色主题，参考 Claude.ai / Linear）

| 变量 | 值 | 用途 |
|---|---|---|
| `--bg` | `#ffffff` | 主背景 |
| `--bg-sidebar` | `#f7f7f8` | 侧边栏/抽屉背景 |
| `--bg-hover` | `#f0f0f5` | hover 状态背景 |
| `--bg-active` | `rgba(95,87,255,0.06)` | 激活角色项背景 |
| `--bg-bubble-ai` | `#f4f4f5` | AI 消息气泡背景 |
| `--accent` | `#5f57ff` | 主色（Indigo 偏紫，参考 Claude） |
| `--accent-light` | `rgba(95,87,255,0.12)` | 浅主色（引用 chip 背景、按钮激活背景） |
| `--user-bubble` | `#5f57ff` | 用户消息气泡 |
| `--text` | `#1a1a1a` | 主要文字 |
| `--text-secondary` | `#6b7280` | 次要文字 |
| `--text-muted` | `#9ca3af` | 很淡的文字 |
| `--border` | `#e5e7eb` | 标准边框 |
| `--success` | `#16a34a` | speaking 状态、就绪标签 |
| `--warning` | `#ea580c` | thinking 状态、处理中标签 |
| `--error` | `#dc2626` | recording 状态、错误提示 |

**气泡设计细节：**
- AI 气泡：`#f4f4f5` 浅灰底 + **左侧 3px `#5f57ff` 紫色实边**（品牌感）
- 用户气泡：`#5f57ff` 深紫底 + 白色文字，右下角 4px 小圆角

### 麦克风按钮状态

| 状态 | 颜色 | 动画 | 图标 |
|---|---|---|---|
| `idle` | `#5f57ff` 紫 + 紫色光晕 | 静止 | 🎤 |
| `recording` | `#dc2626` 红 | `pulse-ring` 红色脉冲扩散 | ⏹ |
| `thinking` | `#ea580c` 橙 | `breathe` 橙色呼吸灯 | ⏸ |
| `speaking` | `#16a34a` 绿 | `glow-green` 绿色呼吸 | ⏸ |
| `disabled` | `#e5e7eb` 灰 | 无 | 🎤 |

按钮尺寸 56×56px，圆形，居中布局，左右各有状态文字区。

### 关键交互细节

- **消息动画**：每条消息 `fadeInUp` 0.18s 进入
- **打字指示器**：AI 消息等待首 token 时显示三点弹跳动画（向上 4px）
- **引用 chip**：浅紫底 `rgba(95,87,255,0.12)` + 紫色文字，`📎 文件名·§段落号`
- **知识库抽屉**：右侧滑入 0.2s，顶栏「📚 知识库」按钮切换，激活时紫色描边
- **Toast**：底部居中，深色实底（`#1a1a1a`）+ 白字 + 中等阴影，3 秒消失
- **连接状态**：左下角小圆点 + 文字，绿色=已连接，灰色=未连接，3s 自动重连
- **角色激活**：左侧 3px 紫色实边 + 极淡紫色背景，头像渐变（紫→Indigo）

### 开发运行

```bash
# 后端
cd digital-human-agent && npm run start:dev   # 端口 3001

# 前端（另开终端）
cd digital-human-agent/frontend && npm run dev  # 端口 5173
```

---

## 第一阶段：纯语音对话

> 目标：麦克风 → ASR → Agent(RAG) → TTS → 流式播放
> 完成后有一个能用克隆声音、基于知识库回答的语音助手（不需要数字人 SDK）

### 1.1 Supabase 数据库初始化

```bash
supabase init
supabase start   # 本地开发用本地 Supabase；也可直接用云端项目
```

新建 `supabase/migrations/001_init.sql`：

```sql
-- 启用 pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 角色配置
CREATE TABLE persona (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  speaking_style      TEXT,
  expertise           JSONB DEFAULT '[]',
  voice_id            TEXT,
  avatar_id           TEXT,
  system_prompt_extra TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- 会话
CREATE TABLE conversation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 对话消息
CREATE TABLE conversation_message (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  turn_id         UUID NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  seq             INT NOT NULL DEFAULT 0,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'interrupted', 'failed')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 知识文档（原始）
CREATE TABLE knowledge_document (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  chunk_count INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 知识片段 + 向量
CREATE TABLE persona_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL,
  category    TEXT,
  embedding   VECTOR(1536),          -- text-embedding-3-small 维度
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 索引（V1 数据量小可以先不建向量索引，暴力搜索即可）
CREATE INDEX ON persona_knowledge (persona_id);
CREATE INDEX ON conversation_message (conversation_id, created_at);
```

```bash
supabase db push   # 推送到本地 / 云端
```

- [x] `supabase db push` 无报错（`001_init.sql` + `002_rpc.sql` 已创建）
- [x] Supabase Studio 中能看到 5 张表（`persona`、`conversation`、`conversation_message`、`knowledge_document`、`persona_knowledge`）

---

### 1.2 DatabaseModule

`src/database/database.module.ts`：TypeORM 连接 Supabase PostgreSQL（用于结构化 CRUD）+ Supabase Client 初始化（用于 pgvector 原生 SQL）。

```typescript
// src/database/supabase.provider.ts
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

export const supabaseProvider = {
  provide: SUPABASE_CLIENT,
  useFactory: () =>
    createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
};
```

TypeORM 配置连同 Supabase PostgreSQL 的 connection string：

```typescript
// src/database/database.module.ts
TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,   // Supabase 的 pooler URL
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,              // 生产/课程演示禁用，用 migration 管 schema
})
```

- [x] TypeORM 连接成功，`AppModule` 启动无报错（`src/database/` 模块已实现）
- [x] Supabase Client 注入到 `KnowledgeService` 可用

---

### 1.3 PersonaModule

文件：`src/persona/persona.entity.ts` / `persona.service.ts` / `persona.controller.ts`

接口：
- `POST /personas` — 创建角色
- `GET /personas` — 列出所有角色
- `GET /personas/:id` — 获取角色详情
- `PATCH /personas/:id` — 更新角色
- `DELETE /personas/:id` — 删除角色（级联删除知识库和会话）

- [x] 能通过 REST 创建一个"李老师"角色并查询到（`persona.controller.ts` + `persona.service.ts` 已实现完整 CRUD）

---

### 1.4 KnowledgeModule（第一阶段：基础版）

文件：`src/knowledge/knowledge.service.ts`

本阶段只需要实现**写入**（文档上传 + 切分 + 向量化）和**基础检索**（单阶段向量搜索）。
第二阶段再加 Reranking 和引用溯源。

**写入流程：**

```typescript
// src/knowledge/knowledge.service.ts（关键逻辑）
async ingestDocument(personaId: string, file: Express.Multer.File) {
  // 1. 写入 knowledge_document，status = 'processing'
  // 2. 用 LangChain Loader 加载文本
  // 3. RecursiveCharacterTextSplitter: chunkSize=500, overlap=100
  // 4. OpenAI text-embedding-3-small 向量化
  // 5. 批量 INSERT INTO persona_knowledge
  // 6. 更新 knowledge_document.status = 'completed', chunk_count = n
}
```

**基础检索（第一阶段用）：**

```typescript
async retrieve(personaId: string, queryEmbedding: number[], topK = 5) {
  const { data } = await this.supabase.rpc('match_knowledge', {
    query_embedding: queryEmbedding,
    persona_id: personaId,
    match_threshold: 0.6,
    match_count: topK,
  });
  return data;
}
```

在 Supabase 中创建对应的 RPC 函数 `supabase/migrations/002_rpc.sql`：

```sql
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  VECTOR(1536),
  persona_id       UUID,
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  source      TEXT,
  chunk_index INT,
  category    TEXT,
  similarity  FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, content, source, chunk_index, category,
    1 - (embedding <=> query_embedding) AS similarity
  FROM persona_knowledge
  WHERE persona_knowledge.persona_id = match_knowledge.persona_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- [x] 上传一个 TXT 文档，能在 `persona_knowledge` 表中看到切分后的 chunks（`knowledge.service.ts` 已实现完整 ingest 流程）
- [x] 调用 `match_knowledge` RPC，能返回相关结果（`002_rpc.sql` 已创建对应函数）

---

### 1.5 ConversationModule

文件：`src/conversation/conversation.service.ts`

关键方法：
```typescript
createConversation(personaId: string): Promise<Conversation>
addMessage(params: { conversationId, turnId, role, seq, content, status }): Promise<void>
getRecentMessages(conversationId: string, limit = 10): Promise<ConversationMessage[]>
// 注意：只取 status = 'completed' 的消息用于 Prompt
getCompletedMessages(conversationId: string, limit = 10): Promise<ConversationMessage[]>
```

- [x] 对话消息能正确写入和查询（`conversation.service.ts` 已实现）
- [x] `status=interrupted` 的消息不出现在 `getCompletedMessages` 结果中

---

### 1.6 AgentModule

文件：`src/agent/agent.service.ts`

LangGraph 线性图：`retrieve → buildPrompt → streamAnswer`

```typescript
// Prompt 结构（详见技术方案 5.3）
// 关键：检索结果带来源标注，要求模型口语化引用
const systemPrompt = `
你是${persona.name}。${persona.description}
你的说话风格：${persona.speaking_style}

以下是与当前问题相关的知识：
---
${retrievedChunks.map((c, i) =>
  `[来源: ${c.source}, 段落 ${c.chunk_index}]\n${c.content}`
).join('\n---\n')}
---

要求：
1. 始终以${persona.name}的身份回答
2. 回答必须基于上述知识，不要编造
3. 如果知识库中没有相关信息，诚实说"这个我不太清楚"
4. 语气和用词要符合角色人设
5. 回答要口语化，适合语音朗读
6. 回答时自然地提及信息来源
`;
```

`streamAnswer` 节点通过 `onToken` 回调把 token 逐个推给 Gateway，Gateway 负责按句缓冲和 TTS 衔接。

- [x] Agent 能基于检索结果流式生成回复（`agent.service.ts` + LangGraph 已实现）
- [x] 知识库为空时回复"这个我不太清楚"（Prompt 中有兜底指令）

---

### 1.7 AsrModule

文件：`src/asr/asr.service.ts`

复用 `asr-and-tts-nest-service/speech.service.ts` 的接口，封装腾讯云一句话识别：

```typescript
async recognize(audioBuffer: Buffer, sampleRate = 16000): Promise<string>
```

- [x] 传入录音 Buffer，返回识别文本（`src/asr/asr.service.ts` 已封装阿里云 ASR）

---

### 1.8 TtsModule

文件：`src/tts/tts.service.ts`

复用 `asr-and-tts-nest-service/tencent-tts-session.ts` 的流式 TTS，增加：
- `AbortController` 支持（打断时停止 TTS 请求）
- 不需要内部断句——断句由 Gateway 的缓冲区做完后再调 TTS

```typescript
async synthesizeStream(
  text: string,
  voiceId: string,
  signal: AbortSignal,
  onChunk: (pcm: Buffer) => void,
): Promise<void>
```

- [x] 传入一句话，能流式收到 PCM 音频帧（`src/tts/tts.service.ts` 已实现流式 TTS，支持 AbortSignal）

---

### 1.9 RealtimeSessionModule

文件：`src/realtime-session/realtime-session.registry.ts`

运行时状态容器（不落库），每个 `sessionId` 对应一条记录：

```typescript
interface RealtimeSession {
  sessionId: string;
  conversationId: string;
  personaId: string;
  activeTurnId: string | null;
  abortController: AbortController | null;
  sentenceBuffer: string;          // 断句缓冲区
  wsClientId: string;              // 对应的 WebSocket 连接
}
```

关键方法：
```typescript
create(sessionId: string, params: Omit<RealtimeSession, 'sessionId'>): void
get(sessionId: string): RealtimeSession | undefined
update(sessionId: string, patch: Partial<RealtimeSession>): void
delete(sessionId: string): void
```

---

### 1.10 GatewayModule（纯语音模式）

文件：`src/gateway/conversation.gateway.ts`

处理消息类型：
- `session:start` → 创建 conversation + RealtimeSession
- Binary → 转发给 AsrService，识别完成后触发 Agent
- `conversation:interrupt` → AbortController.abort() + 清空缓冲区

**按句缓冲逻辑（核心）：**

```typescript
private flushBuffer(session: RealtimeSession, token: string, isEnd = false) {
  session.sentenceBuffer += token;

  const SENTENCE_END = /[。？！；]/;
  const CLAUSE_END   = /[，、：]/;

  const shouldFlush =
    SENTENCE_END.test(token) ||
    (CLAUSE_END.test(token) && session.sentenceBuffer.length > 15) ||
    session.sentenceBuffer.length > 50 ||
    isEnd;

  if (shouldFlush && session.sentenceBuffer.trim()) {
    const text = session.sentenceBuffer.trim();
    session.sentenceBuffer = '';
    this.sendToTts(session, text);  // → TtsService → WebSocket binary
  }
}
```

**TTS 音频推送：**

```
服务端发 { type: 'tts:start', turnId }
服务端发 Binary 音频帧（多帧）
服务端发 { type: 'tts:end', turnId }
```

- [x] 完整链路代码落地：浏览器录音 → 松开 → ASR → Agent → TTS → 浏览器播放（`audio.handler.ts` + `agent-pipeline.service.ts` + `tts-pipeline.service.ts`）
- [x] 打断时 LLM 停止生成，TTS 停止推流（`interrupt.handler.ts` 实现 AbortController）

---

### 1.11 前端（纯语音模式）

当前仓库实现基于 `Vue 3 + Vite`（不是原生单页脚本），核心文件：

- `frontend/src/hooks/useAppController.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/hooks/useAudio.ts`
- `frontend/src/components/chat/ChatControls.vue`
- `frontend/src/components/chat/ChatComposer.vue`

状态机（5 个状态见技术方案 10.2）保持不变：

- `idle` 按下 → `recording`，开始 `MediaRecorder`
- `recording` 松开 → `thinking`，发送 Binary 音频（松开后延迟 1 秒发送）
- `thinking` / `speaking` 再次按下 → 先发 `conversation:interrupt`，再切 `recording`

- [x] 按住说话，松开后听到 TTS 回复（`useMicController.ts` 实现完整状态机）
- [x] 说话中途打断，LLM 立即停止，不再继续播放
- [x] 短按不会误发语音，文字发送不会误触麦克风（Pointer 事件防抖 + 状态隔离）

### 1.12 可选：前端文本层接入 `@ai-sdk/vue`

目标：仅替换文本聊天 UI 层，不改后端编排与语音链路。

实施步骤：

1. 锁定 `@ai-sdk/vue@^2`，统一使用 `Chat` 类（不再引入并行的 `legacy` 文本实现）
2. 新增文本适配层 `useTextChatAdapter`，统一导出：
   - `messages`
   - `status`
   - `sendMessage`
   - `stop`
   - `error`
3. `ai-sdk` 模式下由 `useTextChat.ts` 封装 `Chat` 实例：
   - transport 指向 `/api/chat`
   - body 携带 `personaId`、`conversationId`
4. 后端新增 `POST /api/chat` 文本接口（仅协议适配）：
   - 内部仍调用现有 `AgentService`，不引入第二套编排
5. 保持语音入口独立：
   - 麦克风、ASR、TTS、WebRTC 不接入 `Chat`

验收项：

- [x] `ai-sdk` 模式下文本消息可流式渲染（`useTextChat.ts` + `@ai-sdk/vue` 已接入，后端 `chat.controller.ts` 已实现）
- [x] `stop` 可中断文本生成（`textChat.stopText()` 方法实现）
- [x] 文本层统一单实现（AI SDK），不再维护 `legacy` 分叉
- [x] 切换角色时 `personaId` 传参正确
- [x] 文本层异常不影响语音链路可用（`useTextChat` 独立于语音 Hook）

---

**第一阶段验收：**

```
1. 创建"李老师"角色
2. 上传一份 React 相关 TXT 文档
3. 问"React Compiler 是什么？"
4. 收到基于知识库的流式语音回复
5. 说话中途打断，立即停止
6. （可选）切换 `ai-sdk` 文本模式，文字聊天可正常流式显示
```

---

## 第二阶段：完善 RAG 管线 + 知识库管理

> 目标：升级为两阶段检索（向量搜索 + Reranking），加引用溯源，补齐知识库管理 UI

### 2.1 Reranking 升级

将 `KnowledgeService.retrieve()` 从单阶段升级为两阶段：

**第一阶段**：调用 `match_knowledge` RPC，`match_count = 20`（不再是 5）

**第二阶段**：用 LLM 对 top-20 结果重排序，取 top-5

```typescript
// src/knowledge/reranker.service.ts
async rerank(query: string, candidates: KnowledgeChunk[]): Promise<KnowledgeChunk[]> {
  // 方案一：用 LLM 打分（无额外依赖）
  // 方案二：用 @langchain/community 的 CrossEncoderReranker（需要本地模型）
  // V1 先用 LLM 打分，后续课程中对比效果差异
}
```

LLM 打分 Prompt 示例：

```
对以下每条文档，给出它对查询的相关性分数（0-10）：
查询：${query}

文档列表：
${candidates.map((c, i) => `[${i}] ${c.content}`).join('\n')}

只返回 JSON 数组：[{"index": 0, "score": 8}, ...]
```

对比演示用（教学价值）：
- `retrieve(query, { rerank: false })` → 单阶段结果
- `retrieve(query, { rerank: true })` → 两阶段结果
- 展示哪些 chunk 被 Reranker 提升/降级
- 运行链路采用 fail-open：重排失败自动回退 stage1，检索失败按无知识继续，不阻断主对话

- [x] 两阶段检索结果和单阶段结果有可观察的差异
- [x] Reranker 开关通过参数控制，方便演示对比

---

### 2.2 引用溯源

`AgentService` 在流式生成完成后，把本轮使用的检索来源通过 WebSocket 推给前端：

```typescript
// 流式生成完成后推送
ws.send(JSON.stringify({
  type: 'conversation:citations',
  turnId,
  payload: {
    citations: retrievedChunks.map(c => ({
      source: c.source,
      chunkIndex: c.chunk_index,
      similarity: c.similarity,
    })),
  },
}));
```

前端文字区在助手回复下方展示引用列表（语音不读，仅文字显示）。

- [x] 每轮回复下方显示"引用来源：xxx.pdf 第 3 段"

---

### 2.3 知识库管理接口

在 `KnowledgeModule` 中补充：

```
POST   /knowledge/:personaId/documents          # 上传文档（multipart）
GET    /knowledge/:personaId/documents          # 列出文档（含状态）
DELETE /knowledge/:personaId/documents/:docId   # 删除文档（级联删向量）
POST   /knowledge/:personaId/search             # 检索测试（返回两阶段中间结果）
```

`/search` 接口用于调试，返回：

```json
{
  "query": "React Compiler 是什么",
  "stage1": [{ "content": "...", "similarity": 0.82 }, ...],
  "stage2": [{ "content": "...", "rerankScore": 9.1, "similarity": 0.82 }, ...]
}
```

- [x] 上传 PDF，处理完成后能检索到内容
- [x] 删除文档后，对应的 `persona_knowledge` 向量也被清理
- [x] `/search` 接口能直观展示两阶段检索差异

---

### 2.4 知识库管理前端

在 Vue 前端侧边栏中补充（建议落在 `digital-human-agent-frontend/src/components/knowledge/*` 与 `digital-human-agent-frontend/src/hooks/useKnowledge.ts`）：

- 文档列表（文件名 + 状态 + chunk 数量）
- 上传按钮（调 `POST /knowledge/:personaId/documents`）
- 删除按钮
- 检索测试入口（输入查询，展示 stage1 / stage2 对比）

- [x] 能在 UI 中完成上传 → 处理 → 查询的完整流程

---

**第二阶段验收：**

```
1. 上传 PDF，等待处理完成
2. 用检索测试工具对比单阶段和两阶段结果
3. 提问，回复下方显示引用来源
4. 删除文档，确认向量也被清理
```

---

## 第三阶段：语音克隆

> 目标：让 TTS 用目标人物的声音说话，第一阶段的纯语音模式升级为克隆声音

### 3.1 VoiceCloneModule

文件：`src/voice-clone/voice-clone.service.ts`

封装云厂商语音克隆 API（和 ASR/TTS 同一家，降低集成成本）：

```typescript
async createVoice(audioFile: Buffer, name: string): Promise<string>  // 返回 voice_id
async getVoiceStatus(voiceId: string): Promise<'training' | 'ready' | 'failed'>
```

克隆是前置的一次性操作，不在实时链路中。流程：

```
前端上传语音样本（3-10 分钟）→ POST /voice-clone/:personaId
→ 调云 API 提交训练任务
→ 轮询状态（或 webhook）
→ 训练完成 → 更新 persona.voice_id
```

语音样本要求（技术方案 8.3）：

- 时长 3-10 分钟
- WAV/MP3，16kHz 以上采样率
- 正常语速，无背景噪音

接口：

```
POST /voice-clone/:personaId          # 上传语音样本，发起克隆任务
GET  /voice-clone/:personaId/status   # 查询克隆状态
```

- [x] 上传语音样本，拿到 `voice_id`
- [x] `voice_id` 写入 `persona`，TTS 使用克隆声音回复（当前为 mock 训练流程）

---

### 3.2 TtsModule 更新

`TtsService.synthesizeStream()` 增加 `voiceId` 参数，从 `persona` 中取：

```typescript
async synthesizeStream(text: string, voiceId: string, signal: AbortSignal, onChunk: (pcm: Buffer) => void)
```

没有 `voice_id` 的角色降级为默认声音，不报错。

- [x] 有 `voice_id` 的角色用克隆声音回复（基于阿里 TTS voiceId）

---

### 3.3 前端扩展（语音克隆）

在角色管理侧边栏中增加：

- 语音样本上传区（接受 WAV/MP3，展示文件时长）
- 克隆状态轮询展示（pending → training → ready / failed）
- 克隆完成后自动关联到角色，角色卡片显示"已克隆"标记

- [x] 整个克隆流程在 UI 中可完成，不需要手动调 API

---

**第三阶段验收：**

```
1. 上传 3 分钟语音样本
2. 等待克隆完成（UI 显示状态变化）
3. 选择角色对话
4. 听到克隆声音回复（而非默认 TTS 声音）
```

---

## 第四阶段：接入数字人 SDK（Simli）

> 目标：把语音输出替换为 Simli WebRTC 视频流（口型与 PCM 音频同步）
>
> **架构**：Provider 模式 + `speakMode: 'pcm-stream'`，后端 TTS 保持不变，Simli 只负责驱动口型。
> 详见技术方案第 9 节。

### 4.1 重构 DigitalHumanProvider 接口

文件：`src/digital-human/digital-human.types.ts`

按新设计替换接口（技术方案 9.2）：

```typescript
export type DigitalHumanSpeakMode = 'pcm-stream' | 'text-direct';

export interface DigitalHumanSessionInfo {
  providerSessionId: string;
  speakMode: DigitalHumanSpeakMode;
  credentials: Record<string, unknown>; // 透传给前端
}

export interface DigitalHumanProvider {
  readonly name: string;
  createSession(personaId: string, voiceId?: string): Promise<DigitalHumanSessionInfo>;
  interrupt(providerSessionId: string): Promise<void>;
  closeSession(providerSessionId: string): Promise<void>;
  speak?(providerSessionId: string, turnId: string, text: string): Promise<void>; // text-direct 专用
}
```

- NestJS DI 约束（必须）：通过注入令牌解耦具体厂商 Provider，禁止在 Gateway 里 `new SimliProvider()`

```typescript
// src/digital-human/digital-human.constants.ts
export const DIGITAL_HUMAN_PROVIDER = Symbol('DIGITAL_HUMAN_PROVIDER');
```

- [x] `digital-human.types.ts` 替换为新接口
- [x] `MockDigitalHumanProvider` 已实现新接口（当前 `speakMode: 'text-direct'`，用于本地兜底）
- [x] `DigitalHumanModule` 已通过工厂绑定 `DIGITAL_HUMAN_PROVIDER`（`simli|mock` 可切换）
- [x] `SessionHandler` / `InterruptHandler` 仅依赖 `DIGITAL_HUMAN_PROVIDER` 令牌，不依赖具体实现类

---

### 4.2 实现 SimliProvider

文件：`src/digital-human/providers/simli.provider.ts`

```typescript
// 1. POST https://api.simli.ai/startE2ESession → 拿 simliToken
// 2. createSession() 返回 { providerSessionId, speakMode: 'pcm-stream', credentials: { simliToken, faceId } }
// 3. interrupt() 调用 Simli REST API 或靠前端 simliClient.stop()
// 4. closeSession() 调用 Simli 关闭接口
```

安装依赖：`pnpm add @simliai/simli-client`（如有后端 SDK）或直接调 REST API。

调用策略（错误处理基线）：

- 所有 Simli 外部调用设置超时（建议 5s）
- `createSession` 采用有限重试（最多 2 次，指数退避）
- 超时或 5xx 统一映射为 `ServiceUnavailableException`
- 单次会话失败不影响系统存活：返回可观测错误并允许用户重试

- [ ] `SimliProvider.createSession()` 能拿到有效 `simliToken`
- [x] `.env.example` 增加 `SIMLI_API_KEY` / `DIGITAL_HUMAN_PROVIDER`
- [ ] `createSession` 失败时日志包含 `requestId/sessionId/provider`，便于追踪

---

### 4.3 移除 WebRTC 信令层（后端）

删除以下内容：
- `src/gateway/handlers/webrtc.handler.ts` — 整个文件删除
- `gateway.types.ts` 中的 `WsWebRtcAnswerMessage` / `WsWebRtcIceCandidateMessage`
- `conversation.gateway.ts` 中对 `webrtc:answer` / `webrtc:ice-candidate` 的路由
- `RealtimeSession` 中的 `iceUnsubscribe` 字段

修改 `session.handler.ts`：`startDigitalHumanSession()` 改为发送 `digital-human:ready`（携带 Provider credentials）。

- [x] 删除 `WebRtcHandler` 后编译无报错
- [x] `session:start` (mode=digital-human) 触发后，后端发送 `digital-human:ready`，前端已加监听

---

### 4.4 TtsPipelineService 增加 PCM 输出分支

文件：`src/gateway/pipeline/tts-pipeline.service.ts`

数字人模式（`session.mode === 'digital-human'`）下，TTS 合成输出 PCM16 而非 MP3：

```typescript
// TtsAudioFrameMeta.codec = 'audio/pcm'（数字人模式）
// TTS 请求参数 response_format: 'pcm'
```

- [x] 数字人模式下 binary 帧的 `codec` 为 `audio/pcm`
- [x] 纯语音模式不受影响，仍输出 `audio/mpeg`

---

### 4.5 废弃 SpeakPipelineService（pcm-stream 模式）

`SpeakPipelineService` 调用 `speak(text)` 的模式仅在 `text-direct` Provider 下使用。Simli（pcm-stream）下 TtsPipeline 直接推 PCM 帧，`SpeakPipeline` 可保留但对 Simli 路径不激活。

- [x] `SpeakPipelineService` 已加 `speakMode==='text-direct'` 守卫

---

### 4.6 打断机制适配

```typescript
async handleInterrupt(session: RealtimeSession) {
  session.abortController?.abort();   // LLM 停止生成
  session.sentenceBuffer = '';        // 清空断句缓冲
  session.ttsQueue = [];              // 清空 TTS 队列（PCM 帧停发）
  await this.digitalHumanProvider.interrupt(session.digitalHumanSessionId);
}
```

PCM 帧停发后，前端自行调用 `simliClient.stop()` 停止口型（前端收到 `digital-human:end` 时触发）。

- [x] 打断后 LLM 停止生成（已有）
- [ ] PCM binary 帧停发，前端 Simli 口型停止

---

### 4.7 会话清理

```typescript
async cleanupSession(sessionId: string) {
  const session = this.sessionRegistry.get(sessionId);
  if (!session) return;
  session.abortController?.abort();
  if (session.digitalHumanSessionId) {
    await this.digitalHumanProvider.closeSession(session.digitalHumanSessionId);
  }
  this.sessionRegistry.delete(sessionId);
}
```

- [x] 切换角色后旧会话资源完全释放（已有，移除 `iceUnsubscribe?.()` 调用）

---

### 4.8 前端扩展（Simli 接入）

文件：`digital-human-agent-frontend/src/hooks/useDigitalHuman.ts`

- 收到 `digital-human:ready` → `initSimli(credentials)` → `SimliClient.start()`
- 收到 PCM binary 帧 → `simliClient.sendAudioData(pcmData)`
- 收到 `digital-human:end` → `simliClient.stop()` → 切回 `idle`
- `<video>` 元素绑定 SimliClient 输出

- [ ] 浏览器显示 Simli 数字人形象，口型与声音同步
- [x] 文字字幕同步展示在视频区

---

### 4.9 NestJS 基线能力补齐（第四阶段门禁）

> 本节是第四阶段上线前的质量门禁，遵循 `nestjs-best-practices`。

1. 配置与启动
   - [x] `ConfigModule.forRoot({ isGlobal: true, validate })` 启用
   - [x] 对 `DATABASE_URL`、`SUPABASE_*`、`SIMLI_API_KEY`、`DIGITAL_HUMAN_PROVIDER` 做必填校验（含 provider 条件校验）
2. 健康检查
   - [x] 增加 `GET /health`，返回 `app/db/simli/llm` 子状态
   - [x] `db` 与 `simli` 探针失败时返回 `503`
3. 安全与 API
   - [x] 全局 `ValidationPipe`（`whitelist + forbidNonWhitelisted + transform`）
   - [ ] 上传接口加入限流与文件大小上限（防止异常请求压垮服务）
4. 测试
   - [ ] e2e：`session:start(mode=digital-human)` 返回 `digital-human:ready`
   - [ ] e2e：`conversation:interrupt` 后停止 token 与 PCM 推送
   - [ ] 集成：`SimliProvider.createSession` 超时/5xx 映射为 `503`

---

**第四阶段验收（= 项目完整成功标准）：**

```
1. 创建"李老师"角色，上传 React 文档，完成语音克隆
2. 选择"数字人模式"
3. 数字人形象出现，静止待命
4. 按住说话：数字人用李老师的声音回答，口型同步，表情自然
5. 回答内容来自知识库，不编造，文字区显示引用来源
6. 随时打断，立即停止
7. 切换角色，知识库 / 声音 / 数字人形象同步切换
```

---

## 附录：代码重构记录（计划外工作，已完成）

> 在第四阶段开发过程中，对代码库进行了深度重构，显著提升了可维护性。

### 后端 Gateway 拆分（`digital-human-agent`）

**原始状态**：`conversation.gateway.ts` 820 行，承担连接管理、消息路由、ASR、Agent 编排、TTS、数字人信令等全部职责。

**重构后架构**：「路由层 → Handler 层 → Pipeline 层」三层分离

```
src/gateway/
├── conversation.gateway.ts      # 精简至 ~150 行（纯 WS 路由）
├── gateway.types.ts             # 所有 WS 消息类型（Discriminated Union）
├── handlers/
│   ├── session.handler.ts       # session:start 会话初始化
│   ├── audio.handler.ts         # Binary 音频 → ASR
│   ├── text.handler.ts          # 文字输入处理
│   ├── interrupt.handler.ts     # 打断逻辑
│   └── webrtc.handler.ts        # WebRTC 信令（当前状态；第四阶段删除）
└── pipeline/
    ├── agent-pipeline.service.ts  # Agent 执行 + 按句缓冲
    ├── tts-pipeline.service.ts    # TTS 队列推流
    └── speak-pipeline.service.ts  # 数字人播报队列
```

**成效**：消除 `msg: any` 6 处 → 全部强类型；重複代码提取为公共函数；编译零报错。

---

### 前端 Hook 模块化（`digital-human-agent-frontend`）

**原始状态**：`useAppController.ts` 704 行，集中了 WS 事件、状态机、录音、知识库操作等全部逻辑。

**重构后架构**：「组合层 → 业务 Hook → Store」三层分离

```
src/hooks/
├── useAppController.ts      # 生命周期协调器（~100 行，不含业务实现）
├── useWsEventHandler.ts     # 集中注册所有 WS on() 监听
├── useMicController.ts      # 麦克风状态机 + 防抖发送
├── usePersonaActions.ts     # Persona 切换/删除/模式切换
├── useTextChat.ts           # 文字聊天 + @ai-sdk/vue 集成
├── useToast.ts              # Toast 通知
├── useWebSocket.ts          # （原有）WS 连接管理
├── useAudio.ts              # （原有）音频播放
├── useConversation.ts       # （原有）对话状态
├── useKnowledge.ts          # （原有）知识库操作
├── useVoiceClone.ts         # （原有）语音克隆
└── useDigitalHuman.ts       # （原有）数字人 Provider 客户端（Simli）
```

**成效**：`historyLoading` 归入 `sessionStore`；App.vue 各子组件直接从 store/hook 取数，无大量透传；前端编译零报错。

---

### 前端 UI 升级

- **全局样式**：字体换 Inter、完整 design token（shadow/radius/ease）、双光晕页面背景
- **消息气泡**：流式蓝色左边条 + 打字光标；状态标签（中断/失败）带图标；入场动画 `slideUp`
- **消息列表空态**：三层同心圆动画插图；骨架屏宽度随机化
- **ChatControls**：状态改为胶囊 Pill（颜色/动画联动）；麦克风按钮弹簧回弹；右侧 `kbd` 快捷键提示；磨砂背景
- **ChatComposer**：输入框聚焦发光；发送按钮弹簧动画；停止按钮红色轮廓
- **数字人区**：Glassmorphism 徽章状态显示

---

## 附录：环境变量

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                     # Supabase pooler connection string

# OpenAI
OPENAI_API_KEY=
OPENAI_BASE_URL=

# 阿里语音（兼容模式）
ASR_MODEL=paraformer-realtime-v2
TTS_MODEL=cosyvoice-v1
TTS_DEFAULT_VOICE=longxiaochun
VOICE_CLONE_MOCK_DELAY_MS=8000

# 数字人 SDK（Simli）
DIGITAL_HUMAN_PROVIDER=simli
SIMLI_API_KEY=
SIMLI_FACE_ID=
SIMLI_BASE_URL=https://api.simli.ai

# Frontend（文本聊天，默认 AI SDK）
VITE_TEXT_CHAT_MODE=ai-sdk
```

---

## 附录：关键包版本参考

```json
{
  "@nestjs/core": "^11",
  "@nestjs/websockets": "^11",
  "@nestjs/typeorm": "^11",
  "typeorm": "^0.3",
  "pg": "^8",
  "@supabase/supabase-js": "^2",
  "langchain": "^0.3",
  "@langchain/core": "^0.3",
  "@langchain/langgraph": "^0.2",
  "@langchain/openai": "^0.3",
  "@langchain/community": "^0.3",
  "ws": "^8",
  "ai": "^5",
  "@ai-sdk/vue": "^2"
}
```
