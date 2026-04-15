import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import chalk from "chalk"; // 使用 chalk 使命令行有些带颜色交互感
import "dotenv/config";

const GraphAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});

// 初始化大模型
// 【非常重要】：要想看流式推流，必须在 LLM 中设置 streaming: true。
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  streaming: true, // 核心！
});

const callLLMNode = async (state) => {
  // 当调用这里时，LangGraph 会接管底层的 EventStream (事件流事件)
  const response = await model.invoke(state.messages);
  return { messages: [response] }; // 最后作为 state return 返回
};

// 图的极简骨架
const graph = new StateGraph(GraphAnnotation)
  .addNode("callLLMNode", callLLMNode)
  .addEdge(START, "callLLMNode")
  .addEdge("callLLMNode", END)
  .compile();

const main = async () => {
  console.log("=== 测试高级底层流事件输出 (Streaming Tokens by LangGraph) ===\n");

  const input = {
    messages: [new HumanMessage("请给我讲一个短笑话（大概 3 句话左右，加一点表情符号）。")],
  };

  process.stdout.write(chalk.blue("🙋🏻‍♂️ 用户: "));
  console.log(input.messages[0].content);
  
  process.stdout.write(chalk.green("🤖 AI讲笑话: \n\n"));

  // 【核心技巧】：使用 app.stream 并开启 streamMode: "messages" 获取大模型的推流数据包
  // 你可以使用 "updates"（节点更新流）或者 "values"（Graph全量值流），但 "messages" 是大语言模型实时吐出来的字级别的 Token 缓存流！
  const stream = await graph.stream(input, {
    streamMode: "messages",
  });

  // 读取 Generator 返回的块
  for await (const [messageChunk, _metadata] of stream) {
    if (messageChunk.content) {
      // 像传统打字机或者 ChatGPT Next Web Chat 等网页流式输出一样，逐一喷吐每个 Token 内容
      process.stdout.write(chalk.yellow(messageChunk.content));
    }
  }

  console.log("\n\n✅ 流式吐字完毕。");
};

main();
