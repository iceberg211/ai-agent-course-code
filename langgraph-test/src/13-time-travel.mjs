import { Annotation, StateGraph, MemorySaver, START, END } from "@langchain/langgraph";

// 时间漫步(Time Travel) 必须要依赖 Checkpointer。
// 它允许整个运行时记录每次在图里穿梭的过程快照。
const GraphAnnotation = Annotation.Root({
  count: Annotation({
    reducer: (prev, next) => next, // 此处仅仅是直接覆盖
    default: () => 0,
  }),
});

const node1 = (state) => {
  console.log(`[node1] 当前数量: ${state.count}。正在加 1。`);
  return { count: state.count + 1 };
};

const node2 = (state) => {
  console.log(`[node2] 当前数量: ${state.count}。正在加 10 (故意制造了一个错误数字!)。`);
  return { count: state.count + 10 }; 
};

const node3 = (state) => {
  console.log(`[node3] 收尾归档，当前值为: ${state.count}`);
  return state;
};

// 确保必须传入 MemorySaver 开启检查点抓取历史记录
const checkpointer = new MemorySaver();

const graph = new StateGraph(GraphAnnotation)
  .addNode("node1", node1)
  .addNode("node2", node2)
  .addNode("node3", node3)
  .addEdge(START, "node1")
  .addEdge("node1", "node2")
  .addEdge("node2", "node3")
  .addEdge("node3", END)
  .compile({ checkpointer });

const main = async () => {
  console.log("=== 测试 Time Travel 与状态修改(State Override) ===\n");
  
  // 必须传入 thread_id 才能保留历史记录
  const config = { configurable: { thread_id: "time-travel-demo" } };

  console.log("1️⃣ 第一次图的整体执行 (模拟遇到错误业务逻辑的情况):");
  const finalState = await graph.invoke({ count: 0 }, config);
  console.log("图完全执行后的状态:", finalState);

  console.log("\n2️⃣ 执行时空查询，获取到当前 Thread 下的所有运行快照...");
  const states = [];
  for await (const state of graph.getStateHistory(config)) {
    states.push(state);
  }
  
  // states 数组为时间倒序：第一个状态是最终执行完毕的快照，依此类推。
  console.log(`找到了 ${states.length} 个历史快照。`);
  
  // 假设 node2(加 10) 这段逻辑出问题了，我们要恢复到刚跑完 node1 的时刻，
  // 此时它准备进行 node2 所以 next = ["node2"]。
  const stateAtNode1 = states.find(s => s.next.includes("node2"));

  if (stateAtNode1) {
    console.log(`\n3️⃣ 【强行快照回滚】：找到刚刚执行完 node1 这个瞬间，此时值:`, stateAtNode1.values);

    // 【核心技巧：篡改快照状态】
    // 我们在这个平行时窗(即修改该快照对应的 config 下的状态)
    // 强制把 count 值在执行 node2 前干预成 100 !
    console.log("-> 正在修改平行宇宙...（将其篡改为 100）");
    await graph.updateState(
      stateAtNode1.config,  // 指定那个平行的快照 id (它有独立的 thread_id 和 checkpoint_id)
      { count: 100 },       // 直接注入由人类或者修复脚本计算出的正确值
    );

    console.log("-> ✅ 历史执行状态已经被成功篡改！此时如果我们继续执行，图会沿着 node2 继续计算，不过基准变成了 100。\n");

    console.log("4️⃣ 【从修改的历史时点重新恢复图执行】: ");
    // 图会自动判定当前所在节点，既然在 stateAtNode1 快照的平行宇宙，其 next 是 node2...
    // 于是就会走 node2 -> node3 继续到底。
    const newFinalState = await graph.invoke(null, config);
    console.log("新时间线的执行结果(期望变成 100 + 10 = 110):", newFinalState);
    console.log("\n💡 提示：此机制用于客服系统的'人类重新接入纠错并放行'功能极为强大！");
  }
};

main();
