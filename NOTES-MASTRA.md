# Mastra AI Agent 课程笔记

> 同一套知识点的 Mastra 版本。对照 LangChain 版（NOTES.md）一起看，理解会更深。

---

## Mastra vs LangChain 一眼看差异

| 能力 | LangChain | Mastra |
| --- | --- | --- |
| 模型初始化 | `new ChatOpenAI({ model, apiKey, baseURL })` | `model: "qwen/qwen-plus"` 一行字符串 |
| 定义工具 | `tool(fn, { name, description, schema })` | `createTool({ id, description, inputSchema, execute })` |
| Agent 循环 | 手写 while 循环 | 框架自动处理，直接 `agent.generate()` |
| 链/流程编排 | Runnable + `.pipe()` | `Workflow` + `.then()/.branch()/.parallel()` |
| 对话记忆 | 手动管理消息历史 | `new Memory(...)` 内置，自动注入 |
| RAG | 手动：Loader → Splitter → Embed → Store | `Document.chunk()` + `embedMany()` 内置封装 |
| 多 Agent 编排 | LangGraph（另一个库） | Workflow 直接支持，不用额外装包 |
| 可观测性 | 接 LangSmith（第三方） | 内置 AI Tracing，零配置 |
| HTTP 服务 | 手动封装 NestJS/Express | `new MastraServer()` 自动注册所有接口 |

---

## 学习路线

```
1. 从零开始    → Agent 初始化、工具定义、自动 Agent 循环、MCP 接入
2. Prompt 管理 → instructions、变量注入、动态 prompt
3. 结构化输出  → Zod schema + withStructuredOutput
4. Workflow    → Mastra 的流程编排（对应 LangChain 的 Runnable + LangGraph）
5. 对话记忆    → Memory 内置三种策略
6. RAG         → Document 加载与切割、向量化
7. 向量数据库  → PgVector / Pinecone 集成
8. 综合编排    → Workflow + Agent + Tools 全部接在一起
9. 语音服务    → 内置 Voice 能力（TTS / STT）
10. 服务部署   → MastraServer 自动暴露 HTTP 接口
```

---

## 一、从零开始

### 第一次跟大模型说话

Mastra 用字符串 `"provider/model"` 指定模型，不需要 `new ChatOpenAI({...})` 这样的初始化代码：

```typescript
import { Agent } from "@mastra/core/agent";

const agent = new Agent({
  name: "my-agent",
  instructions: "你是一个有帮助的助手。",
  model: "qwen/qwen-plus", // provider/model 格式
});

const response = await agent.generate("介绍下自己");
console.log(response.text);
```

Mastra 内置支持 95+ 个模型提供商（OpenAI、Anthropic、通义千问、DeepSeek……），切换模型只改这个字符串，其他代码完全不动。API Key 从环境变量自动读取（`OPENAI_API_KEY`、`QWEN_API_KEY` 等标准命名）。

> 对应 LangChain 的 `ChatOpenAI`，但更简洁。Mastra 不用关心 `baseURL` 这些底层参数，Provider 层帮你处理好了。

---

### 统一入口：Mastra 实例

Mastra 有一个顶层的注册中心，所有 Agent、Workflow、Tool 都注册进去：

```typescript
import { Mastra } from "@mastra/core";

export const mastra = new Mastra({
  agents: { myAgent: agent },
  workflows: { reportWorkflow },
});

// 之后通过 mastra 访问
const agent = mastra.getAgent("myAgent");
const result = await agent.generate("你好");
```

这和 LangChain 里各个组件散落在各处不同——Mastra 有一个集中的应用对象，方便统一管理和对外暴露服务。

---

### 定义工具

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const readFileTool = createTool({
  id: "read_file",
  description: "读取指定路径的文件内容",
  inputSchema: z.object({
    filePath: z.string().describe("文件路径"),
  }),
  outputSchema: z.object({
    content: z.string(),
  }),
  execute: async ({ context }) => {
    const { filePath } = context;
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { content };
    } catch (e) {
      return { content: `读取失败: ${e.message}` };
    }
  },
});
```

和 LangChain 的 `tool()` 对比，Mastra 的 `createTool` 多了一个 `outputSchema`——工具的**输出格式**也用 Zod 定义，这让工具的输入输出都有明确的类型约束，也方便框架做格式转换。

工具挂到 Agent 上：

```typescript
const agent = new Agent({
  name: "file-agent",
  instructions: "你是一个文件助手，可以读写文件。",
  model: "qwen/qwen-plus",
  tools: { readFileTool, writeFileTool },
});
```

---

### Agent 循环——框架自动处理

LangChain 里需要手写 while 循环来处理工具调用。Mastra 的 `agent.generate()` 内部自动做了这件事：

```typescript
// 这一行就够了，Mastra 内部自动：
// 1. 调模型
// 2. 检测到 tool_calls → 执行工具 → 把结果反馈给模型
// 3. 循环直到模型不再调用工具
// 4. 返回最终回复
const result = await agent.generate("读取 ./src/app.ts 并解释代码");
console.log(result.text);
```

流式输出同样简单：

```typescript
const stream = await agent.stream("读取 ./src/app.ts 并解释代码");
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

> 这是 Mastra 相对 LangChain 最大的体验差异之一。LangChain 把循环控制权给了开发者（灵活但繁琐），Mastra 把它封装进去了（简洁但扩展点少一些）。

---

### 接入 MCP 服务器

```typescript
import { MCPClient } from "@mastra/mcp";

const mcpClient = new MCPClient({
  id: "my-mcp-client",
  servers: {
    "amap-maps": {
      url: "https://mcp.amap.com/sse?key=xxx", // HTTP/SSE 方式
    },
    filesystem: {
      command: "npx",
      args: ["@anthropic-ai/mcp-filesystem"], // 子进程方式
    },
  },
});

// 动态工具集挂到 Agent
const agent = new Agent({
  name: "mcp-agent",
  model: "qwen/qwen-plus",
  instructions: "你可以使用各种工具完成任务。",
  dynamicToolsets: [mcpClient], // 工具会动态加载，无需提前枚举
});

// 结束时关闭连接
await mcpClient.disconnect();
```

Mastra 自身也可以作为 MCP Server 对外暴露工具：

```typescript
import { MCPServer } from "@mastra/mcp";

const mcpServer = new MCPServer({
  name: "my-mastra-server",
  version: "1.0.0",
  tools: { readFileTool, writeFileTool },
  agents: { myAgent }, // Agent 也可以作为工具暴露给其他系统
});

await mcpServer.startHTTP({ port: 3001 });
```

---

## 二、Prompt 管理

### instructions——Agent 的角色设定

Mastra 的 `instructions` 对应 LangChain 的 `SystemMessage`。可以是静态字符串，也可以是动态函数：

```typescript
// 静态
const agent = new Agent({
  instructions: "你是一名资深工程团队负责人，请用专业清晰的语气回答。",
  // ...
});

// 动态（根据上下文生成不同的 system prompt）
const agent = new Agent({
  instructions: async ({ runtimeContext }) => {
    const user = runtimeContext.get("user");
    return `你是 ${user.company} 的 AI 助手，当前用户是 ${user.name}（${user.role}）。`;
  },
  // ...
});
```

### 传入变量

`generate()` 调用时通过 `context` 传入额外数据：

```typescript
const result = await agent.generate(
  "请根据本周的开发活动生成一份周报",
  {
    context: [
      {
        role: "user",
        content: `公司：${companyName}\n部门：${teamName}\n本周活动：${activities}`,
      },
    ],
  }
);
```

Mastra 没有 LangChain 那种 `PromptTemplate.fromTemplate("{var}")` 的显式模板系统。它的思路是：**prompt 就是普通字符串拼接或模板字面量，在传给 Agent 之前自己处理好**。对于简单场景这反而更直接，不需要学一套专门的 API。

如果需要系统化管理 Prompt（版本控制、A/B 测试），可以对接 LangSmith Hub：

```typescript
import { pull } from "langchain/hub"; // Mastra 兼容 LangSmith Hub
const prompt = await pull("my-org/weekly-report-v2");
```

---

## 三、结构化输出

Mastra 的结构化输出和 LangChain 思路一样，也是基于 Zod Schema：

```typescript
import { z } from "zod";

const reportSchema = z.object({
  highlights: z.array(z.string()).describe("本周亮点"),
  risks: z.array(z.string()).describe("潜在风险"),
  nextWeekPlan: z.string().describe("下周计划"),
});

// 方式一：Agent 级别指定 output schema
const agent = new Agent({
  model: "qwen/qwen-plus",
  instructions: "根据输入生成周报结构化摘要。",
  defaultGenerateOptions: {
    output: reportSchema,
  },
});

const result = await agent.generate("本周活动：...");
console.log(result.object); // 直接就是解析好的对象
// { highlights: [...], risks: [...], nextWeekPlan: "..." }

// 方式二：单次调用时指定
const result = await agent.generate("本周活动：...", {
  output: reportSchema,
});
```

工具的 `outputSchema` 则是用来规定工具返回给模型的数据结构（也是 Zod）：

```typescript
const weatherTool = createTool({
  id: "get_weather",
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({
    temperature: z.number(),
    condition: z.string(),
  }),
  execute: async ({ context }) => {
    return { temperature: 25, condition: "晴" };
  },
  // 控制模型看到的内容（默认会看到完整 outputSchema 的数据）
  toModelOutput: (output) => `${output.city} 当前 ${output.temperature}°C，${output.condition}`,
});
```

`toModelOutput` 是 Mastra 特有的——工具实际返回给代码的是结构化对象，但模型看到的可以是一段自然语言摘要。两者可以不同，分工明确。

---

## 四、Workflow——流程编排

这是 Mastra 和 LangChain 差异最大的地方。

LangChain 用 Runnable + `.pipe()` 做简单链，用 LangGraph 做复杂状态机——两个不同的库。**Mastra 的 Workflow 把这两件事统一了**，从简单顺序到复杂分支、循环、并行，全用一套 API。

### 基础顺序流

```typescript
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

// Step：流程里的最小执行单元
const validateStep = createStep({
  id: "validate",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ cleaned: z.string() }),
  execute: async ({ inputData }) => ({
    cleaned: inputData.text.trim().toLowerCase(),
  }),
});

const analyzeStep = createStep({
  id: "analyze",
  inputSchema: z.object({ cleaned: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ inputData, mastra }) => {
    // Step 里可以直接调 Agent
    const agent = mastra.getAgent("analyzeAgent");
    const res = await agent.generate(inputData.cleaned);
    return { result: res.text };
  },
});

// Workflow：把 Step 串起来
const pipeline = createWorkflow({
  id: "text-pipeline",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ result: z.string() }),
})
  .then(validateStep)
  .then(analyzeStep)
  .commit();

// 执行
const run = pipeline.createRun();
const result = await run.start({ text: "  Hello World  " });
console.log(result.result); // "hello world 分析结果..."
```

`.then()` 是顺序执行，上一个 Step 的输出自动作为下一个 Step 的输入。

---

### 并行执行

```typescript
const workflow = createWorkflow({ ... })
  .then(fetchDataStep)
  .parallel([
    summarizeStep,   // 这三个同时跑
    translateStep,
    keywordStep,
  ])
  .then(mergeStep)   // 并行完成后合并结果
  .commit();
```

---

### 条件分支

```typescript
const workflow = createWorkflow({
  inputSchema: z.object({ sentiment: z.string() }),
  // ...
})
  .branch([
    [
      async ({ inputData }) => inputData.sentiment === "positive",
      positiveResponseStep,
    ],
    [
      async ({ inputData }) => inputData.sentiment === "negative",
      negativeResponseStep,
    ],
    [async () => true, defaultStep], // 兜底
  ])
  .commit();
```

> 对应 LangChain 的 `RunnableBranch`，但写法更直观——条件是普通的 async 函数，返回 boolean。

---

### 循环

```typescript
// do-while：先执行，再判断是否继续
const workflow = createWorkflow({ ... })
  .dowhile(
    retryStep,
    async ({ inputData }) => inputData.retryCount < 3 && !inputData.success
  )
  .commit();

// foreach：对数组的每个元素执行
const workflow = createWorkflow({ ... })
  .foreach(
    "users",          // inputData 里的哪个数组
    processUserStep,  // 对每个元素执行的 Step
    { concurrency: 3 } // 并发数
  )
  .commit();
```

---

### Human-in-the-loop

Workflow 内置了人工审批机制，不需要像 LangGraph 那样额外配置：

```typescript
const reviewStep = createStep({
  id: "review",
  inputSchema: z.object({ draft: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({ reason: z.string() }),   // 暂停时给人看的信息
  resumeSchema: z.object({ decision: z.enum(["approve", "reject"]) }),

  execute: async ({ inputData, suspend, resumeData }) => {
    if (!resumeData) {
      // 第一次进来，还没有人工决策，先暂停
      await suspend({ reason: `请审核这份草稿：\n${inputData.draft}` });
    }

    // 被 resume 后，resumeData 里有人工填入的决策
    return { approved: resumeData.decision === "approve" };
  },
});

// 运行 Workflow，到 reviewStep 时自动暂停
const run = workflow.createRun();
await run.start({ draft: "..." });

// ...人工审核后恢复...
await run.resume({ stepId: "review", resumeData: { decision: "approve" } });
```

---

## 五、对话记忆

### 内置 Memory，不用手写历史管理

LangChain 里你需要手动维护 `messages` 数组，手动实现截断/摘要。Mastra 的 Memory 是内置的，只需要配置一次：

```typescript
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

const memory = new Memory({
  storage: new LibSQLStore({
    url: "file:./memory.db", // 本地 SQLite，生产换 PostgreSQL
  }),
  lastMessages: 20,      // 保留最近 20 条消息
  semanticRecall: {
    enabled: true,
    topK: 5,             // 语义检索 5 条相关历史
  },
});

const agent = new Agent({
  name: "chat-agent",
  model: "qwen/qwen-plus",
  instructions: "你是一个有记忆的助手。",
  memory,
});
```

调用时传入 `resourceId`（用户标识）和 `threadId`（对话 ID），Memory 自动处理剩下的：

```typescript
// 第 1 轮
await agent.generate("我叫张三，我喜欢打篮球", {
  resourceId: "user-001",
  threadId: "session-001",
});

// 第 2 轮——Memory 自动注入历史
const result = await agent.generate("我叫什么？我有什么爱好？", {
  resourceId: "user-001",
  threadId: "session-001",
});
// result.text: "你叫张三，你喜欢打篮球。"
```

---

### 三种记忆策略

Mastra Memory 内置了三种策略，可以同时开启：

**1. 消息历史（Message History）**——保留最近 N 条对话，直接加进上下文

```typescript
const memory = new Memory({
  storage,
  lastMessages: 15, // 保留最近 15 条
});
```

**2. 语义召回（Semantic Recall）**——把历史消息向量化，按相关性检索

```typescript
const memory = new Memory({
  storage,
  semanticRecall: {
    enabled: true,
    topK: 5,                // 返回最相关的 5 条
    messageRange: { before: 2, after: 2 }, // 每条结果的前后各扩展 2 条上下文
  },
  vector: new PgVector("postgresql://..."), // 向量存储
  embedder: openai.embedding("text-embedding-3-small"),
});
```

**3. 工作记忆（Working Memory）**——持久存储用户的结构化信息（偏好、背景等）

```typescript
const memory = new Memory({
  storage,
  workingMemory: {
    enabled: true,
    template: `
      用户姓名：{{name}}
      职业：{{occupation}}
      偏好语言：{{language}}
    `, // Agent 会主动把重要信息填进来
  },
});
```

工作记忆解决的是"跨会话记住用户基本信息"的问题——不管隔多久，下次对话时模型依然知道用户是谁。

> 对比 LangChain：LangChain 的截断/摘要策略需要自己写代码实现，Mastra 的三种策略是内置的，配置几行参数就够了。

---

## 六、RAG 文档处理

### 加载和切割文档

```typescript
import { MDocument } from "@mastra/rag";

// 从各种格式创建文档
const doc = MDocument.fromText("你的文档内容...");
const doc = MDocument.fromMarkdown("# 标题\n内容...");
const doc = MDocument.fromHTML("<p>内容</p>");

// 切割
const chunks = await doc.chunk({
  strategy: "recursive",  // 递归切割（类似 LangChain 的 RecursiveCharacterTextSplitter）
  size: 512,
  overlap: 50,
  separator: ["。", "！", "？", "\n"],
});

// 或者按语义切割
const chunks = await doc.chunk({
  strategy: "sentence", // 按句子
  minSize: 100,
  maxSize: 500,
});
```

---

### 向量化和存储

```typescript
import { embedMany } from "@mastra/rag";
import { openai } from "@ai-sdk/openai";

// 批量向量化
const { embeddings } = await embedMany({
  model: openai.embedding("text-embedding-3-small"),
  values: chunks.map(chunk => chunk.text),
});

// 存入 PgVector（PostgreSQL 向量扩展）
import { PgVector } from "@mastra/pg";

const pgVector = new PgVector(process.env.POSTGRES_URL);
await pgVector.createIndex({ indexName: "docs", dimension: 1536 });

await pgVector.upsert({
  indexName: "docs",
  vectors: embeddings.map((embedding, i) => ({
    id: `chunk-${i}`,
    vector: embedding,
    metadata: { text: chunks[i].text, source: "my-doc" },
  })),
});
```

---

### 检索和问答

```typescript
// 检索
const queryEmbedding = await embed({
  model: openai.embedding("text-embedding-3-small"),
  value: "用户的问题",
});

const results = await pgVector.query({
  indexName: "docs",
  queryVector: queryEmbedding.embedding,
  topK: 5,
  filter: { source: "my-doc" }, // 元数据过滤
});

// 构建 RAG Agent
const ragAgent = new Agent({
  name: "rag-agent",
  model: "qwen/qwen-plus",
  instructions: "你是文档助手，基于提供的上下文回答问题，不知道的不要乱答。",
  tools: {
    searchDocs: createTool({
      id: "search_docs",
      description: "在文档库中搜索相关内容",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ context }) => {
        const embedding = await embed({ model, value: context.query });
        const results = await pgVector.query({ indexName: "docs", queryVector: embedding.embedding, topK: 3 });
        return { chunks: results.map(r => r.metadata.text) };
      },
    }),
  },
});

const answer = await ragAgent.generate("关于XX的问题是什么？");
```

---

## 七、向量数据库集成

Mastra 内置多个向量数据库的适配器：

```typescript
// PostgreSQL（pgvector 扩展）— 推荐，不用额外数据库
import { PgVector } from "@mastra/pg";
const store = new PgVector(process.env.POSTGRES_URL);

// Pinecone
import { PineconeVector } from "@mastra/pinecone";
const store = new PineconeVector(process.env.PINECONE_API_KEY);

// Qdrant
import { QdrantVector } from "@mastra/qdrant";
const store = new QdrantVector(process.env.QDRANT_URL);
```

接口统一，换数据库只换导入的类，其他代码不变。

**和 LangChain/Milvus 的对比**：LangChain 用社区包 `@langchain/community/vectorstores/milvus`，Mastra 优先推荐 pgvector（直接用 PostgreSQL，不用单独维护一个 Milvus 服务）。如果已经有 PostgreSQL，加装 pgvector 扩展即可，运维成本低很多。

---

## 八、综合编排——Workflow + Agent + Tools

Mastra 最能体现设计优势的地方：把 Agent 和 Workflow 结合起来。

一个典型的"定时任务 + 多工具 Agent"场景：

```typescript
// 1. 定义工具
const webSearchTool = createTool({ id: "web_search", ... });
const sendMailTool = createTool({ id: "send_mail", ... });
const dbQueryTool = createTool({ id: "db_query", ... });

// 2. 定义执行任务的 Agent
const taskAgent = new Agent({
  name: "task-agent",
  model: "qwen/qwen-plus",
  instructions: "你是一个后台任务执行助手，根据指令使用工具完成任务。",
  tools: { webSearchTool, sendMailTool, dbQueryTool },
});

// 3. 用 Workflow 编排流程（定时触发 → 执行任务 → 发送报告）
const dailyReportWorkflow = createWorkflow({
  id: "daily-report",
  inputSchema: z.object({ date: z.string() }),
  outputSchema: z.object({ sent: z.boolean() }),
})
  .then(
    createStep({
      id: "gather-data",
      execute: async ({ inputData, mastra }) => {
        const agent = mastra.getAgent("task-agent");
        const result = await agent.generate(`收集 ${inputData.date} 的日报数据`);
        return { reportContent: result.text };
      },
    })
  )
  .then(
    createStep({
      id: "send-report",
      execute: async ({ inputData, mastra }) => {
        const agent = mastra.getAgent("task-agent");
        await agent.generate(`将以下内容发送邮件：${inputData.reportContent}`);
        return { sent: true };
      },
    })
  )
  .commit();

// 4. 注册到 Mastra，设置定时触发
export const mastra = new Mastra({
  agents: { taskAgent },
  workflows: { dailyReportWorkflow },
});
```

定时调度可以用任何外部调度器（cron、node-cron）触发 `workflow.createRun().start()`，Mastra 本身不内置调度，但和 Workflow 对接很简单。

---

## 九、语音服务

Mastra 把语音能力内置到 Agent，不需要额外写 TTS/ASR 的逻辑：

```typescript
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

const voiceAgent = new Agent({
  name: "voice-agent",
  model: "qwen/qwen-plus",
  instructions: "你是一个语音助手。",
  voice: {
    // 语音合成（TTS）
    speaker: openai.speech("tts-1", {
      voice: "shimmer",
      speed: 1.0,
    }),
    // 语音识别（STT）
    listener: openai.transcription("whisper-1"),
  },
});

// 文字 → 语音
const audioStream = await voiceAgent.speak("你好，今天天气怎么样？");
// audioStream 是可以直接写文件或推送给客户端的流

// 语音 → 文字
const audioBuffer = fs.readFileSync("input.mp3");
const text = await voiceAgent.listen(audioBuffer);
console.log(text); // "你好，今天天气怎么样？"
```

> Mastra 把 TTS 和 STT 都封装在 Agent 上，意味着同一个 Agent 既能文字对话，也能语音对话，不需要像 LangChain 那样手动接腾讯云 SDK、写中继服务。

---

## 十、部署——MastraServer 自动暴露接口

Mastra 最大的工程化优势：一行代码把所有 Agent 和 Workflow 暴露为 HTTP 接口。

```typescript
import { Mastra } from "@mastra/core";
import { MastraServer } from "@mastra/server";

const mastra = new Mastra({
  agents: { chatAgent, ragAgent },
  workflows: { reportWorkflow },
});

// 自动注册所有接口，无需手写 Controller
const server = new MastraServer({ mastra });
await server.start({ port: 3000 });

// 框架自动生成的接口：
// POST /api/agents/chatAgent/generate    → 调用 chatAgent
// POST /api/agents/chatAgent/stream      → 流式输出
// POST /api/workflows/reportWorkflow/run → 触发 Workflow
// GET  /api/agents                       → 列出所有 Agent
// ... 更多自动生成的 CRUD 接口
```

如果已有 Express/Hono 应用，可以用适配器嵌入：

```typescript
import express from "express";
import { MastraExpress } from "@mastra/express";

const app = express();
const mastraExpress = new MastraExpress({ mastra });
app.use("/ai", mastraExpress.router()); // 挂在 /ai 路径下
app.listen(3000);
```

> 对应 LangChain 版本里需要手写的 NestJS Module / Service / Controller / SSE，Mastra 用一个 `MastraServer` 全替了。代价是灵活性低一些，优势是零配置、快速上线。

---

## 关键差异总结

### 同一件事，两种写法对比

**调用 Agent（含工具循环）**

```typescript
// LangChain — 手写循环
const messages = [new HumanMessage("...")];
while (true) {
  const response = await modelWithTools.invoke(messages);
  messages.push(response);
  if (!response.tool_calls?.length) break;
  for (const tc of response.tool_calls) {
    const result = await tools[tc.name].invoke(tc.args);
    messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
  }
}

// Mastra — 框架处理
const result = await agent.generate("...");
```

**对话记忆**

```typescript
// LangChain — 手动管理 + RunnableWithMessageHistory
const history = new InMemoryChatMessageHistory();
const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory: (id) => history,
  inputMessagesKey: "question",
  historyMessagesKey: "history",
});

// Mastra — 配置一次就自动处理
const memory = new Memory({ storage, lastMessages: 20 });
const agent = new Agent({ ..., memory });
await agent.generate("问题", { resourceId: "user-1", threadId: "session-1" });
```

**流程编排（带条件分支）**

```typescript
// LangChain — RunnableBranch
const branch = RunnableBranch.from([
  [(input) => input.type === "a", chainA],
  [(input) => input.type === "b", chainB],
  defaultChain,
]);

// Mastra — Workflow.branch()
createWorkflow({ ... })
  .branch([
    [async ({ inputData }) => inputData.type === "a", stepA],
    [async ({ inputData }) => inputData.type === "b", stepB],
    [async () => true, defaultStep],
  ])
  .commit();
```

### 如何选择？

| 场景 | 推荐 |
| --- | --- |
| 已有 LangChain 项目，逐步迭代 | 继续用 LangChain，有需要再引入 Mastra |
| 新项目，TypeScript 技术栈 | Mastra（开箱即用，工程化好） |
| 需要极度定制化的 Agent 循环 | LangChain（控制权更细） |
| 需要快速上线，少写代码 | Mastra（内置太多了） |
| Multi-Agent 复杂编排 | Mastra Workflow（比手写 LangGraph 简单） |

---

## 核心依赖速查

| 包 | 用途 |
| --- | --- |
| `@mastra/core` | Agent、Tool、Mastra 核心 |
| `@mastra/memory` | 对话记忆（三种策略） |
| `@mastra/rag` | RAG 文档处理（Document、chunk、embedMany） |
| `@mastra/pg` | PostgreSQL + pgvector 存储 |
| `@mastra/mcp` | MCP Client / Server |
| `@mastra/server` | HTTP 服务自动暴露 |
| `@mastra/express` | Express 适配器 |
| `@ai-sdk/openai` | OpenAI / 兼容接口的 Provider |
| `zod` | Schema 定义（工具输入/输出、结构化输出） |
