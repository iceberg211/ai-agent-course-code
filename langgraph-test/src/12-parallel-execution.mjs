import { Annotation, StateGraph, START, END } from "@langchain/langgraph";

// 【核心技巧】：为了汇聚并行执行的结果，必须使用合理的 Reducer
// 比如下面通过 prev.concat(next) 把结果追加到数组里。
// 如果仅仅使用默认的覆盖合并 (next => next)，那么并行节点里只有一个节点的结果会被保留，其余将被丢失！
const GraphAnnotation = Annotation.Root({
  results: Annotation({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});

// 模拟一个极其耗时的并行节点操作
const branchA = async () => {
  console.log("-> [分支A] 开始检索本地知识库...");
  await new Promise((r) => setTimeout(r, 1000));
  console.log("-> [分支A] 本地知识检索完毕！");
  return { results: ["📚 本地知识片段"] };
};

const branchB = async () => {
  console.log("-> [分支B] 开始互联网内容搜索...");
  await new Promise((r) => setTimeout(r, 600));
  console.log("-> [分支B] 互联网搜索完毕！");
  return { results: ["🌐 互联网最新新闻"] };
};

const branchC = async () => {
  console.log("-> [分支C] 开始调用外部天气 API...");
  await new Promise((r) => setTimeout(r, 800));
  console.log("-> [分支C] 天气 API 完毕！");
  return { results: ["⛅️ 当日天气信息"] };
};

// 汇聚节点(Fan-in)：要求必须等待之前所有的 Fan-out 分支执行完毕，再统一走到这里
const aggregateNode = (state) => {
  console.log("\n-> 聚合节点(Fan-in)：所有分支数据已汇总完毕。");
  console.log("当前汇总的数据：", state.results);
  return state;
};

// 构建并行的图形结构
const builder = new StateGraph(GraphAnnotation)
  .addNode("branchA", branchA)
  .addNode("branchB", branchB)
  .addNode("branchC", branchC)
  .addNode("aggregateNode", aggregateNode)

  // 1. 发散 (Fan-out)：从 START 同时派发三个分支节点，这三个节点在背后会【并行触发】
  .addEdge(START, "branchA")
  .addEdge(START, "branchB")
  .addEdge(START, "branchC")

  // 2. 聚合 (Fan-in)：把发散出去的分支统一指回到 `aggregateNode`。
  // LangGraph 的底层引擎足够智能，只有等前序的三条线路的 Promise 全部 resolves 之后才会触发汇聚。
  .addEdge("branchA", "aggregateNode")
  .addEdge("branchB", "aggregateNode")
  .addEdge("branchC", "aggregateNode")

  .addEdge("aggregateNode", END);

const graph = builder.compile();

const main = async () => {
  console.log("=== 测试并行节点执行 (Fan-out / Fan-in) ===\n");
  
  const startTime = Date.now();
  // 运行该图
  const finalState = await graph.invoke({});
  const endTime = Date.now();

  console.log(`\n【最终并行汇聚结果】:`, finalState.results);
  console.log(`💡 提示：该流程最大耗时为 1000ms，总耗时仅需并行的最大边界时长: ${endTime - startTime}ms\n`);
  
  // 可以解一下图看结构
  const drawable = await graph.getGraphAsync();
  console.log("你可以通过下面 Mermaid 看结构：\n", drawable.drawMermaid({ withStyles: false }));
};

main();
