# LangChain AI Agent 课程笔记

> 学习路线：从第一次调 LLM，到构建工具 Agent，到 RAG 知识库，再到生产级 NestJS 服务。

---

## 学习路线

```
1. tool-test               → 从零开始：调 LLM、定义工具、写 Agent 循环、接 MCP
2. prompt-template-test    → 学会精确控制模型的输入（Prompt 工程）
3. output-parser-test      → 让模型按你要的格式输出结构化数据
4. runnable-test           → 理解 LangChain 的组合哲学（Runnable 体系）
5. rag-test                → 给 Agent 接上"外部知识库"（文档加载与切割）
6. memory-test             → 让 Agent 记住对话——三种策略各有取舍
7. milvus-test             → 换上生产级向量数据库，跑电子书 RAG 实战
8. cron-job-tool           → 把所有能力合在一起：定时任务 + 多工具 Agent
9. tts-stt-test            → 加上耳朵和嘴巴：语音识别与语音合成
10. asr-and-tts-nest-service → 把语音和 AI 接成一条完整的流水线
12. langgraph-test          → 状态图 Agent：从 while 循环升级到声明式 StateGraph
```

---

## 一、从零开始（tool-test）

### 第一次跟大模型说话

先从最简单的地方入手——直接调用大模型：

```javascript
import 'dotenv/config';
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const response = await model.invoke("介绍下自己");
console.log(response.content);
```

你可能会问：为什么不直接用 OpenAI 的官方 SDK，非要套一层 LangChain？

原因在于 **统一接口**。LangChain 的 `ChatOpenAI` 不只是包装了 OpenAI，只要改一下 `baseURL`，就能接入通义千问、DeepSeek、本地部署的 Ollama——后面写的所有 Prompt、工具、链，完全不用改。这是 LangChain 最核心的价值之一。

`temperature` 控制模型输出的随机性。设成 0 意味着每次调用结果都一样，适合工具调用这种需要精确性的场景；设成 0.7 则更有创意，适合写文章、头脑风暴。

---

### 消息不只有"用户说的话"

跟大模型通信时，消息分四种，这四种贯穿整个课程，要记住：

- **SystemMessage**：系统提示，告诉模型它是谁、该怎么行事。模型会始终遵循这个设定。
- **HumanMessage**：用户说的话。
- **AIMessage**：模型的回复。在 Agent 里，它可能还附带 `tool_calls` 数组，表示"我要调用某个工具"。
- **ToolMessage**：工具的执行结果，**必须带着 `tool_call_id`**，告诉模型"这是你刚才那个工具调用的结果"。如果 `tool_call_id` 对不上，模型会困惑甚至报错。

四种消息组成一个对话历史数组，每次调用模型都把整个数组传进去，模型才能"记住"上下文。

---

### 给模型装上工具

光会聊天不够，真正有用的 Agent 是能帮你做事的。先看怎么定义一个工具（来自 `all-tools.mjs`）：

```javascript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from 'node:fs/promises';
import path from 'node:path';

// 读文件工具
const readFileTool = tool(
  async ({ filePath }) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return `文件内容:\n${content}`;
    } catch (error) {
      return `读取文件失败: ${error.message}`; // 注意：返回错误信息，不要 throw
    }
  },
  {
    name: 'read_file',
    description: '读取指定路径的文件内容',
    schema: z.object({
      filePath: z.string().describe('文件路径'),
    }),
  }
);

// 写文件工具——注意它自动创建目录
const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true }); // 自动创建不存在的目录
      await fs.writeFile(filePath, content, 'utf-8');
      return `文件写入成功: ${filePath}`;
    } catch (error) {
      return `写入文件失败: ${error.message}`;
    }
  },
  {
    name: 'write_file',
    description: '向指定路径写入文件内容，自动创建目录',
    schema: z.object({
      filePath: z.string().describe('文件路径'),
      content: z.string().describe('要写入的文件内容'),
    }),
  }
);
```

一个工具由三部分组成：**执行函数**、**名称和描述**、**参数 Schema**。

`description` 和 `.describe()` 看似不重要，实际上极其关键。模型完全靠这些文字来决定"什么时候该用这个工具"、"这个参数应该填什么"。描述写得清楚，模型传参就准确；描述含糊，模型要么不调用工具，要么传错参数。

**为什么 catch 住异常返回文本，而不是 throw？**
因为 throw 会让整个程序崩溃，而 Agent 应该能从错误中恢复。模型看到"读取文件失败: 文件不存在"后，可以决定：换个路径重试、告诉用户文件不存在、或者先创建这个文件。这才是正确的 Agent 行为。

定义好工具之后，用 `bindTools` 把它们附加到模型上：

```javascript
const tools = [readFileTool, writeFileTool, executeCommandTool, listDirectoryTool];
const modelWithTools = model.bindTools(tools);
```

`bindTools` 不会修改原模型，它返回一个新实例。底层做的是把工具的 Zod Schema 转成 OpenAI function calling 格式，加到 API 请求的 `tools` 字段里。模型不是被强制调用工具，它会自己判断——觉得需要就调，觉得不需要就直接回答。

---

### Agent 的核心：循环调用

现在到了整个课程最重要的模式。

为什么需要循环？因为复杂任务需要多步骤。比如"读这个文件，翻译后写到新文件"——需要先调 read_file，再处理内容，再调 write_file。这个过程是一轮一轮迭代的，而不是一次调用能搞定的。

这个模式叫 **ReAct（Reasoning + Acting）**：

```javascript
// 来自 tool-file-read.mjs 的实际代码
const messages = [
  new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。

工作流程：
1. 用户要求读取文件时，立即调用 read_file 工具
2. 等待工具返回文件内容
3. 基于文件内容进行分析和解释
`),
  new HumanMessage('请读取 ./src/tool-file-read.mjs 文件内容并解释代码')
];

let response = await modelWithTools.invoke(messages);
messages.push(response); // 第一步：模型回复必须加入历史

while (response.tool_calls && response.tool_calls.length > 0) {
  console.log(`[检测到 ${response.tool_calls.length} 个工具调用]`);

  // 用 Promise.all 并行执行所有工具调用（模型可能一次请求多个工具）
  const toolResults = await Promise.all(
    response.tool_calls.map(async (toolCall) => {
      const targetTool = tools.find(t => t.name === toolCall.name);
      try {
        return await targetTool.invoke(toolCall.args);
      } catch (error) {
        return `错误: ${error.message}`;
      }
    })
  );

  // 每个工具结果对应一条 ToolMessage，tool_call_id 必须匹配
  response.tool_calls.forEach((toolCall, index) => {
    messages.push(new ToolMessage({
      content: toolResults[index],
      tool_call_id: toolCall.id,
    }));
  });

  // 再次调用模型，传入工具结果
  response = await modelWithTools.invoke(messages);
  messages.push(response);
}

console.log('最终回复:', response.content);
```

**`Promise.all` 并行执行的意义**：模型一次可以返回多个工具调用（比如同时要读 3 个文件），用 `Promise.all` 并行执行，比串行快得多。

**整个执行过程**，以"读取文件并解释代码"为例：

```
第 1 轮 invoke：
  输入：[SystemMessage, HumanMessage("读取 tool-file-read.mjs 并解释")]
  模型输出：tool_calls: [{ name: "read_file", args: { filePath: "./src/tool-file-read.mjs" } }]
  → 执行 read_file → 得到文件内容
  → push ToolMessage(文件内容)

第 2 轮 invoke：
  输入：[SystemMessage, HumanMessage, AIMessage(第1轮), ToolMessage(文件内容)]
  模型输出：content: "这个文件展示了...", tool_calls: []
  → 无工具调用 → 退出循环 → 输出最终回复
```

**生产环境必须加最大迭代次数**（如 `maxIterations = 30`），防止模型进入无意义的死循环。

---

### System Prompt 对 Agent 行为的影响

一个好的 System Prompt 不只是"设定角色"，它还要给模型清晰的工作规则。来看 `mini-cursor.mjs` 里的完整 System Prompt：

```javascript
new SystemMessage(`你是一个项目管理助手，使用工具完成任务。

当前工作目录: ${process.cwd()}

工具：
1. read_file: 读取文件
2. write_file: 写入文件
3. execute_command: 执行命令（支持 workingDirectory 参数）
4. list_directory: 列出目录

重要规则 - execute_command：
- workingDirectory 参数会自动切换到指定目录
- 当使用 workingDirectory 时，绝对不要在 command 中使用 cd
- 错误示例: { command: "cd react-todo-app && pnpm install", workingDirectory: "react-todo-app" }
  这是错误的！因为 workingDirectory 已经在 react-todo-app 目录了，再 cd 会找不到目录
- 正确示例: { command: "pnpm install", workingDirectory: "react-todo-app" }
`)
```

这里有一个非常关键的设计：**用"错误示例 vs 正确示例"的对比来约束模型行为**。光说"不要用 cd"，模型不一定遵守。给出具体的错误/正确示例对比，模型理解得更准确。这是 Prompt 工程里的"少样本"技巧在 System Prompt 里的应用。

`workingDirectory` 参数的设计原因：每次 `spawn` 子进程都是独立的，上一个命令里的 `cd` 不会影响下一个命令的工作目录。所以通过参数显式指定工作目录，而不是依赖 `cd`，这是正确的跨进程设计。

---

### Mini Cursor — 工具 Agent 实战

项目里的 `mini-cursor.mjs` 展示了 Cursor 类 AI IDE 的核心机制。给它一条指令：

```
创建一个功能丰富的 React TodoList 应用
```

它会自己按步骤执行（每步都是一次工具调用）：

```
→ execute_command: "echo -e 'n\nn' | pnpm create vite react-todo-app --template react-ts"
→ write_file: "react-todo-app/src/App.tsx"（完整的 TodoList 组件，含增删改查）
→ write_file: "react-todo-app/src/App.css"（渐变背景、卡片阴影、hover 效果）
→ execute_command: "pnpm install"（workingDirectory: "react-todo-app"）
→ execute_command: "pnpm run dev"（workingDirectory: "react-todo-app"）
→ 最终回复："项目已创建并启动，访问 http://localhost:5173"
```

没有什么魔法，就是一个 Agent 循环加上文件和命令工具。Cursor 之所以能改代码、执行命令，原理完全一样。

---

### MCP 协议——工具的"插件化"

到目前为止，工具都是在代码里写死的。如果工具要跨项目共享，或者由第三方提供，该怎么办？MCP（Model Context Protocol）就是为了解决这个问题的。

**MCP Server** 是一个独立进程，通过 stdin/stdout 和调用方通信：

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "my-mcp-server", version: "1.0.0" });

server.registerTool("query_user", {
  description: "查询数据库中的用户信息",
  inputSchema: { userId: z.string().describe("用户 ID，例如: 001, 002, 003") },
}, async ({ userId }) => {
  const user = database.users[userId];
  if (!user) {
    return { content: [{ type: "text", text: `用户 ${userId} 不存在` }] };
  }
  // MCP 工具返回格式是固定的：{ content: [{ type: "text", text: "..." }] }
  return {
    content: [{ type: "text", text: `姓名: ${user.name}, 邮箱: ${user.email}` }],
  };
});

// 还可以注册 Resource（只读文档/上下文），客户端可以读取作为背景知识
server.registerResource("使用指南", "docs://guide", {
  description: "工具使用文档",
  mimeType: "text/plain",
}, async () => ({
  contents: [{ uri: "docs://guide", mimeType: "text/plain", text: "..." }],
}));

await server.connect(new StdioServerTransport());
```

**MCP Client** 连接服务器，把工具自动合并进来：

```javascript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "my-server": { command: "node", args: ["./my-mcp-server.mjs"] }, // 本地子进程
    "amap-maps": { url: "https://mcp.amap.com/sse?key=xxx" },         // 远程 HTTP
    "filesystem": { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }, // npx
  },
});

const tools = await mcpClient.getTools(); // 所有服务器的工具合并成一个列表
// 也可以读取 Resource 注入上下文
const resources = await mcpClient.listResources();

const modelWithTools = model.bindTools(tools);
// 之后走普通的 Agent 循环，不用关心工具来自哪个服务器

await mcpClient.close();
```

MCP 的好处在于**解耦和复用**：工具可以单独发布和维护，接入方只需要一行配置，不需要关心实现细节。高德地图、GitHub、Figma 等平台都已经有了公开的 MCP 服务器，直接接入就能用。

### MCP Resource 注入上下文——工具负责执行，Resource 负责知识

MCP Server 除了注册 Tool，还可以注册 **Resource**（只读文档/知识）。客户端读取 Resource 内容后，注入到 SystemMessage 里，让模型拥有背景知识：

```javascript
// langchain-mcp-test.mjs — 读取 Resource 并注入 Prompt
const resourcesByServer = await mcpClient.listResources();

let resourceContext = '';
for (const [serverName, resources] of Object.entries(resourcesByServer)) {
  for (const resource of resources) {
    const content = await mcpClient.readResource(serverName, resource.uri);
    resourceContext += content.map(c => c.text).join('\n');
  }
}

// 把 Resource 内容作为系统消息的一部分
const messages = [
  new SystemMessage(`你是一个助手。以下是参考文档：\n${resourceContext}`),
  new HumanMessage(query),
];
```

**Tool vs Resource 的区别**：
- **Tool**：模型在推理过程中主动调用，有副作用（搜索、写文件、发邮件）
- **Resource**：客户端启动时一次性读取，注入上下文，无副作用（文档、配置、指南）

### execute_command 工具——spawn 的正确姿势

来自 `all-tools.mjs`，`execute_command` 工具封装了 `child_process.spawn`，支持 `workingDirectory` 参数：

```javascript
const executeCommandTool = tool(
  async ({ command, workingDirectory }) => {
    const cwd = workingDirectory || process.cwd();
    const [cmd, ...args] = command.split(' ');

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,                  // 指定工作目录
        stdio: 'inherit',     // 子进程的 stdout/stderr 直接输出到当前终端
        shell: true,          // 使用 shell 解析（支持管道等 shell 特性）
      });

      child.on('error', (err) => resolve(`命令执行错误: ${err.message}`));
      child.on('close', (code) => {
        if (code === 0) resolve(`命令执行成功`);
        else resolve(`命令执行失败，退出码: ${code}`);
      });
    });
  },
  {
    name: 'execute_command',
    description: '执行系统命令...',
    schema: z.object({
      command: z.string().describe('要执行的命令'),
      workingDirectory: z.string().optional().describe('工作目录路径'),
    }),
  }
);
```

**`stdio: 'inherit'`** 让子进程直接共享父进程的 stdin/stdout/stderr，命令的输出会实时显示在终端里。这和 `exec` 收集完整输出再返回不同——适合长时间运行的命令（如 `pnpm install`）。

---

## 二、Prompt 工程（prompt-template-test）

这一部分主要讨论如何通过 `PromptTemplate` 和 `ChatPromptTemplate` 更好地组织大模型输入。核心理念是**模板与数据分离**，提高 Prompt 的可复用性和维护性。

核心知识点：
1. **PromptTemplate**：用于生成纯文本的模板，通过 `{v}` 插入动态变量。
2. **ChatPromptTemplate**：针对聊天模型，将输入组织成 `System` 和 `Human` 的带角色消息队列，这有助于让模型始终坚定执行系统预设。
3. **少样本提示 (FewShot)**：比起语言描述，“举例子”往往能带来更好的效果。对于复杂的格式（如周报生成），可以提供 Examples 供模型学习。
4. **PipelinePromptTemplate**：当业务复杂时，可通过多级模板将 Prompt 拆分为独立的面相（如人设、任务、规则），增强复用性。

---

## 三、结构化输出（output-parser-test）

控制好了输入，接下来要控制输出。

默认情况下模型返回自由文本。但很多场景需要结构化数据——一个 JSON 对象，可以直接访问 `.name`、`.year` 这样的字段，方便下游代码处理。

### 为什么直接 JSON.parse 会失败？

来看 `normal.mjs` 的做法：让模型"以 JSON 格式返回"，然后 `JSON.parse(response.content)`。

问题是模型不可靠——它可能输出这样的内容：

```
当然！以下是爱因斯坦的信息：

```json
{
  "name": "阿尔伯特·爱因斯坦",
  ...
}
```

```

模型在 JSON 前后加了解释文字和 markdown 代码块，`JSON.parse` 直接崩溃。

Parser 的价值就在于：**从模型的自由文本里可靠地提取结构化数据**，同时还能通过 `getFormatInstructions()` 告诉模型应该怎么格式化。

---

### 进化路线：从最原始到最现代

**第一步：JsonOutputParser**（能提取但不约束字段）

```javascript
import { JsonOutputParser } from '@langchain/core/output_parsers';

const parser = new JsonOutputParser();
const question = `请介绍爱因斯坦，以 JSON 格式回答。\n${parser.getFormatInstructions()}`;

const response = await model.invoke(question);
const result = await parser.parse(response.content); // 能处理 markdown 包裹的 JSON
```

**第二步：StructuredOutputParser**（约束字段结构）

```javascript
import { StructuredOutputParser } from '@langchain/core/output_parsers';

// 简单版：指定字段名和描述
const simpleParser = StructuredOutputParser.fromNamesAndDescriptions({
  name: "姓名",
  birth_year: "出生年份",
  famous_theory: "著名理论",
});

// 复杂版：用 Zod 定义嵌套结构（来自 structured-output-parser2.mjs）
const zodParser = StructuredOutputParser.fromZodSchema(
  z.object({
    name: z.string().describe("科学家的全名"),
    fields: z.array(z.string()).describe("研究领域列表"),
    awards: z.array(z.object({
      name: z.string().describe("奖项名称"),
      year: z.number().describe("获奖年份"),
      reason: z.string().optional().describe("获奖原因"),
    })).describe("获奖记录"),
    education: z.object({
      university: z.string(),
      degree: z.string(),
    }).optional().describe("教育背景"),
    biography: z.string().describe("简短传记，100字以内"),
  })
);

const question = `请介绍居里夫人。\n${zodParser.getFormatInstructions()}`;
const response = await model.invoke(question);
const result = await zodParser.parse(response.content); // 用 Zod 校验，类型不对抛 ZodError
```

**第三步：withStructuredOutput**（现代推荐写法，最简洁）

```javascript
const schema = z.object({
  name: z.string().describe("科学家的全名"),
  birth_year: z.number().describe("出生年份"),
  nationality: z.string().describe("国籍"),
  fields: z.array(z.string()).describe("研究领域列表"),
});

const structuredModel = model.withStructuredOutput(schema);
const result = await structuredModel.invoke("介绍一下爱因斯坦");
// result 直接就是 JS 对象，不需要 getFormatInstructions()，不需要 parse()
console.log(result.name, result.birth_year); // 直接访问
```

底层利用模型 API 的原生 JSON 模式，模型层面就被约束只能输出符合 Schema 的 JSON，比 Parser 更可靠。

---

### 流式输出

**普通文本流式**（来自 `stream-normal.mjs`）：

```javascript
const stream = await model.stream("详细介绍莫扎特的信息");

for await (const chunk of stream) {
  process.stdout.write(chunk.content); // 每个 chunk 是一小段文本
}
```

**结构化数据流式**（来自 `stream-with-structured-output.mjs`）：

```javascript
const structuredModel = model.withStructuredOutput(schema);
const stream = await structuredModel.stream("详细介绍莫扎特");

for await (const chunk of stream) {
  console.log(chunk); // 每个 chunk 是一个逐步填充的对象
}
// Chunk 1: {}
// Chunk 2: { name: "沃尔夫冈·阿马德乌斯·莫扎特" }
// Chunk 3: { name: "...", birth_year: 1756 }
// 最后一个: { name: "...", birth_year: 1756, famous_works: [...], ... }
```

结构化流式的每个 chunk 不是碎片字符串，而是**逐渐填满的完整对象**。这在需要边生成边更新 UI 的场景很有用。

---

### 选择原则

```
需要结构化输出？
  └── withStructuredOutput(schema)       ← 首选，最简洁
        └── 需要流式？.stream() 同样支持

遇到旧代码 / 特殊场景？
  └── StructuredOutputParser.fromZodSchema()  ← 更多控制
  └── StructuredOutputParser.fromNamesAndDescriptions()  ← 简单字段

需要底层控制（直接透传 API 参数）？
  └── modelKwargs.response_format.json_schema
```

### 补充：XMLOutputParser——不只是 JSON

除了 JSON，模型也可以输出 XML 格式。`XMLOutputParser` 自动把 XML 解析成 JS 对象：

```javascript
import { XMLOutputParser } from '@langchain/core/output_parsers';

const parser = new XMLOutputParser();
const question = `请介绍爱因斯坦。\n${parser.getFormatInstructions()}`;
const response = await model.invoke(question);
const result = await parser.parse(response.content);
```

XML 在某些场景下比 JSON 更稳定——尤其是内容里本身包含大量引号或嵌套结构时。

### 补充：流式工具调用解析

当模型在流式输出中决定调用工具时，工具参数是以 JSON 片段逐步输出的。有两种方式处理：

**方式一：原始 chunk 处理**（`stream-tool-calls-raw.mjs`）

```javascript
const stream = await modelWithTools.stream("现在几点了？");

for await (const chunk of stream) {
  // chunk.tool_call_chunks 包含正在拼接的工具调用参数片段
  if (chunk.tool_call_chunks?.length > 0) {
    console.log('工具调用片段:', chunk.tool_call_chunks[0].args);
    // 输出类似：'{"ex'  →  'pression'  →  '": "1+1"}'
  }
}
```

**方式二：JsonOutputToolsParser 自动解析**（`stream-tool-calls-parser.mjs`）

```javascript
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';

const chain = modelWithTools.pipe(new JsonOutputToolsParser());
const result = await chain.invoke("计算 (2+3)*4");
// result = [{ type: 'calculator', args: { expression: '(2+3)*4' } }]
```

`JsonOutputToolsParser` 帮你把原始的 tool_calls 结构解析成干净的 `{type, args}` 数组，省去手动拼接 JSON 片段的麻烦。

### 补充：zodToJsonSchema——原生 JSON Schema 透传

`withStructuredOutput` 底层帮你把 Zod Schema 转成了 API 的 JSON Schema 格式。如果想完全控制这个过程：

```javascript
import { zodToJsonSchema } from 'zod-to-json-schema';

const nativeJsonSchema = zodToJsonSchema(schema);

const model = new ChatOpenAI({
  modelName: 'qwen-plus',
  modelKwargs: {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scientist_info",
        strict: true,        // 严格模式：输出必须完全匹配 Schema
        schema: nativeJsonSchema,
      },
    },
  },
});

const response = await model.invoke([...messages]);
const result = JSON.parse(response.content); // 模型保证输出合法 JSON
```

**`strict: true`** 是关键——它告诉模型层面强制约束输出格式，而不是靠 Prompt 里的"请以 JSON 格式输出"来暗示。这比 Parser 更可靠，因为是在 API 层面强制的。

### 补充：结构化提取 → 数据库批量写入

来自 `test/smart-import.mjs`，展示了一个完整的实用场景：从非结构化文本中提取数据，直接写入数据库：

```javascript
const schema = z.object({
  people: z.array(z.object({
    name: z.string().describe("姓名"),
    age: z.number().nullable().describe("年龄，未知则为null"),
    occupation: z.string().nullable().describe("职业"),
  })),
});

const structuredModel = model.withStructuredOutput(schema);
const result = await structuredModel.invoke("张三今年25岁，是一名程序员。李四是老师。");
// result = { people: [{ name: "张三", age: 25, occupation: "程序员" }, { name: "李四", age: null, occupation: "老师" }] }

// 直接写入 MySQL
for (const person of result.people) {
  await connection.execute('INSERT INTO people (name, age, occupation) VALUES (?, ?, ?)',
    [person.name, person.age, person.occupation]);
}
```

**`.nullable()`** 是 Zod 的关键——允许模型在信息不确定时返回 null，而不是编造数据。

---

## 四、Runnable 体系（runnable-test）

这一章是 LangChain 设计哲学的核心。

为什么 PromptTemplate、ChatOpenAI、Parser、自定义函数，都可以用 `.pipe()` 串在一起？因为 LangChain 抽象出了 **Runnable 接口**——一个"可被调用的盒子"，有输入输出，支持 `invoke()`、`stream()`、`batch()`。所有组件都实现了这个接口，因此可以自由组合。

---

### RunnableSequence——最基本的顺序链

来自 `runnable.mjs` 的真实代码：

```javascript
import { RunnableSequence } from "@langchain/core/runnables";
import { StructuredOutputParser } from "@langchain/core/output_parsers";

const outputParser = StructuredOutputParser.fromZodSchema(
  z.object({
    translation: z.string().describe("翻译后的英文文本"),
    keywords: z.array(z.string()).length(3).describe("3个关键词"),
  })
);

const promptTemplate = PromptTemplate.fromTemplate(
  '将以下文本翻译成英文，并总结3个关键词。\n\n文本：{text}\n\n{format_instructions}'
);

const chain = RunnableSequence.from([promptTemplate, model, outputParser]);
// 等价于：promptTemplate.pipe(model).pipe(outputParser)

const result = await chain.invoke({
  text: 'LangChain 是一个强大的 AI 应用开发框架',
  format_instructions: outputParser.getFormatInstructions(),
});
// result = { translation: "LangChain is a powerful...", keywords: ["AI", "framework", "development"] }
```

`pipe` 把三个盒子串起来，前一个的输出是后一个的输入。这是 LangChain 最常见的用法。

---

### RunnableLambda——把普通函数变成 Runnable

来自 `RunnableLambda.mjs` 的真实代码：

```javascript
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

const addOne     = RunnableLambda.from((input) => input + 1);
const multiplyTwo = RunnableLambda.from((input) => input * 2);

const chain = RunnableSequence.from([addOne, multiplyTwo, addOne]);

const result = await chain.invoke(5);
// 执行过程：5 → (+1) → 6 → (*2) → 12 → (+1) → 13
console.log(result); // 13
```

这样自定义函数就能无缝插入链的任意位置，和 PromptTemplate、ChatOpenAI 一样对待。

---

### RunnableMap——并行处理

来自 `RunnableMap.mjs`，多个 Runnable 同时接收同一个输入，结果合并成对象：

```javascript
import { RunnableMap, RunnableLambda } from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";

const addOne    = RunnableLambda.from((input) => input.num + 1);
const multiplyTwo = RunnableLambda.from((input) => input.num * 2);
const square    = RunnableLambda.from((input) => input.num * input.num);

const greetTemplate   = PromptTemplate.fromTemplate("你好，{name}！");
const weatherTemplate = PromptTemplate.fromTemplate("今天天气{weather}。");

const runnableMap = RunnableMap.from({
  add: addOne,
  multiply: multiplyTwo,
  square: square,
  greeting: greetTemplate,
  weather: weatherTemplate,
});

const result = await runnableMap.invoke({ name: "神光", weather: "多云", num: 5 });
// result = {
//   add: 6,
//   multiply: 10,
//   square: 25,
//   greeting: StringPromptValue("你好，神光！"),
//   weather: StringPromptValue("今天天气多云。"),
// }
```

五个 Runnable 并行执行，比串行快得多。常用于 RAG 场景：同一个问题同时做向量检索和关键词检索。

---

### RunnablePassthrough——透传并扩展字段

来自 `RunnablePassthrough.mjs`，保留输入的同时计算新字段：

```javascript
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";

const chain = RunnableSequence.from([
  (input) => ({ concept: input }),        // 把字符串包成对象
  RunnablePassthrough.assign({
    original: new RunnablePassthrough(),   // 透传整个 {concept: ...} 对象
    processed: (obj) => ({
      upper: obj.concept.toUpperCase(),
      length: obj.concept.length,
    }),
  }),
]);

const result = await chain.invoke("神说要有光");
// result = {
//   concept: "神说要有光",
//   original: { concept: "神说要有光" },
//   processed: { upper: "神说要有光", length: 7 }
// }
```

RAG 中典型用法：先检索文档（`retriever.invoke(question)`），然后用 `RunnablePassthrough.assign` 把文档和原始问题合并，一起传给模型。

---

### RunnableBranch——条件路由

来自 `RunnableBranch.mjs`：

```javascript
import { RunnableBranch, RunnableLambda } from "@langchain/core/runnables";

const branch = RunnableBranch.from([
  [RunnableLambda.from((n) => n > 0),      RunnableLambda.from((n) => `正数: ${n} + 10 = ${n + 10}`)],
  [RunnableLambda.from((n) => n < 0),      RunnableLambda.from((n) => `负数: ${n} - 10 = ${n - 10}`)],
  [RunnableLambda.from((n) => n % 2 === 0), RunnableLambda.from((n) => `偶数: ${n} * 2 = ${n * 2}`)],
  RunnableLambda.from((n) => `默认: ${n}`), // 最后一个无条件，是兜底
]);

// 测试
console.log(await branch.invoke(5));  // "正数: 5 + 10 = 15"  （第一条件命中，后面不再检查）
console.log(await branch.invoke(-3)); // "负数: -3 - 10 = -13"
console.log(await branch.invoke(0));  // "偶数: 0 * 2 = 0"    （前两条不满足，第三条满足）
```

按顺序检查条件，第一个为 true 的分支执行，其余跳过（**短路求值**）。最后没有条件的元素是默认兜底。

---

### withRetry 和 withFallbacks——容错机制

来自真实代码的场景（`RunnableWithRetry.mjs` 和 `RunnableWithFallbacks.mjs`）：

```javascript
// withRetry：同一个操作失败后自动重试（模拟 70% 失败率的不稳定接口）
let attempt = 0;
const unstableRunnable = RunnableLambda.from(async (input) => {
  attempt += 1;
  if (Math.random() < 0.7) throw new Error("模拟的随机错误");
  return `成功处理: ${input}`;
});

const withRetry = unstableRunnable.withRetry({ stopAfterAttempt: 5 });
const result = await withRetry.invoke("演示");
// 在 5 次以内，只要有一次成功就返回，全失败则 throw

// withFallbacks：主方案失败，切换备选（模拟服务降级）
const premiumTranslator  = RunnableLambda.from(async (text) => {
  throw new Error("Premium 服务超时"); // 主服务挂了
});
const standardTranslator = RunnableLambda.from(async (text) => {
  return "xxx"; // 标准服务可用
});
const localTranslator    = RunnableLambda.from(async (text) => {
  return text.split(" ").map(w => dict[w] ?? w).join(""); // 本地兜底
});

const translator = premiumTranslator.withFallbacks({
  fallbacks: [standardTranslator, localTranslator],
});
// 尝试顺序：premium → standard（成功，返回"xxx"，不再尝试 local）
```

**Retry vs Fallback** 的本质区别：Retry 重复同一件事（适合临时故障），Fallback 换一件事（适合服务降级）。实际项目通常结合：先对主方案重试 2 次，都失败了再切换备选。

---

### RunnablePick——只取你要的字段

来自 `RunnablePick.mjs`，当上游 Runnable 输出了一个大对象，但下游只需要其中几个字段：

```javascript
import { RunnablePick } from "@langchain/core/runnables";

const pick = new RunnablePick(["name", "score"]);
const result = await pick.invoke({ name: "张三", age: 25, score: 98, address: "..." });
// result = { name: "张三", score: 98 }
```

常用于 RAG 场景：检索返回了文档、分数、元数据，但下游 Prompt 只需要文档内容。

---

### RunnableEach——对数组每个元素执行链

来自 `RunnableEach.mjs`，把一个 Runnable 应用到数组的每个元素上：

```javascript
import { RunnableEach, RunnableLambda } from "@langchain/core/runnables";

const processItem = RunnableLambda.from((name) => `Hello, ${name}!`);
const chain = new RunnableEach({ bound: processItem });

const results = await chain.invoke(["Alice", "Bob", "Carol"]);
// results = ["Hello, Alice!", "Hello, Bob!", "Hello, Carol!"]
```

比手动写 `Promise.all(items.map(item => chain.invoke(item)))` 更语义化，而且自动处理并发。

---

### RouterRunnable——按 key 动态路由

来自 `RouterRunnable.mjs`，根据输入的 `key` 字段选择不同的处理链：

```javascript
import { RouterRunnable, RunnableLambda } from "@langchain/core/runnables";

const toUpperCase = RunnableLambda.from((input) => input.toUpperCase());
const reverseText = RunnableLambda.from((input) => input.split("").reverse().join(""));

const router = new RouterRunnable({
  runnables: { toUpperCase, reverseText },
});

await router.invoke({ key: "reverseText", input: "Hello" });
// → "olleH"
await router.invoke({ key: "toUpperCase", input: "Hello" });
// → "HELLO"
```

比 `RunnableBranch` 更适合**多路由场景**——Branch 是按条件逐个检查（if-else），Router 是按名字直接查找（switch-case），性能更好。

---

### RunnableWithConfig——给链绑定配置

来自 `RunnableWithConfig.mjs`，在 Runnable 执行时传入配置参数，所有节点都能访问：

```javascript
const chain = RunnableLambda.from(async (input, config) => {
  const userId = config?.configurable?.userId;
  const locale = config?.configurable?.locale;
  return `用户 ${userId}（${locale}）查询：${input}`;
});

const configuredChain = chain.withConfig({
  configurable: { userId: "user-123", locale: "zh-CN" },
});

await configuredChain.invoke("最近的订单");
// → "用户 user-123（zh-CN）查询：最近的订单"
```

**`configurable`** 是透传给链中所有节点的上下文信息。常用于多租户场景——同一条链，不同用户调用时传不同的 config（用户 ID、语言偏好、权限等级）。

---

### RunnableWithCallbacks——观测每一步

来自 `RunnableWithCallbacks.mjs`，构建一个文本处理链：清洗 → 分词 → 统计，用 callback 观测每步：

```javascript
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

const clean    = RunnableLambda.from((text) => text.trim().replace(/\s+/g, " "));
const tokenize = RunnableLambda.from((text) => text.split(" "));
const count    = RunnableLambda.from((tokens) => ({ tokens, wordCount: tokens.length }));

const chain = RunnableSequence.from([clean, tokenize, count]);

const callback = {
  handleChainStart(chain) {
    const step = chain?.id?.[chain.id.length - 1] ?? "unknown";
    console.log(`[START] ${step}`);
  },
  handleChainEnd(output) {
    console.log(`[END]   output=${JSON.stringify(output)}\n`);
  },
  handleChainError(err) {
    console.log(`[ERROR] ${err.message}\n`);
  },
};

const result = await chain.invoke("  hello   world   from   langchain  ", {
  callbacks: [callback],
});
// 输出：
// [START] clean
// [END]   output="hello world from langchain"
//
// [START] tokenize
// [END]   output=["hello","world","from","langchain"]
//
// [START] count
// [END]   output={"tokens":["hello","world","from","langchain"],"wordCount":4}
```

`chain.id` 是一个数组，最后一个元素是当前节点名称（`clean`、`tokenize`、`count`）。生产环境里把 callback 接到日志系统，可以追踪整个链路每步的耗时和输出。

---

### RunnableWithMessageHistory——自动管理多轮对话历史

来自 `RunnableWithMessageHistory.mjs` 的真实案例：

```javascript
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一个简洁、有帮助的中文助手，会用1-2句话回答用户问题。"],
  new MessagesPlaceholder("history"),
  ["human", "{question}"],
]);

const simpleChain = prompt.pipe(model).pipe(new StringOutputParser());

const messageHistories = new Map();

const chain = new RunnableWithMessageHistory({
  runnable: simpleChain,
  getMessageHistory: (sessionId) => {
    if (!messageHistories.has(sessionId))
      messageHistories.set(sessionId, new InMemoryChatMessageHistory());
    return messageHistories.get(sessionId);
  },
  inputMessagesKey: "question",
  historyMessagesKey: "history",
});

// 第 1 轮
const r1 = await chain.invoke(
  { question: "我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。" },
  { configurable: { sessionId: "user-123" } }
);
console.log(r1); // "很高兴认识你，神光！..."

// 第 2 轮——自动注入了第 1 轮的历史
const r2 = await chain.invoke(
  { question: "我刚才说我来自哪里？" },
  { configurable: { sessionId: "user-123" } }
);
console.log(r2); // "你说你来自山东。"

// 第 3 轮
const r3 = await chain.invoke(
  { question: "我的爱好是什么？" },
  { configurable: { sessionId: "user-123" } }
);
console.log(r3); // "你的爱好是编程、写作和金铲铲。"
```

每次调用自动：取出历史 → 注入 `{history}` → 执行链 → **把新一轮的问答自动追加到历史**。`sessionId` 区分不同用户的对话，不同 sessionId 的历史互不干扰。

---

## 五、RAG 文档处理（rag-test）

RAG（Retrieval-Augmented Generation）解决的是"大模型不知道你私有文档"的问题。

### 流程

```
建库：文档 → 加载 → 切割 → 向量化 → 存入向量库
查询：问题 → 向量化 → 相似度检索 → 相关片段 + 问题 → 模型生成回答
```

### 加载文档——不只是手动构造 Document

除了手动 `new Document()`，还可以用 **Loader** 从网页直接加载：

```javascript
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

const loader = new CheerioWebBaseLoader("https://juejin.cn/post/xxx", {
  selector: "article",  // CSS 选择器，只提取文章正文
});
const docs = await loader.load(); // 返回 Document[]，pageContent 是提取的文本
```

`CheerioWebBaseLoader` 底层用 `cheerio`（服务端 jQuery）解析 HTML，`selector` 参数精确控制提取哪部分内容，避免把导航栏、广告等噪音也加载进来。

### 手动构造 Document

```javascript
import { Document } from "@langchain/core/documents";

// 来自 hello-rag.mjs 的真实数据——一个关于光光和东东的故事
const documents = [
  new Document({
    pageContent: `光光是一个活泼开朗的小男孩，他有一双明亮的大眼睛，总是带着灿烂的笑容。
光光最喜欢的事情就是和朋友们一起玩耍，他特别擅长踢足球...`,
    metadata: {
      chapter: 1,
      character: "光光",
      type: "角色介绍",
      mood: "活泼",
    },
  }),
  // ...更多章节
];
```

`metadata` 很重要——检索到片段后，你需要知道它来自哪个章节，是什么角色，什么类型的内容。这些元数据可以用来过滤（只搜第 3 章的内容）或者在回答里引用。

### 切割文档

文档不能直接整篇存——太长的话单次向量化效果差，检索也不精确。要切割成合适的 chunk。

来自 `RecursiveCharacterTextSplitter-test.mjs` 的真实案例：

```javascript
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 150,
  chunkOverlap: 20,
  separators: ['\n', '。', '，'],     // 优先从这些位置断开
  // lengthFunction: (text) => enc.encode(text).length, // 改成按 token 数而非字符数
});

const splitDocuments = await splitter.splitDocuments([logDocument]);

splitDocuments.forEach(doc => {
  console.log('字符长度:', doc.pageContent.length);
  console.log('token 长度:', enc.encode(doc.pageContent).length); // 两者可能相差很大
});
```

**递归分割的原理**：先用第一个分隔符（`\n` 换行）切，切出来的块如果还太长，就用第二个（`。`句号）再切……直到所有块都不超过 `chunkSize`。这样既尊重语义边界，又保证了大小。

`chunkOverlap` 解决边界信息丢失：相邻块之间有 20 个字符的重叠，防止一句话被切在中间导致两块都缺失关键信息。

**字符长度 vs Token 长度的差异**：

```
"apple"         → 5 字符,  1 token
"苹果"           → 2 字符,  2 tokens
"一二三"         → 3 字符,  3 tokens
```

中文字符比英文用更多 token。如果你的文档是中文，按字符数设置 `chunkSize` 可能会低估实际的 token 消耗。用 `lengthFunction: (text) => enc.encode(text).length` 改成按 token 计数更准确。

### 补充：其他切割器——不同文档类型用不同策略

`RecursiveCharacterTextSplitter` 是通用方案，但针对特定文档类型有更好的选择：

**CharacterTextSplitter——最简单的单分隔符切割**

```javascript
import { CharacterTextSplitter } from "@langchain/textsplitters";

const splitter = new CharacterTextSplitter({
  separator: '\n',      // 只用一个分隔符（不递归）
  chunkSize: 200,
  chunkOverlap: 20,
});
```

适合结构整齐的内容（日志、CSV 风格文本），每行都是独立的记录。

**TokenTextSplitter——直接按 Token 切割**

```javascript
import { TokenTextSplitter } from "@langchain/textsplitters";

const splitter = new TokenTextSplitter({
  chunkSize: 50,           // 每块 50 个 token
  chunkOverlap: 10,        // 重叠 10 个 token
  encodingName: 'cl100k_base',  // 指定 tokenizer
});
```

不需要自定义 `lengthFunction`，天然按 token 计数。当你需要精确控制每块的 token 消耗时用这个。

**MarkdownTextSplitter——尊重 Markdown 标题层级**

```javascript
import { MarkdownTextSplitter } from "@langchain/textsplitters";

const splitter = new MarkdownTextSplitter({ chunkSize: 400, chunkOverlap: 80 });
```

会优先在 `#`、`##`、`###` 标题处断开，保证一个 chunk 不会跨越标题边界。处理技术文档、README 时效果比通用切割器好很多。

**RecursiveCharacterTextSplitter.fromLanguage——代码专用**

```javascript
const splitter = RecursiveCharacterTextSplitter.fromLanguage('js', {
  chunkSize: 1000,
  chunkOverlap: 200,
});
```

`fromLanguage('js')` 会自动使用 JavaScript 语法感知的分隔符（函数边界、类边界等），不会把一个函数切成两半。支持 `'js'`、`'python'`、`'go'`、`'java'` 等语言。

**LatexTextSplitter——LaTeX 公式完整性**

```javascript
import { LatexTextSplitter } from "@langchain/textsplitters";

const splitter = new LatexTextSplitter({ chunkSize: 200, chunkOverlap: 40 });
```

理解 `\begin{...}...\end{...}` 结构，不会把数学公式或矩阵切断。处理学术论文时必须用。

### 向量化与检索

来自 `hello-rag.mjs` 的完整 RAG 流程：

```javascript
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";

const embeddings = new OpenAIEmbeddings({
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

// 向量化所有文档，存入内存向量库
const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);

// 检索（带相似度分数）
const question = "东东和光光是怎么成为朋友的？";
const scoredResults = await vectorStore.similaritySearchWithScore(question, 3);

scoredResults.forEach(([doc, score], i) => {
  // score 是余弦距离（越小越相似），相似度 = 1 - score
  const similarity = (1 - score).toFixed(4);
  console.log(`[文档 ${i + 1}] 相似度: ${similarity}`);
  console.log(`章节=${doc.metadata.chapter}, 类型=${doc.metadata.type}`);
  console.log(`内容: ${doc.pageContent.slice(0, 60)}...`);
});

// 构建 Prompt，把检索到的内容作为上下文
const context = scoredResults
  .map(([doc], i) => `[片段${i + 1}]\n${doc.pageContent}`)
  .join("\n\n━━━━━\n\n");

const prompt = `你是一个讲友情故事的老师。基于以下故事片段回答问题。

故事片段:
${context}

问题: ${question}

老师的回答:`;

const response = await model.invoke(prompt);
console.log(response.content);
```

**相似度分数的理解**：`similaritySearchWithScore` 返回的 score 是余弦距离（0 最近，2 最远），用 `1 - score` 转换成相似度（1 最相似，-1 最不相似）。实际上文本语义相关的内容，相似度通常在 0.7 以上。

### 补充：Retriever 接口——更简洁的检索方式

`similaritySearchWithScore` 返回文档和分数，适合需要精确控制的场景。如果只需要拿到最相关的文档，`asRetriever()` 更简洁：

```javascript
const retriever = vectorStore.asRetriever({ k: 3 }); // 返回 top 3

const docs = await retriever.invoke("东东和光光怎么认识的？");
// docs = [Document, Document, Document]，没有分数，只有文档

const context = docs.map(d => d.pageContent).join("\n---\n");
```

`retriever.invoke()` 返回的是纯 `Document[]`（无分数），可以直接 `.pipe()` 进 LangChain 的链中——这就是为什么 Retriever 是 Runnable 接口的一部分。

---

## 六、对话记忆（memory-test）

大模型本身是无状态的——你每次调用它，它都不记得上次说了什么。解决这个问题是 Agent 开发的基础需求。

### 先看最简单的情况

```javascript
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 来自 history-test.mjs：一个做菜助手的对话
const history = new InMemoryChatMessageHistory();
const systemMessage = new SystemMessage("你是一个友好、幽默的做菜助手，喜欢分享美食和烹饪技巧。");

// 第 1 轮
const userMessage1 = new HumanMessage("你今天吃的什么？");
await history.addMessage(userMessage1);

const messages1 = [systemMessage, ...(await history.getMessages())];
const response1 = await model.invoke(messages1);
await history.addMessage(response1); // 把 AI 的回复也存进去

// 第 2 轮："好吃吗？" 模型能理解是在问第 1 轮说的食物
const userMessage2 = new HumanMessage("好吃吗？");
await history.addMessage(userMessage2);

const messages2 = [systemMessage, ...(await history.getMessages())];
const response2 = await model.invoke(messages2);
```

关键点：每次调用都把 `[systemMessage, ...historyMessages]` 全部传进去，模型才能"记住"。history 里存了多少条，模型就能看到多少历史。

这会带来一个问题：**消息越来越多，Token 越来越多**，成本上涨，最终超出上下文窗口限制。这就是为什么需要记忆管理策略。

---

### 策略一：截断（Truncation）

来自 `truncation-memory.mjs`，最直接的思路——只保留最近的部分。

**按消息数量截断（最简单）：**

```javascript
const maxMessages = 4;
const allMessages = await history.getMessages();
const trimmed = allMessages.slice(-maxMessages); // 只保留最后 4 条
```

**按 Token 数截断（更精确，来自真实代码）：**

```javascript
import { trimMessages } from "@langchain/core/messages";
import { getEncoding } from "js-tiktoken";

function countTokens(messages, encoder) {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    total += encoder.encode(content).length;
  }
  return total;
}

const enc = getEncoding("cl100k_base"); // GPT-4 兼容的 tokenizer
const maxTokens = 100;

const trimmed = await trimMessages(allMessages, {
  maxTokens,
  tokenCounter: async (msgs) => countTokens(msgs, enc),
  strategy: "last", // 保留最新的消息
});

// 查看实际使用了多少 token
const totalTokens = countTokens(trimmed, enc);
console.log(`总 token 数: ${totalTokens}/${maxTokens}`);
console.log(`保留消息数量: ${trimmed.length}`);
```

**为什么 Token 比消息数更准确？**

一条消息可能是 5 个字（3 tokens），也可能是 500 个字（300 tokens）。按数量截断可能导致 Token 预算严重超支或浪费。按 Token 才是真正精确的控制。

---

### 策略二：摘要（Summarization）

来自 `summarization-memory.mjs`，不丢信息，把旧消息压缩成摘要：

```javascript
import { getBufferString } from "@langchain/core/messages";

const maxMessages = 6; // 超过 6 条时触发摘要
const keepRecent = 2;  // 保留最近 2 条不摘要

async function summarizeHistory(messages) {
  // getBufferString 把消息格式化为 "用户: xxx\n助手: yyy" 的文本
  const conversationText = getBufferString(messages, {
    humanPrefix: "用户",
    aiPrefix: "助手",
  });

  const response = await model.invoke([
    new SystemMessage(`请总结以下对话的核心内容，保留重要信息：\n\n${conversationText}\n\n总结：`),
  ]);
  return response.content;
}

// 当消息数量超过阈值时
const allMessages = await history.getMessages();
if (allMessages.length >= maxMessages) {
  const recentMessages = allMessages.slice(-keepRecent);
  const messagesToSummarize = allMessages.slice(0, -keepRecent);

  console.log(`将被总结的消息数量: ${messagesToSummarize.length}`);
  console.log(`将被保留的消息数量: ${recentMessages.length}`);

  const summary = await summarizeHistory(messagesToSummarize);

  // 清空历史，只保留最近几条
  await history.clear();
  for (const msg of recentMessages) {
    await history.addMessage(msg);
  }

  // summary 作为 SystemMessage 注入下次对话
  console.log(`摘要内容: ${summary}`);
}
```

真实的对话例子（做红烧肉的教学对话，10 条消息，6 条被摘要，2 条保留）。摘要策略让对话可以无限长，模型始终知道"之前大致发生了什么"，只是细节会有损失。

**进阶版：按 Token 数触发摘要**（来自 `summarization-memory2.mjs`）

上面按消息数量触发摘要比较粗糙。生产环境应该按 Token 数控制：

```javascript
const enc = getEncoding("cl100k_base");
const maxTokens = 200;       // 总 token 预算
const keepRecentTokens = 80; // 保留最近消息的 token 预算

const allMessages = await history.getMessages();
const totalTokens = countTokens(allMessages, enc);

if (totalTokens > maxTokens) {
  // 从后往前累计，找到 keepRecentTokens 预算内的消息
  let recentTokens = 0;
  let splitIndex = allMessages.length;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msgTokens = enc.encode(allMessages[i].content).length;
    if (recentTokens + msgTokens > keepRecentTokens) break;
    recentTokens += msgTokens;
    splitIndex = i;
  }

  const messagesToSummarize = allMessages.slice(0, splitIndex);
  const recentMessages = allMessages.slice(splitIndex);

  const summary = await summarizeHistory(messagesToSummarize);
  // ... 同上：清空历史，保留 recent，summary 注入 SystemMessage
}
```

**为什么比按消息数更好？** 一条消息可能 3 个 token，也可能 300 个 token。按消息数保留 2 条，可能保留了 6 个 token（太少）或 600 个 token（超预算）。按 token 预算精确控制，才能最大化利用上下文窗口。

---

### 补充：FileSystemChatMessageHistory——对话持久化到文件

`InMemoryChatMessageHistory` 进程重启就丢了。`FileSystemChatMessageHistory` 把对话保存到 JSON 文件：

```javascript
import { FileSystemChatMessageHistory } from "@langchain/community/stores/message/file_system";

// history-test2.mjs — 创建持久化历史
const history = new FileSystemChatMessageHistory({
  sessionId: "user-001",
  dir: "./chat_history",  // 保存到 ./chat_history/user-001.json
});

await history.addMessage(new HumanMessage("你好"));
const aiResponse = await model.invoke([...]);
await history.addMessage(aiResponse);

// history-test3.mjs — 下次启动恢复历史
const restoredHistory = new FileSystemChatMessageHistory({
  sessionId: "user-001",
  dir: "./chat_history",
});

const messages = await restoredHistory.getMessages();
// messages 包含上次保存的所有消息，可以继续对话
```

`sessionId` 对应一个 JSON 文件。不同 sessionId 的历史互不干扰。这是从"玩具"到"可用"的关键一步——虽然生产环境会用数据库，但文件存储足够做开发测试。

---

### 策略三：检索（Retrieval Memory）

来自 `retrieval-memory.mjs`，不按时间顺序，按语义相关性检索历史：

```javascript
// 存入历史（每轮对话向量化存入 Milvus）
async function saveConversation(content, round) {
  const vector = await embeddings.embedQuery(content);
  await milvusClient.insert({
    collection_name: "conversations",
    data: [{ id: `conv_${round}`, vector, content, round, timestamp: new Date().toISOString() }],
  });
}

// 检索相关历史
async function retrieveRelevantConversations(query, k = 2) {
  const queryVector = await embeddings.embedQuery(query);
  const results = await milvusClient.search({
    collection_name: "conversations",
    vector: queryVector,
    limit: k,
    metric_type: MetricType.COSINE,
    output_fields: ["content", "round", "timestamp"],
  });
  return results.results; // 带相似度分数
}

// 使用：检索相关历史注入 Prompt
const relevant = await retrieveRelevantConversations("最近做了什么让你快乐的事？");
const context = relevant.map(r => r.content).join("\n---\n");

const response = await model.invoke([
  new SystemMessage(`参考以下相关历史对话作为背景：\n${context}`),
  new HumanMessage(query),
]);

// 保存本轮对话
await saveConversation(`用户: ${query}\nAI: ${response.content}`, nextRound);
```

优势：即使是一个月前的对话，只要语义相关就能被找到，不受时间顺序限制。本质是把 RAG 用在了对话历史上。

---

### 三种策略对比

| 维度 | 截断 | 摘要 | 检索 |
| --- | --- | --- | --- |
| 信息保留 | 差（旧信息直接丢失） | 中（细节丢失，语义保留） | 好（按需精准召回） |
| 实现复杂度 | 低 | 中（需要额外 LLM 调用） | 高（需要向量数据库） |
| 额外延迟 | 无 | 有（摘要生成耗时） | 有（向量搜索耗时） |
| 适合场景 | 短对话、简单客服 | 长对话、闲聊机器人 | 知识密集型、专业场景 |

---

## 七、向量数据库 Milvus（milvus-test）

`MemoryVectorStore` 是玩具——数据存在内存里，重启就丢。生产环境需要 Milvus 这样的持久化向量数据库。

### 建表与索引

```javascript
import { MilvusClient, DataType, IndexType, MetricType } from "@zilliz/milvus2-sdk-node";

const client = new MilvusClient({ address: "localhost:19530" });

await client.createCollection({
  collection_name: "ai_diary",
  fields: [
    { name: "id",      data_type: DataType.VarChar, max_length: 50, is_primary_key: true },
    { name: "vector",  data_type: DataType.FloatVector, dim: 1024 }, // dim 必须和 Embedding 模型一致
    { name: "content", data_type: DataType.VarChar, max_length: 5000 },
    { name: "mood",    data_type: DataType.VarChar, max_length: 50 },
    { name: "tags",    data_type: DataType.Array, element_type: DataType.VarChar, max_capacity: 10, max_length: 50 },
  ],
});

await client.createIndex({
  collection_name: "ai_diary",
  field_name: "vector",
  index_type: IndexType.IVF_FLAT, // 倒排文件 + 平坦搜索，速度与精度的平衡点
  metric_type: MetricType.COSINE,  // 余弦相似度，适合语义匹配
  params: { nlist: 1024 },         // 聚类数量，越大精度越高但建索引越慢
});

await client.loadCollection({ collection_name: "ai_diary" }); // 加载到内存才能搜索
```

`dim: 1024` 必须和你用的 Embedding 模型输出维度一致。如果用 `text-embedding-v3`（1024 维），这里必须是 1024；换 OpenAI 的 `text-embedding-3-small`（1536 维），就必须改成 1536。两者不能混用。

### CRUD 操作

```javascript
// 插入
await client.insert({
  collection_name: "ai_diary",
  data: [{
    id: "diary_001",
    vector: await embeddings.embedQuery("今天去公园散步，看到了美丽的樱花"),
    content: "今天天气很好，去公园散步了，心情不错。",
    mood: "happy",
    tags: ["散步", "樱花", "春天"],
  }],
});

// 相似度搜索
const results = await client.search({
  collection_name: "ai_diary",
  vector: await embeddings.embedQuery("最近做了什么让我感到快乐的事情？"),
  limit: 3,
  metric_type: MetricType.COSINE,
  output_fields: ["content", "mood", "tags"],
});

// 条件更新（upsert = 存在则更新，不存在则插入）
await client.upsert({
  collection_name: "ai_diary",
  data: [{ id: "diary_001", vector: newVector, content: "更新后的内容", mood: "sad" }],
});

// 条件删除
await client.delete({ collection_name: "ai_diary", filter: 'mood == "sad"' });
await client.delete({ collection_name: "ai_diary", filter: 'id in ["diary_002", "diary_003"]' });
```

### 电子书 RAG 实战（天龙八部）

```javascript
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";

const loader = new EPubLoader("天龙八部.epub", { splitChapters: true });
const docs = await loader.load(); // 每章是一个 Document

for (const [chapterIdx, doc] of docs.entries()) {
  const chunks = await splitter.splitText(doc.pageContent);
  for (const [chunkIdx, chunk] of chunks.entries()) {
    const vector = await embeddings.embedQuery(chunk);
    await client.insert({
      collection_name: "ebook_collection",
      data: [{
        id: `tlbb_ch${chapterIdx}_${chunkIdx}`, // ID 编码了来源信息
        vector,
        content: chunk,
        chapter_num: chapterIdx,
      }],
    });
  }
}

// 问答
async function answerQuestion(question) {
  const queryVector = await embeddings.embedQuery(question);
  const results = await client.search({
    collection_name: "ebook_collection",
    vector: queryVector,
    limit: 3,
    output_fields: ["content", "chapter_num"],
  });

  const context = results.results.map(r => r.content).join("\n---\n");
  return await model.invoke([
    new SystemMessage(`你是天龙八部小说专家，根据以下原文回答问题：\n${context}`),
    new HumanMessage(question),
  ]);
}

await answerQuestion("鸠摩智会什么武功？");
```

---

## 八、综合 Agent 编排（cron-job-tool）

这一章把前面所有概念整合进一个真实的 NestJS 服务。

### System Prompt 工程——如何约束复杂工具行为

cron-job-tool 里最有价值的不是代码架构，而是 `ai.service.ts` 里的 **System Prompt 设计**。看看它如何通过精确的 Prompt 约束模型对 `cron_job` 工具的使用：

```typescript
new SystemMessage(`你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具...

定时任务类型选择规则（非常重要）：
- 用户说"X分钟/小时/天后""在某个时间点""到点提醒"（一次性）
  => 用 cron_job + type=at（执行一次后自动停用）
  => at = 当前时间 + X 或解析出的时间点

- 用户说"每X分钟/每小时/每天""定期/循环/一直"（重复执行）
  => 用 cron_job + type=every
  => everyMs = X 换算成毫秒

- 用户给出 Cron 表达式（重复执行）
  => 用 cron_job + type=cron

在调用 cron_job.add 时，需要把用户语言拆成两部分：
"什么时候执行"（决定 type/at/everyMs/cron）
"要做什么任务"（写入 instruction）

instruction 字段只能填"要做什么"的文本，不能改写或翻译。

当用户请求"在未来某个时间点执行某个动作"（例如"1分钟后给我发一个笑话到邮箱"）时：
本轮只使用 cron_job 设置定时任务，不要直接调用 send_mail！
要执行的动作写进 instruction，交给将来的定时任务去跑。

重要：instruction 必须是自然语言任务描述，
禁止写成工具调用（例如禁止 send_mail(...) / web_search(...)）。
`)
```

这个 System Prompt 解决了几个真实问题：

- 模型经常搞混"一次性定时"和"循环定时"，通过明确的语言模式（"X分钟后" vs "每X分钟"）引导它选正确的 `type`
- 模型可能在"设置定时任务"的同时"立即执行任务"，通过明确禁止当前轮调用 `send_mail` 来避免
- 模型可能把 `instruction` 写成伪代码（`send_mail("...")`），通过明确禁止并解释原因来规避

**这是 Prompt 工程的典型应用**：复杂工具的约束规则、决策树、边界情况，都用自然语言精确描述，是让 Agent 稳定工作的关键。

### 流式 Agent 循环——如何判断"是在推理还是在调工具"

核心逻辑来自 `runChainStream`：

```typescript
async *runChainStream(query: string): AsyncIterable<string> {
  const messages: BaseMessage[] = [systemMessage, new HumanMessage(query)];

  while (true) {
    const stream = await this.modelWithTools.stream(messages);
    let fullAIMessage: AIMessageChunk | null = null;

    for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
      // 拼接所有 chunk，构建完整的 AIMessage
      fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

      // 关键判断：tool_call_chunks 出现，说明模型正在生成工具调用参数
      const isToolCalling = (fullAIMessage.tool_call_chunks?.length ?? 0) > 0;

      // 只有确定不是工具调用时，才把文本输出给用户
      if (!isToolCalling && chunk.content) {
        yield chunk.content as string;
      }
    }

    messages.push(fullAIMessage);
    const toolCalls = fullAIMessage.tool_calls ?? [];

    if (!toolCalls.length) return; // 没有工具调用，本轮就是最终回答，已流完

    // 有工具调用：执行工具，把结果加入历史，进入下一轮
    for (const toolCall of toolCalls) {
      const result = await this.executeTool(toolCall);
      messages.push(new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content: result }));
    }
    // 继续循环，模型将基于工具结果继续推理
  }
}
```

**为什么要检测 `tool_call_chunks`？**

当模型决定调用工具时，它输出的不是文字内容，而是工具调用参数（JSON 格式）。这些 chunk 的 `content` 字段是空的，但 `tool_call_chunks` 不为空。如果你不做判断，直接 yield `chunk.content`，用户会看到空字符串或者工具参数的 JSON 片段——这不是我们想要的。

### 定时任务系统的三种类型

来自 `job.service.ts` 的真实实现：

```typescript
// 类型一：Cron 表达式（循环执行，如 "*/5 * * * * *" 每5秒一次）
const cronJob = new CronJob(job.cron, async () => {
  await this.entityManager.update(Job, job.id, { lastRun: new Date() });
  const result = await this.jobAgentService.runJob(job.instruction);
});
this.schedulerRegistry.addCronJob(job.id, cronJob);
cronJob.start();

// 类型二：固定间隔（循环执行，如 60000 = 每分钟）
const ref = setInterval(async () => {
  await this.entityManager.update(Job, job.id, { lastRun: new Date() });
  await this.jobAgentService.runJob(job.instruction);
}, job.everyMs);
this.schedulerRegistry.addInterval(job.id, ref);

// 类型三：指定时间点（一次性执行，执行后自动停用）
const delay = Math.max(0, job.at.getTime() - Date.now());
const ref = setTimeout(async () => {
  await this.entityManager.update(Job, job.id, {
    lastRun: new Date(),
    isEnabled: false, // 关键：at 类型执行完自动禁用
  });
  await this.jobAgentService.runJob(job.instruction);
  this.schedulerRegistry.deleteTimeout(job.id);
}, delay);
```

`JobAgentService`（执行任务的 Agent）和 `AiService`（主 Agent）绑定的工具不一样——主 Agent 有 6 个工具（包括 `cron_job` 和 `query_user`），`JobAgentService` 只有 4 个工具（`send_mail`、`web_search`、`db_users_crud`、`time_now`），**刻意不包含 `cron_job`**，防止定时任务在执行过程中修改自身的调度设置。

### 补充：AiController——同时暴露 REST 和 SSE 端点

```typescript
// ai.controller.ts
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // 非流式：等模型全部生成完再返回 JSON
  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  // 流式 SSE：实时推送每个 chunk
  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      (async () => {
        for await (const chunk of this.aiService.runChainStream(query)) {
          subscriber.next({ data: chunk } as MessageEvent);
        }
        subscriber.complete();
      })();
    });
  }
}
```

**REST vs SSE 的选择**：如果客户端是 curl 或服务端调用，用 REST；如果客户端是浏览器要实时展示生成过程，用 SSE。

### 补充：前端 EventSource 消费 SSE

来自 `public/ai-sse-test.html`，展示了浏览器端如何消费 SSE 流：

```javascript
const query = encodeURIComponent(inputText);
const eventSource = new EventSource(`/ai/chat/stream?query=${query}`);

eventSource.onmessage = (event) => {
  outputDiv.textContent += event.data;  // 每收到一个 chunk 追加显示
};

eventSource.onerror = () => {
  eventSource.close();  // 必须手动关闭，否则浏览器会自动重连
};
```

**`EventSource` 注意事项**：
- 浏览器会在连接断开后自动重连——必须在 `onerror` 里调用 `close()` 阻止
- 只支持 GET 请求——如果需要 POST，用 `fetch()` 手动读 ReadableStream
- 每个 event 的 `data` 字段对应服务端 `{ data: chunk }` 里的 chunk

### 补充：DTO 验证装饰器

来自 `users/dto/create-user.dto.ts`，NestJS 用 `class-validator` 装饰器做入参校验：

```typescript
import { IsNotEmpty, MaxLength, IsEmail } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()    // 不能为空
  @MaxLength(50)   // 最长 50 字符
  name: string;

  @IsEmail()       // 必须是合法邮箱格式
  @MaxLength(50)
  email: string;
}

// UpdateUserDto 继承 CreateUserDto，但所有字段变为可选
export class UpdateUserDto extends PartialType(CreateUserDto) {}
```

`PartialType()` 把 `CreateUserDto` 的所有字段标记为 `optional`，这样 PATCH 请求只需要传想更新的字段。这是 NestJS 的标准 CRUD DTO 模式。

---

## 九、语音服务（tts-stt-test）

### TTS：文字转语音

**非流式版本**——整段文字一次性合成，适合短文本：

```javascript
const result = await ttsClient.TextToVoice({
  Text: "你好，世界",
  VoiceType: 502006, // 音色 ID（不同 ID 对应不同音色）
  Codec: "mp3",
  SessionId: "session-001",
});
const audioBuffer = Buffer.from(result.Audio, "base64");
fs.writeFileSync("output.mp3", audioBuffer);
```

**流式版本**——WebSocket 实时传输，适合长文本：

```javascript
// 1. 构建带 HMAC-SHA1 签名的 WebSocket URL
// 2. 等服务器发 { ready: 1 } 再开始发送文本
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    writeStream.write(data);  // 音频二进制数据，边收边写文件
  } else {
    const msg = JSON.parse(data);
    if (msg.ready === 1) {
      // 可以开始发文本了
      ws.send(JSON.stringify({ action: "ACTION_SYNTHESIS", data: "第一段文字..." }));
    }
    if (msg.final === 1) {
      writeStream.end(); // 合成完毕
    }
  }
});
```

### ASR：语音转文字

```javascript
const audioBase64 = fs.readFileSync("input.mp3").toString("base64");
const result = await asrClient.SentenceRecognition({
  EngSerViceType: "16k_zh",  // 16kHz 中文识别
  SourceType: 1,
  Data: audioBase64,
  DataLen: audioBuffer.length,
  VoiceFormat: "mp3",
});
console.log(result.Result); // 识别出的文字
```

---

## 十、全栈语音集成（asr-and-tts-nest-service）

将 AI 对话与语音打通成完整流水线：**用户说话 → 识别 → AI 回答 → 合成语音播放**。

### EventEmitter 解耦 AI 和 TTS

AI 服务和 TTS 服务完全独立，通过 EventEmitter 连接：

```typescript
// 事件定义
export const AI_TTS_STREAM_EVENT = "ai.tts.stream";
// 类型：start | chunk | end | error

// AI Service：生成文字时发事件
async *streamChain(query: string, ttsSessionId?: string) {
  const stream = await this.chain.stream({ query });
  for await (const chunk of stream) {
    if (ttsSessionId) {
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, {
        type: "chunk", sessionId: ttsSessionId, chunk,
      });
    }
    yield chunk; // 同时通过 SSE 显示文字给用户
  }
  this.eventEmitter.emit(AI_TTS_STREAM_EVENT, { type: "end", sessionId: ttsSessionId });
}

// TTS Relay Service：监听事件，合成语音
@OnEvent(AI_TTS_STREAM_EVENT)
handleAiStreamEvent(event: AiTtsStreamEvent) {
  switch (event.type) {
    case "start": this.ensureTencentConnection(session); break;
    case "chunk":
      if (session.ready) {
        this.sendTencentChunk(session, event.chunk); // 腾讯 TTS WebSocket 已就绪，直接发
      } else {
        session.pendingChunks.push(event.chunk);    // 还没就绪，先排队
      }
      break;
    case "end": this.flushPendingChunks(session); break;
  }
}
```

**为什么要解耦？** 如果 AI Service 直接调用 TTS Service，两者就耦合了，改动任何一个都要关注另一个的影响，也无法单独测试。EventEmitter 让 AI 只管"发通知"，TTS 只管"做合成"，互不干扰。

**pendingChunks 队列**解决了时序问题：AI 生成文字很快，但腾讯 TTS WebSocket 建连需要时间（有一个 `{ ready: 1 }` 的就绪信号）。在就绪信号到来前，文字先存在队列里，就绪后一次性发出。

完整链路：

```
1. 用户录音 → POST /speech/asr → 腾讯 ASR → 识别文字
2. 浏览器建立 /speech/tts/ws 连接 → 获取 sessionId
3. 请求 GET /ai/chat/stream?query=xxx&ttsSessionId=yyy
4. AI 生成文字 → SSE 推给前端（显示文字）+ EventEmitter 推给 TTS
5. TTS 连腾讯合成 → MP3 二进制流 → 中继给浏览器 WebSocket
6. 浏览器 MediaSource API → 边接收边播放语音
```

### 补充：FileInterceptor——文件上传

来自 `speech.controller.ts`，NestJS 处理文件上传的标准方式：

```typescript
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('speech')
export class SpeechController {
  @Post('asr')
  @UseInterceptors(FileInterceptor('audio'))  // 'audio' 是 form-data 字段名
  async asr(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('请上传音频文件');

    const text = await this.speechService.recognize(file.buffer);
    return { text };
  }
}
```

`FileInterceptor('audio')` 自动解析 `multipart/form-data` 请求，把上传的文件注入到 `@UploadedFile()` 参数中。`file.buffer` 是文件的 `Buffer`（二进制数据），`file.originalname` 是原始文件名，`file.mimetype` 是 MIME 类型。

### 补充：事件类型定义——区分联合类型

来自 `common/stream-events.ts`，用 TypeScript 区分联合类型定义事件协议：

```typescript
export const AI_TTS_STREAM_EVENT = "ai.tts.stream";

export type AiTtsStreamEvent =
  | { type: "start"; sessionId: string; query: string }
  | { type: "chunk"; sessionId: string; chunk: string }
  | { type: "end"; sessionId: string }
  | { type: "error"; sessionId: string; error: string };
```

**区分联合类型**（Discriminated Union）的好处：在 `switch (event.type)` 里，TypeScript 会自动收窄类型——`case "chunk"` 分支里 `event.chunk` 自动有类型提示，`case "start"` 里 `event.query` 自动有类型提示。

---

## 核心依赖速查

| 包 | 用途 |
| --- | --- |
| `@langchain/core` | Runnable、Message、Prompt、Parser 等核心抽象 |
| `@langchain/openai` | ChatOpenAI + OpenAIEmbeddings |
| `@langchain/community` | CheerioLoader、EPubLoader、Milvus VectorStore 等社区组件 |
| `@langchain/textsplitters` | 各种文本切割器 |
| `@langchain/mcp-adapters` | MCP 客户端集成 |
| `@modelcontextprotocol/sdk` | MCP 服务端 SDK |
| `zod` | Schema 定义与验证（工具参数、输出结构） |
| `js-tiktoken` | Token 计数（`cl100k_base` 编码，兼容 GPT-4） |
| `@zilliz/milvus2-sdk-node` | Milvus 向量数据库客户端 |
| `tencentcloud-sdk-nodejs` | 腾讯云 TTS/ASR |
| `@nestjs/core` | NestJS 框架 |
| `typeorm` | ORM（配合 MySQL） |
