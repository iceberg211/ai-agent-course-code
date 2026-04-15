import { Annotation, StateGraph, Send, START, END } from "@langchain/langgraph";

// ======= Map-Reduce 经典模式架构 =======
// 该模式解决由于 LLM 的 Context Token 限制，我们需要把巨量文章拆散到多个节点并发处理，最后再拼装结果。

const DocumentAnnotation = Annotation.Root({
  // 外界传进来的待处理文档清单
  documents: Annotation({
    reducer: (prev, next) => next, 
    default: () => [],
  }),
  // 各个子处理工序 (Worker) 完毕后，汇聚的摘要数组
  // 这里必须用数组拼接，以避免在并行写入时只存下最后一个的内容
  summaries: Annotation({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});

// 【Mapper 节点】：相当于每个独立的打工人。它单独只处理【部分】文本
// 注意这里入参并不是完整的大 Graph Annotation，因为我们会把每一个文档独立 Send 给他吃。
const summarizeNode = async (state) => {
  console.log(`-> [Mapper 打工人] 正在努力阅读并总结：[ ${state} ]`);
  
  // 模拟 LLM 花时间生成...
  await new Promise((r) => setTimeout(r, Math.random() * 500 + 500));
  
  // 【关键点】它返回的字典 Key 对应主 Graph 的 Annotation 的字段 (此处是 summaries)
  return { summaries: [`✅ 摘要（基于内容: ${state} 生成）`] }; 
};

// 【Dispatcher 节点】：负责指挥派发的监工
const dispatchNode = (state) => {
  console.log(`\n-> [派发器总管] 收到 ${state.documents.length} 段文档文本，准备动态派发包工头...`);
  
  // 【核心技巧】：不返回状态对象的更新，而是返回一组并行运行的【Send】指令！！
  // Send 负责将图结构强行分发并开辟平行任务线。
  // new Send(接收任务的节点名字, 单独传递给他的状态)
  const sends = state.documents.map((doc) => new Send("summarizeNode", doc));
  return sends; 
};

// 【Reducer 节点】：大总管收集汇总所有的结果
const reduceNode = (state) => {
  console.log("\n-> [汇聚大总管]：所有 Mapper 子任务已经完工，开始整理报表...");
  console.log("所有的处理成果如下：");
  state.summaries.forEach((s, idx) => console.log(`  [片段${idx+1}] ${s}`));
  return state;
};

// 开始绘制工作图表
const builder = new StateGraph(DocumentAnnotation)
  .addNode("summarizeNode", summarizeNode)
  .addNode("reduceNode", reduceNode)
  
  // 注意，如果使用了动态派发 (Send)，派发的起始点必须是一条特殊的【条件边】 addConditionalEdges！
  // 它从 START 开始，经过 dispatchNode 动态返回的 Send() 数组，并去调用相应的节点(["summarizeNode"])
  .addConditionalEdges(START, dispatchNode, ["summarizeNode"])
  
  // 当全部的 "summarizeNode" 都返回后，LangGraph 会自动 Fan-in(聚拢) 并走到下一条线，指向 reduce。
  .addEdge("summarizeNode", "reduceNode")
  .addEdge("reduceNode", END);

const graph = builder.compile();

const main = async () => {
  console.log("=== 测试 Map-Reduce 分治工作流 ===\n");
  
  const extremelyLongTextData = [
    "第一章：关于世界名著的书评与大纲。",
    "第二章：科技发展史在十九世纪的主要转折点。",
    "第三章：未来科幻城邦的社会制度想象分析。"
  ];
  
  const startTime = Date.now();
  // 我们仅仅是将数据提供上去即可。
  const finalState = await graph.invoke({ documents: extremelyLongTextData });
  const endTime = Date.now();

  console.log(`\n[全部处理完毕]，耗时: ${endTime - startTime}ms`);
  console.log("这代表即使任务有 100 章拆分，处理速度也仅仅是最慢一章的生成时间！");
};

main();
