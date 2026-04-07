# LangChain AI Agent 课程笔记

> 学习路线：从第一次调 LLM，到构建工具 Agent，到 RAG 知识库，再到生产级 NestJS 服务。

---

## 学习路线

```
1. tool-test               → 从零开始：调 LLM、定义工具、写 Agent 循环、接 MCP
2. prompt-template-test    → 学会精确控制模型的输入（Prompt 工程）
3. output-parser-test      → 让模型按你要的格式输出结构化数据
4. runnable-test           → 理解 LangChain 的组合哲学（Runnable 体系）
5. memory-test             → 让 Agent 记住对话——三种策略各有取舍
6. rag-test                → 给 Agent 接上"外部知识库"（文档加载与切割）
7. milvus-test             → 换上生产级向量数据库，跑电子书 RAG 实战
8. cron-job-tool           → 把所有能力合在一起：定时任务 + 多工具 Agent
9. tts-stt-test            → 加上耳朵和嘴巴：语音识别与语音合成
10. asr-and-tts-nest-service → 把语音和 AI 接成一条完整的流水线
11. hello-nest-langchain    → 最后一步：把 LangChain 封装进 NestJS 服务对外暴露
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

---

## 二、Prompt 工程（prompt-template-test）

搞清楚了怎么调模型，下一步是学会"精确说话"。这一章所有示例围绕一个真实场景：**工程团队周报自动生成**。

### 为什么需要 PromptTemplate

最直接的方式是手动拼字符串：`const prompt = \`公司：${companyName}...\``。

这在简单情况下没问题，但一旦模板复杂起来——变量多、不同场景复用、团队协作维护——字符串拼接就很难管理了。`PromptTemplate` 把模板和数据分离：

```javascript
import { PromptTemplate } from "@langchain/core/prompts";

const template = PromptTemplate.fromTemplate(
  `公司：{company_name}，部门：{team_name}
   周期：{week_range}，目标：{team_goal}
   本周开发活动：{dev_activities}
   请生成一份专业的技术周报。`
);

const formatted = await template.format({
  company_name: "星航科技",
  team_name: "数据智能平台组",
  week_range: "2025-03-10 ~ 2025-03-16",
  team_goal: "用户画像服务灰度上线",
  dev_activities: "阿兵：27 次提交，灰度部署和回滚脚本优化...",
});
```

`fromTemplate()` 自动从字符串里提取所有 `{变量名}` 作为 `inputVariables`，`format()` 时如果漏了某个变量会直接报错——比手动拼接更安全。

---

### ChatPromptTemplate——给消息分角色

上面的 `PromptTemplate` 生成的是**纯文本**。但聊天模型接收的是**带角色的消息数组**。这时候用 `ChatPromptTemplate`：

```javascript
import { ChatPromptTemplate } from "@langchain/core/prompts";

const chatPrompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一名资深工程团队负责人，写作风格：{tone}。"],
  ["human", "本周信息：公司 {company_name}，部门 {team_name}... 请生成周报。"],
]);

// formatMessages 返回 [SystemMessage, HumanMessage]，可以直接传给 model.invoke()
const messages = await chatPrompt.formatMessages({
  tone: "专业清晰",
  company_name: "星航科技",
  // ...
});
```

System 和 Human 分开写有实际效果：system 设定角色，模型会一直遵循；human 放具体任务。把它们混在一起效果通常更差。

**MessagesPlaceholder** 是进阶用法，用来在固定位置插入动态的历史消息，是实现多轮对话记忆的关键：

```javascript
import { MessagesPlaceholder } from "@langchain/core/prompts";

const chatPromptWithHistory = ChatPromptTemplate.fromMessages([
  ["system", "你是工程效率顾问"],
  new MessagesPlaceholder("history"), // {history} 会被替换成历史对话数组
  ["human", "新问题：{current_input}"],
]);

// 传入历史消息（数组格式）
const messages = await chatPromptWithHistory.formatMessages({
  history: [
    { role: "human", content: "我们在做 Prompt 模块化..." },
    { role: "ai", content: "建议按职责拆分为 4 个块..." },
  ],
  current_input: "协同编辑流程有什么建议？",
});
// 生成：[SystemMessage, HumanMessage(历史1), AIMessage(历史2), HumanMessage(当前问题)]
```

---

### FewShotPromptTemplate——与其描述，不如举例

有时候你想让模型输出特定风格，但用语言描述起来很难。直接给几个例子效果更好：

```javascript
import { FewShotPromptTemplate, PromptTemplate } from "@langchain/core/prompts";

const examples = [
  {
    requirement: "本周主要在修 Bug，重点突出稳定性",
    report: "- 支付链路本周处理 P1 Bug 2 个、P2 Bug 3 个，全部在 SLA 内解决...",
  },
  {
    requirement: "本周有新功能上线，想多展示成果",
    report: "- 新上线「订单实时看板」，上线首日访问量 1200+ 次...",
  },
];

// 定义单条示例的格式
const examplePrompt = PromptTemplate.fromTemplate(
  "需求：{requirement}\n周报：{report}"
);

const fewShotPrompt = new FewShotPromptTemplate({
  examples,
  examplePrompt,
  prefix: "下面是几条周报示例，请学习它们的风格：",
  suffix: "现在请根据以下需求写周报：{requirement}",
  inputVariables: ["requirement"],
});

// format() 会把 examples 全部按 examplePrompt 格式化，拼在 prefix 和 suffix 之间
const result = await fewShotPrompt.format({ requirement: "本周做了大量重构..." });
```

---

### FewShotChatMessagePromptTemplate——对话形式的少样本

`FewShotPromptTemplate` 生成纯文本，而 `FewShotChatMessagePromptTemplate` 把每条示例都变成 human/ai 对话对，嵌入聊天模板里：

```javascript
import {
  FewShotChatMessagePromptTemplate,
  ChatPromptTemplate,
} from "@langchain/core/prompts";

const examples = [
  {
    input: "本周主要推进支付稳定性治理，做了事故处置、告警优化和演练。",
    output: "- 本周聚焦支付链路稳定性，处理线上告警 12 条，合并冗余规则 8 条...",
  },
  {
    input: "本周交付了新运营看板，并给业务同学做了多场分享。",
    output: "- 上线新一代「运营实时看板」，衔接埋点和数据仓库...",
  },
];

const fewShotExamples = new FewShotChatMessagePromptTemplate({
  examplePrompt: ChatPromptTemplate.fromMessages([
    ["human", "工作概述：{input}，请整理成周报要点。"],
    ["ai", "{output}"],
  ]),
  examples,
  inputVariables: [],
});

// 嵌入完整的 ChatPromptTemplate
const finalPrompt = ChatPromptTemplate.fromMessages([
  ["system", "你是资深技术负责人，请参考示例风格输出周报。"],
  fewShotExamples,   // 示例块直接嵌入，会展开成多条消息
  ["human", "工作概述：{current_work}，请整理成周报要点。"],
]);

const messages = await finalPrompt.formatMessages({ current_work: "本周完成了订单模块重构..." });
// 生成：[SystemMessage, HumanMsg(示例1), AIMsg(示例1), HumanMsg(示例2), AIMsg(示例2), HumanMsg(当前任务)]
```

---

### 示例选择器——示例太多时动态筛选

静态示例里所有例子每次都会包含，Token 受限。当你积累了很多示例时，用选择器动态挑选最合适的几个：

**LengthBasedExampleSelector** — 按长度贪心选：

```javascript
import { LengthBasedExampleSelector } from "@langchain/core/example_selectors";

const selector = await LengthBasedExampleSelector.fromExamples(examples, {
  examplePrompt,
  maxLength: 500,                               // 总字符数上限
  getTextLength: (text) => text.length,         // 用字符数计算（也可换成 token 数）
});

const fewShotPrompt = new FewShotPromptTemplate({
  exampleSelector: selector,  // 替换 examples
  examplePrompt,
  suffix: "需求：{requirement}",
  inputVariables: ["requirement"],
});
```

逻辑：按顺序贪心选，加进来不超限就留，超了就停。简单无状态，适合示例库不大的场景。

**SemanticSimilarityExampleSelector** — 语义相似度选（更智能）：

```javascript
import { SemanticSimilarityExampleSelector } from "@langchain/core/example_selectors";
import { Milvus } from "@langchain/community/vectorstores/milvus";

// 先把所有示例向量化存入 Milvus（一次性准备工作）
const vectorStore = await Milvus.fromExistingCollection(embeddings, {
  collectionName: "weekly_report_examples",
  clientConfig: { address: "localhost:19530" },
});

const selector = new SemanticSimilarityExampleSelector({
  vectorStore,
  k: 2, // 返回最相似的 2 个
});
```

原理：用户输入向量化 → Milvus COSINE 相似度搜索 → 返回 top-k 个最像的例子。你问"稳定性治理怎么写"，它会找到历史里关于稳定性的示例，而不是随便选。

---

### PipelinePromptTemplate——把大 Prompt 拆成可复用模块

当 Prompt 越来越复杂，可以按职责拆分成独立模块，再用 `PipelinePromptTemplate` 组合：

```javascript
import { PipelinePromptTemplate } from "@langchain/core/prompts";

// 4 个独立模块，各自维护，各自有独立变量
const personaPrompt  = PromptTemplate.fromTemplate("你是资深工程负责人，风格：{tone}。");
const contextPrompt  = PromptTemplate.fromTemplate("公司：{company_name}，部门：{team_name}...");
const taskPrompt     = PromptTemplate.fromTemplate("本周活动：{dev_activities}，请提炼亮点和风险。");
const formatPrompt   = PromptTemplate.fromTemplate("用 Markdown 输出，体现{company_values}的价值观。");

const pipeline = new PipelinePromptTemplate({
  pipelinePrompts: [
    { name: "persona_block",  prompt: personaPrompt },
    { name: "context_block",  prompt: contextPrompt },
    { name: "task_block",     prompt: taskPrompt },
    { name: "format_block",   prompt: formatPrompt },
  ],
  finalPrompt: PromptTemplate.fromTemplate(
    "{persona_block}\n{context_block}\n{task_block}\n{format_block}\n\n请开始生成："
  ),
});
```

调用 `format()` 时，先把四个模块各自渲染，再拼进最终模板。**复用**是最大优势：同一套 `personaPrompt` + `contextPrompt` 可以搭配不同的 task/format 块，生成周报、OKR 回顾、晋升述职——每种场景只换最后两个模块。

**Partial** 是配套工具——预先填好不变的变量：

```javascript
const companyLevel = await pipeline.partial({
  company_name: "星航科技",
  company_values: "「极致、开放、靠谱」",
  tone: "偏正式但不僵硬",
});

const report1 = await companyLevel.format({ team_name: "AI 平台组", ... });
const report2 = await companyLevel.format({ team_name: "数据工程组", ... });
```

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

## 五、对话记忆（memory-test）

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

## 六、RAG 文档处理（rag-test）

RAG（Retrieval-Augmented Generation）解决的是"大模型不知道你私有文档"的问题。

### 流程

```
建库：文档 → 加载 → 切割 → 向量化 → 存入向量库
查询：问题 → 向量化 → 相似度检索 → 相关片段 + 问题 → 模型生成回答
```

### 加载文档

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

---

## 十一、NestJS 服务封装（hello-nest-langchain）

最后一步：把 LangChain 链封装进 NestJS 服务对外暴露。

### 链在构造函数里初始化，不要每次请求都创建

来自 `ai.service.ts` 的真实代码：

```typescript
@Injectable()
export class AiService {
  private readonly chain: Runnable;

  constructor(@Inject('CHAT_MODEL') model: ChatOpenAI) {
    const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}');
    // chain 在构造函数里创建一次，之后每次请求直接复用
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  async runChain(query: string): Promise<string> {
    return this.chain.invoke({ query }); // 同步调用，等模型完成后返回
  }

  async *streamChain(query: string): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      yield chunk; // 把 LangChain 的流转换成 AsyncGenerator
    }
  }
}
```

`ChatOpenAI` 通过 `@Inject('CHAT_MODEL')` 注入，模型实例在模块级别创建一次。如果每次请求都 `new ChatOpenAI()`，会重复读取配置、重复建立连接，浪费资源。

### ChatOpenAI 的工厂 Provider

```typescript
// ai.module.ts
{
  provide: 'CHAT_MODEL',
  useFactory: (configService: ConfigService) => {
    return new ChatOpenAI({
      model: configService.get('MODEL_NAME'),
      apiKey: configService.get('OPENAI_API_KEY'),
      configuration: { baseURL: configService.get('OPENAI_BASE_URL') },
    });
  },
  inject: [ConfigService],
}
```

工厂模式让模型配置从 `.env` 读取，不硬编码，支持多环境部署。

### 两种端点：REST vs SSE

来自 `ai.controller.ts` 的真实代码：

```typescript
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // 普通 REST：等模型全部生成完再返回
  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  // SSE 端点：实时流式返回
  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<{ data: string }> {
    return from(this.aiService.streamChain(query)).pipe(
      map((chunk) => ({ data: chunk }))
    );
  }
}
```

**SSE 的数据流**：LangChain `chain.stream()` → `AsyncGenerator<string>` → RxJS `from()` 转 `Observable` → NestJS `@Sse` 自动序列化 → HTTP `text/event-stream` → 浏览器 `EventSource`：

```javascript
// 前端消费 SSE
const es = new EventSource('/ai/chat/stream?query=什么是LangChain？');
es.onmessage = ({ data }) => {
  output.textContent += data; // 每收到一个 chunk 就追加显示
};
es.onerror = () => es.close();
```

`from()` 是 RxJS 的核心工具，能把 AsyncGenerator、Promise、数组等都转成 Observable。NestJS 的 `@Sse` 装饰器消费 `Observable<MessageEvent>` 类型，自动按 SSE 协议格式化输出。

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
