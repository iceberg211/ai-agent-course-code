/**
 * 05-human-in-the-loop.mjs
 * ========================
 * 知识点：人工介入（Human-in-the-Loop）
 *
 * 为什么需要人工介入？
 * - Agent 有文件写入、命令执行等危险操作时，需要人确认
 * - 当前计划结果不满意，用户想修改后继续
 * - 某些步骤需要人工提供额外信息
 *
 * 核心 API：
 * - interrupt(value)：在节点中暂停图执行，value 是给用户看的信息
 * - Command({ resume: value })：恢复执行，value 是用户的回应
 *
 * ⚠️ 重要：interrupt() 必须配合 checkpointer 使用，否则无法恢复
 * ⚠️ 重要：不要在 try/catch 里包 interrupt()，否则会破坏机制
 */

import 'dotenv/config';
import { StateGraph, Annotation, START, END, interrupt, Command } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import chalk from 'chalk';

// ============================================================
// 状态定义
// ============================================================
const TaskState = Annotation.Root({
  task: Annotation({ value: (_, r) => r, default: () => '' }),
  plan: Annotation({ value: (_, r) => r, default: () => [] }),
  humanApproval: Annotation({ value: (_, r) => r, default: () => '' }),
  result: Annotation({ value: (_, r) => r, default: () => '' }),
  status: Annotation({ value: (_, r) => r, default: () => 'pending' }),
});

// ============================================================
// 节点定义
// ============================================================

// 节点1：生成计划
const planNode = async (state) => {
  console.log(chalk.cyan('\n  [规划节点] 生成执行计划...'));
  await new Promise(r => setTimeout(r, 200));

  const plan = [
    '步骤1：删除所有临时文件（/tmp/*）',
    '步骤2：清理数据库过期记录',
    '步骤3：重启应用服务',
  ];

  console.log(chalk.yellow('  → 计划已生成（包含危险操作！）：'));
  plan.forEach((s, i) => console.log(chalk.gray(`     ${i + 1}. ${s}`)));

  return { plan, status: 'waiting_approval' };
};

// 节点2：人工确认（⭐ 核心）
const humanApprovalNode = async (state) => {
  console.log(chalk.bgRed.white('\n  [人工确认节点] 检测到危险操作，暂停等待用户确认...'));
  console.log(chalk.yellow('  计划包含以下操作：'));
  state.plan.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));

  // ⭐ interrupt() 暂停图执行
  // 传入的值是给调用者（前端/用户）看的信息
  // interrupt() 会"抛出"一个内部异常，LangGraph 捕获并保存状态
  const userResponse = interrupt({
    message: '以上计划包含危险操作，请确认是否继续执行？',
    plan: state.plan,
    options: ['approve', 'reject', 'modify'],
  });

  // ⚡ 代码执行到这里时已经恢复（用户调用了 Command({resume})）
  // userResponse 就是 Command({resume: value}) 中的 value
  console.log(chalk.green(`\n  [人工确认节点] 用户回应：${userResponse}`));

  if (userResponse === 'approve') {
    return { humanApproval: 'approved', status: 'running' };
  } else if (userResponse === 'reject') {
    return { humanApproval: 'rejected', status: 'cancelled' };
  } else {
    return { humanApproval: 'modified', status: 'running' };
  }
};

// 节点3：执行计划
const executeNode = async (state) => {
  if (state.humanApproval === 'rejected') {
    console.log(chalk.red('\n  [执行节点] 用户拒绝，任务取消'));
    return { result: '任务已取消（用户拒绝）', status: 'cancelled' };
  }

  console.log(chalk.cyan('\n  [执行节点] 开始执行计划...'));
  await new Promise(r => setTimeout(r, 300));

  return {
    result: '所有步骤执行完成（已获用户授权）',
    status: 'succeeded',
  };
};

// ============================================================
// 条件边
// ============================================================
const routeAfterApproval = (state) => {
  if (state.status === 'cancelled') return END;
  return 'execute';
};

// ============================================================
// 构建图（必须加 checkpointer！）
// ============================================================
const checkpointer = new MemorySaver();

const graph = new StateGraph(TaskState)
  .addNode('plan', planNode)
  .addNode('humanApproval', humanApprovalNode)
  .addNode('execute', executeNode)
  .addEdge(START, 'plan')
  .addEdge('plan', 'humanApproval')
  .addConditionalEdges('humanApproval', routeAfterApproval, ['execute', END])
  .addEdge('execute', END)
  .compile({ checkpointer });

// ============================================================
// 演示一：用户批准
// ============================================================
console.log(chalk.bgBlue.white('\n=== 05-human-in-the-loop.mjs ===\n'));
console.log(chalk.bgYellow.black('【场景1】用户批准执行'));

const thread1 = { configurable: { thread_id: 'hitl-001' } };

// 第一次调用：图会跑到 interrupt() 处暂停
console.log('\n📨 发起任务...');
const firstRun = await graph.invoke(
  { task: '执行系统清理任务' },
  thread1
);

// ⭐ 当图因为 interrupt 暂停时，invoke 返回当前状态
// firstRun 包含 interrupt 的信息
console.log(chalk.bgRed.white('\n⏸️  图已暂停，等待用户确认（前端此时显示确认对话框）'));
console.log(chalk.gray('  interrupt payload:', JSON.stringify(firstRun?.tasks?.[0]?.interrupts?.[0]?.value ?? '（已暂停）', null, 2)));

// 模拟用户思考 1 秒后点击"批准"
await new Promise(r => setTimeout(r, 1000));
console.log(chalk.green('\n👤 用户点击：批准'));

// ⭐ 用 Command({resume}) 恢复执行
const finalResult = await graph.invoke(
  new Command({ resume: 'approve' }),
  thread1  // 必须用同一个 thread_id！
);

console.log(chalk.bgGreen.black('\n✅ 任务完成：'), finalResult.result);

// ============================================================
// 演示二：用户拒绝
// ============================================================
console.log(chalk.bgYellow.black('\n\n【场景2】用户拒绝执行'));

const thread2 = { configurable: { thread_id: 'hitl-002' } };

await graph.invoke({ task: '执行系统清理任务' }, thread2);

console.log(chalk.bgRed.white('\n⏸️  图已暂停，等待确认'));
await new Promise(r => setTimeout(r, 500));
console.log(chalk.red('\n👤 用户点击：拒绝'));

const rejected = await graph.invoke(
  new Command({ resume: 'reject' }),
  thread2
);

console.log(chalk.bgRed.black('\n❌ 任务结果：'), rejected.result);

/**
 * 理解要点：
 * 1. interrupt() 让 Agent 不再是"自动无脑跑完"，而是"该停的地方能停"
 * 2. 这是 Demo Agent → 产品级 Agent 的分水岭
 * 3. 生产场景：interrupt 时推送 WebSocket 事件给前端，前端显示确认按钮
 * 4. 用户操作后，前端调用 POST /task/:id/resume，服务端调用 Command({resume})
 * 5. Manus 里的"等待用户确认"就是这个机制
 */
