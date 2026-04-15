import { Annotation, StateGraph, START, END } from "@langchain/langgraph";

// 这是一个子图 (Subgraph) 的状态定义。
// 【技巧】子图可以有自己独立的状态，避免所有数据都混杂在主图状态中，实现模块化。
const SubgraphAnnotation = Annotation.Root({
  intermediateResult: Annotation({
    reducer: (prev, next) => next,
    default: () => "none",
  }),
});

// 子图的常规处理节点
const childNode1 = (state) => {
  console.log("-> [子图] 运行节点 childNode1");
  return { intermediateResult: "Processed by Subgraph" };
};

// 编译独立的子图。它其实就是一个拥有完全独立运行逻辑的 LangGraph 图实例
const childGraph = new StateGraph(SubgraphAnnotation)
  .addNode("childNode1", childNode1)
  .addEdge(START, "childNode1")
  .addEdge("childNode1", END)
  .compile();

// -----------------------------------------------------

// 这是主图 (Parent Graph) 的状态定义
const MainGraphAnnotation = Annotation.Root({
  input: Annotation({
    reducer: (prev, next) => next,
    default: () => "",
  }),
  finalOutput: Annotation({
    reducer: (prev, next) => next,
    default: () => "",
  }),
});

// 主图中的普通节点
const nodeA = (state) => {
  console.log(`-> [主图] 运行节点 nodeA，接收输入: ${state.input}`);
  return state;
};

const nodeC = (state) => {
  console.log("-> [主图] 运行节点 nodeC，准备收尾");
  return { finalOutput: `Done! Received: ${state.input}` };
};

// 【核心技巧】：在主图中直接将已编译的子图 (childGraph) 当作一个普通 Node 节点添加！
const parentGraph = new StateGraph(MainGraphAnnotation)
  .addNode("nodeA", nodeA)
  // 当进入 nodeB 环节时，其实会调用刚才定义的一整个子图流程
  .addNode("nodeB", childGraph)
  .addNode("nodeC", nodeC)
  // 设置连接边
  .addEdge(START, "nodeA")
  .addEdge("nodeA", "nodeB")
  .addEdge("nodeB", "nodeC")
  .addEdge("nodeC", END)
  .compile();

const main = async () => {
  console.log("=== 测试子图嵌套 (Subgraphs) ===\n");
  const result = await parentGraph.invoke({ input: "Hello Composite Graph!" });
  console.log("\n【最终主图结果】:");
  console.log(result);

  console.log("\n💡 提示：将极度庞大、复杂的流程图，按照功能模块拆分为不同的子图进行单测和组合！\n");
};

main();
