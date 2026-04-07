import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { executeCommandTool, listDirectoryTool, readFileTool, writeFileTool } from './all-tools.mjs';
import chalk from 'chalk';

// ─── 模型初始化 ───────────────────────────────────────────────────────────────

const model = new ChatOpenAI({
    modelName: 'qwen-plus',
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

// ─── 工具列表 ─────────────────────────────────────────────────────────────────

const tools = [readFileTool, writeFileTool, executeCommandTool, listDirectoryTool];

// bindTools 让模型知道有哪些工具可以调用，模型会在回复中以结构化格式给出工具调用指令
const modelWithTools = model.bindTools(tools);

// ─── 流式接收 AI 回复 ──────────────────────────────────────────────────────────
//
// 模型以流的方式返回内容（一个 chunk 一个 chunk 地来），好处是：
//   - 普通文字可以实时打印，不用等全部生成完
//   - write_file 的文件内容可以边生成边预览
//
// 难点：工具调用的参数是 JSON，流式状态下 JSON 是不完整的，
// 所以我们用 JsonOutputToolsParser 不断尝试解析，失败了就等下一个 chunk 再试。

async function streamAIResponse(messages) {
    const rawStream = await modelWithTools.stream(messages);
    const toolParser = new JsonOutputToolsParser();

    // 把所有 chunk 拼成一个完整的 AIMessage，流结束后用它提取 tool_calls
    let fullAIMessage = null;

    // 记录每个 write_file 调用已经打印了多少字符，用来只打印新增部分（避免重复）
    const printedLengths = new Map();

    console.log(chalk.bgBlue(`\n🚀 Agent 开始思考...\n`));

    for await (const chunk of rawStream) {
        // 累积 chunk：LangChain 的消息对象支持 .concat() 做增量合并
        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

        // 尝试从已累积的内容里解析工具调用（流未结束时 JSON 不完整，解析失败是正常的）
        let parsedTools = null;
        try {
            parsedTools = await toolParser.parseResult([{ message: fullAIMessage }]);
        } catch {
            // JSON 还不完整，跳过，等下一个 chunk
        }

        if (parsedTools?.length > 0) {
            // AI 正在生成工具调用 —— 如果是 write_file，实时预览文件内容
            for (const toolCall of parsedTools) {
                if (toolCall.type === 'write_file' && toolCall.args?.content) {
                    const key = toolCall.id || toolCall.args.filePath || 'default';
                    const content = String(toolCall.args.content);
                    const alreadyPrinted = printedLengths.get(key) ?? 0;

                    if (alreadyPrinted === 0) {
                        console.log(chalk.bgBlue(
                            `\n[工具调用] write_file("${toolCall.args.filePath}") - 开始写入（流式预览）\n`
                        ));
                    }

                    // 只打印本轮新增的字符
                    if (content.length > alreadyPrinted) {
                        process.stdout.write(content.slice(alreadyPrinted));
                        printedLengths.set(key, content.length);
                    }
                }
            }
        } else if (chunk.content) {
            // AI 在输出普通文字（不是工具调用），直接流式打印
            process.stdout.write(
                typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content)
            );
        }
    }

    return fullAIMessage;
}

// ─── 执行工具调用 ─────────────────────────────────────────────────────────────
//
// AI 回复里包含工具调用指令（tool_calls），我们在本地真正执行这些工具，
// 然后把执行结果以 ToolMessage 的形式存入历史，AI 下一轮才能看到结果。

async function executeToolCalls(toolCalls, history) {
    for (const toolCall of toolCalls) {
        const tool = tools.find(t => t.name === toolCall.name);
        if (!tool) continue;

        console.log(chalk.yellow(`\n🔧 执行工具: ${toolCall.name}`));
        const result = await tool.invoke(toolCall.args);

        await history.addMessage(new ToolMessage({
            content: result,
            tool_call_id: toolCall.id, // 必须和 AI 请求里的 id 对应，AI 才知道这是哪个工具的结果
        }));
    }
}

// ─── Agent 主循环 ─────────────────────────────────────────────────────────────
//
// 整体流程：
//   用户输入 → AI 思考 → 调用工具 → 把结果告诉 AI → AI 继续思考 → ...
//   直到 AI 不再调用任何工具，说明它认为任务已完成。

async function runAgent(query, maxIterations = 30) {
    const history = new InMemoryChatMessageHistory();

    await history.addMessage(new SystemMessage(`你是一个项目管理助手，使用工具完成任务。

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
- 正确示例: { command: "pnpm install", workingDirectory: "react-todo-app" }

重要规则 - write_file：
- 当写入 React 组件文件（如 App.tsx）时，如果存在对应的 CSS 文件（如 App.css），在其他 import 语句后加上这个 css 的导入
`));

    await history.addMessage(new HumanMessage(query));

    for (let i = 0; i < maxIterations; i++) {
        console.log(chalk.bgGreen(`⏳ 第 ${i + 1} 轮思考...`));

        // 1. 把完整对话历史发给 AI，流式接收回复
        const messages = await history.getMessages();
        const aiMessage = await streamAIResponse(messages);

        // 2. 把 AI 回复存入历史（下一轮 AI 能看到自己说过什么）
        await history.addMessage(aiMessage);
        
        console.log(chalk.green('\n✅ 回复已存入历史'));

        // 3. 如果 AI 没有调用任何工具，说明它认为任务完成了
        if (!aiMessage.tool_calls?.length) {
            console.log(`\n✨ 任务完成:\n${aiMessage.content}\n`);
            return aiMessage.content;
        }

        // 4. 执行工具，结果存入历史，进入下一轮
        await executeToolCalls(aiMessage.tool_calls, history);
    }

    // 超过最大迭代次数，返回最后一条消息
    const finalMessages = await history.getMessages();
    return finalMessages.at(-1).content;
}

// ─── 任务定义 & 执行 ──────────────────────────────────────────────────────────

const task = `创建一个功能丰富的 React TodoList 应用：

1. 创建项目：echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx，实现完整功能的 TodoList：
 - 添加、删除、编辑、标记完成
 - 分类筛选（全部/进行中/已完成）
 - 统计信息显示
 - localStorage 数据持久化
3. 添加复杂样式：
 - 渐变背景（蓝到紫）
 - 卡片阴影、圆角
 - 悬停效果
4. 添加动画：
 - 添加/删除时的过渡动画
 - 使用 CSS transitions
5. 列出目录确认

注意：使用 pnpm，功能要完整，样式要美观，要有动画效果

去掉 main.tsx 里的 index.css 导入

之后在 react-todo-app 项目中：
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

try {
    await runAgent(task);
} catch (error) {
    console.error(`\n❌ 错误: ${error.message}\n`);
}
