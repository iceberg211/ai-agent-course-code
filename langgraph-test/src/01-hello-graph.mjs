/**
 * 01-hello-graph.mjs
 * ==================
 * 知识点：LangGraph.js 最小状态图
 *
 * 核心概念：
 * 1. State（状态）— 图中所有节点共享的数据对象
 * 2. Node（节点）— 接收 state，返回 state 的局部更新
 * 3. Edge（边）— 决定节点执行完后去哪个节点
 * 4. START / END — 图的入口和出口
 *
 * 和 LangChain 的 Runnable 有什么不同？
 * - Runnable 是线性的：A → B → C，数据从头流到尾
 * - StateGraph 是网状的：节点可以循环、分支、等待，状态是全局共享的
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import chalk from 'chalk';

// ============================================================
// 第一步：定义状态（State Schema）
// ============================================================
// Annotation.Root 定义了图中所有节点共享的状态对象结构
// 这里状态就是一个简单的计数器 + 日志列表
const GraphState = Annotation.Root({
  // count：普通字段，节点返回的值会直接覆盖（overwrite）
  count: Annotation({
    value: (left, right) => right,  // reducer：直接用新值
    default: () => 0,
  }),

  // logs：列表字段，节点返回的值追加到列表末尾
  logs: Annotation({
    value: (left, right) => [...left, ...right],  // reducer：合并列表
    default: () => [],
  }),
});

// ============================================================
// 第二步：定义节点（Node）
// ============================================================
// 节点就是一个 async 函数，接收 state，返回 state 的局部更新
// 注意：不需要返回完整 state，只返回你修改的字段

const nodeA = async (state) => {
  console.log(chalk.cyan('  [节点 A 执行中]'), `当前 count = ${state.count}`);
  
  // 模拟一些工作
  await new Promise(r => setTimeout(r, 100));
  
  return {
    count: state.count + 1,
    logs: [`节点A执行完成，count 从 ${state.count} 变成 ${state.count + 1}`],
  };
};

const nodeB = async (state) => {
  console.log(chalk.yellow('  [节点 B 执行中]'), `当前 count = ${state.count}`);

  await new Promise(r => setTimeout(r, 100));

  return {
    count: state.count * 2,
    logs: [`节点B执行完成，count 从 ${state.count} 变成 ${state.count * 2}`],
  };
};

const nodeC = async (state) => {
  console.log(chalk.green('  [节点 C 执行中]'), `当前 count = ${state.count}`);

  return {
    logs: [`节点C执行完成，最终 count = ${state.count}`],
  };
};

// ============================================================
// 第三步：构建图
// ============================================================
const graph = new StateGraph(GraphState)
  .addNode('nodeA', nodeA)
  .addNode('nodeB', nodeB)
  .addNode('nodeC', nodeC)
  // 边：定义执行顺序 START → A → B → C → END
  .addEdge(START, 'nodeA')
  .addEdge('nodeA', 'nodeB')
  .addEdge('nodeB', 'nodeC')
  .addEdge('nodeC', END)
  .compile();

// ============================================================
// 第四步：运行图
// ============================================================
console.log(chalk.bgBlue.white('\n=== 01-hello-graph.mjs ===\n'));
console.log('初始状态：count = 0\n');

// invoke 传入初始状态，返回最终状态
const finalState = await graph.invoke({ count: 0 });

console.log('\n');
console.log(chalk.bgGreen.black('✅ 执行完毕！最终状态：'));
console.log('  count =', finalState.count);
console.log('  logs:');
finalState.logs.forEach(log => console.log('   -', log));

/**
 * 理解要点：
 * 1. state 在节点之间"流动"，每个节点可以修改部分字段
 * 2. reducer 决定了字段的更新方式（覆盖 or 追加 or 自定义）
 * 3. 图的执行顺序由 Edge 决定，不是代码顺序
 * 4. compile() 之后才能执行，compile 会做图结构验证
 */
