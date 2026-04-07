/**
 * 04-checkpoint.mjs
 * =================
 * 知识点：检查点（Checkpoint）与任务持久化
 *
 * 为什么需要 Checkpoint？
 * - 长任务运行过程中服务可能重启
 * - 用户可能想暂停任务稍后继续
 * - 调试时需要从某个节点重放
 *
 * 核心概念：
 * - MemorySaver：内存检查点（开发/测试用）
 * - thread_id：唯一标识一次任务执行，相当于任务 ID
 * - 相同 thread_id 调用 invoke，会从上次断点继续
 *
 * 生产环境：用 PostgresSaver / RedisSaver 替换 MemorySaver
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import chalk from 'chalk';

// ============================================================
// 状态定义
// ============================================================
const WorkflowState = Annotation.Root({
  steps: Annotation({
    value: (left, right) => [...left, ...right],
    default: () => [],
  }),
  currentPhase: Annotation({ value: (_, r) => r, default: () => 'start' }),
  data: Annotation({ value: (_, r) => r, default: () => '' }),
});

// ============================================================
// 模拟三个耗时阶段
// ============================================================
const phase1Node = async (state) => {
  console.log(chalk.cyan('\n  [阶段1] 数据采集中...'));
  await new Promise(r => setTimeout(r, 500));
  console.log(chalk.gray('  → 阶段1完成：采集到 100 条数据'));
  return {
    steps: ['阶段1-数据采集完成（100条）'],
    currentPhase: 'phase1_done',
    data: '100条原始数据',
  };
};

const phase2Node = async (state) => {
  console.log(chalk.cyan('\n  [阶段2] 数据处理中...'));
  await new Promise(r => setTimeout(r, 500));
  console.log(chalk.gray('  → 阶段2完成：处理完毕'));
  return {
    steps: ['阶段2-数据处理完成'],
    currentPhase: 'phase2_done',
    data: state.data + ' → 已清洗处理',
  };
};

const phase3Node = async (state) => {
  console.log(chalk.cyan('\n  [阶段3] 生成报告中...'));
  await new Promise(r => setTimeout(r, 500));
  console.log(chalk.gray('  → 阶段3完成：报告生成'));
  return {
    steps: ['阶段3-报告生成完成'],
    currentPhase: 'finished',
    data: state.data + ' → 报告已生成',
  };
};

// ============================================================
// 构建图（加入 MemorySaver）
// ============================================================

// ⭐ 关键：创建 checkpointer（内存版，生产用 PostgresSaver）
const checkpointer = new MemorySaver();

const workflow = new StateGraph(WorkflowState)
  .addNode('phase1', phase1Node)
  .addNode('phase2', phase2Node)
  .addNode('phase3', phase3Node)
  .addEdge(START, 'phase1')
  .addEdge('phase1', 'phase2')
  .addEdge('phase2', 'phase3')
  .addEdge('phase3', END)
  // ⭐ 关键：compile 时传入 checkpointer
  .compile({ checkpointer });

// ============================================================
// 演示一：正常执行（含自动检查点）
// ============================================================
console.log(chalk.bgBlue.white('\n=== 04-checkpoint.mjs ===\n'));
console.log(chalk.bgYellow.black('【演示1】正常执行，每个节点都会自动保存状态快照'));

// ⭐ 关键：thread_id 就是任务 ID，相同 thread_id → 同一个任务实例
const taskConfig = { configurable: { thread_id: 'task-001' } };

const result1 = await workflow.invoke({}, taskConfig);
console.log(chalk.green('\n✅ 任务完成'));
console.log('  执行步骤：', result1.steps);
console.log('  最终数据：', result1.data);

// ============================================================
// 演示二：查看检查点状态（等价于"查询任务历史"）
// ============================================================
console.log(chalk.bgYellow.black('\n【演示2】查看保存的检查点状态（生产中对应数据库查询）'));

const savedState = await workflow.getState(taskConfig);
console.log('  当前阶段：', savedState.values.currentPhase);
console.log('  执行步骤数：', savedState.values.steps.length);
console.log('  下一个节点：', savedState.next.length > 0 ? savedState.next : '已完成');

// ============================================================
// 演示三：不同 thread_id = 不同任务实例（互不干扰）
// ============================================================
console.log(chalk.bgYellow.black('\n【演示3】新任务（不同 thread_id），从头开始'));

const task2Config = { configurable: { thread_id: 'task-002' } };
const result2 = await workflow.invoke({}, task2Config);
console.log('  任务002步骤：', result2.steps.length, '个');

// ============================================================
// 演示四：获取历史快照列表
// ============================================================
console.log(chalk.bgYellow.black('\n【演示4】获取任务001的所有历史快照（时间旅行调试）'));

let snapshotCount = 0;
for await (const snapshot of workflow.getStateHistory(taskConfig)) {
  snapshotCount++;
  if (snapshotCount <= 5) {  // 只显示前5个
    console.log(chalk.gray(`  快照${snapshotCount}：阶段=${snapshot.values.currentPhase}, 步骤数=${snapshot.values.steps?.length ?? 0}`));
  }
}
console.log(chalk.gray(`  共 ${snapshotCount} 个快照（每个节点执行前后各一个）`));

/**
 * 理解要点：
 * 1. MemorySaver 在每个节点执行前后自动保存完整状态快照
 * 2. thread_id 是任务的唯一身份标识，对应数据库中的 task.id
 * 3. 生产中用 PostgresSaver 替换 MemorySaver，状态存入数据库
 * 4. getStateHistory 可以"回放"整个执行过程，等于免费获得审计日志
 *
 * 与任务系统的关系：
 * - Checkpoint 状态 ≈ TaskStepRun 表（每步执行记录）
 * - thread_id ≈ Task.id
 * - getState() ≈ 查询当前任务状态
 */
