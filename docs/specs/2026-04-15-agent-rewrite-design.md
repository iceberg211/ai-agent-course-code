# Mini-Manus Agent 重写设计方案

**日期：** 2026-04-15  
**范围：** `mini-manus/backend/src/agent/`  
**状态：** 草稿，待评审

---

## 1. 问题诊断

当前架构难以维护的根本原因，不是功能复杂，而是**职责混乱**。

### 1.1 节点职责混乱

| 节点 | 应有职责 | 实际在做 |
|------|---------|---------|
| `evaluator` | 决策：continue/retry/replan/complete/fail | 决策 + 写 StepResult 回 state + 更新 step_run 终态 + 发事件 |
| `executor` | 执行一个步骤，返回原始输出 | 执行 + 处理 SubAgent 黑盒 + 处理 HITL interrupt + 管理超时 |
| `finalizer` | 汇总结果，生成产物 | 汇总 + 读 resultSummary（曾是 evaluator 理由，而非工具输出）|

evaluator 的 `applyDecision` 函数做了 5 件事：发调试事件、更新 step_run 终态、发步骤状态事件、构建 StepResult、决定 state 更新。一个函数承载了数据管道和控制流两种完全不同的关注点。

### 1.2 数据流污染

```
工具原始输出
  → executor 写入 lastStepOutput
  → evaluator 决策
  → evaluator 写 StepResult.resultSummary = lastStepOutput ✅（已修复）
  → finalizer 读 s.toolOutput ?? s.resultSummary

历史问题（已修复但说明了脆弱性）：
  StepResult.resultSummary = evaluator.reason  ← LLM 决策理由被当作数据存入
  finalizer 读到的是 evaluator 在说什么，而不是工具返回了什么
```

数据流上有一个"错误注入点"：evaluator 在写数据给 finalizer 用，但它的主职是决策。任何对 evaluator 的改动都可能悄悄破坏 finalizer 的输入。

### 1.3 简单任务被过度编排

```
用户: "今天天气怎么样？"
当前路径：router(1次LLM) → planner(1次LLM) → executor(1次LLM tool-calling)
          → evaluator(1次LLM) → finalizer(2次LLM) = 最少 6 次 LLM 调用
```

`general` 意图下的简单问答和单步操作，不需要计划、不需要多轮评估，但目前和复杂的多步骤研究走同一条管道。

### 1.4 并行研究节点残留状态

`parallelStepOutputs` 在 `fan_in` 节点后从未清空，每次 replan 会累积旧的并行输出。（注：当前代码 `buildResearchSubgraph` 实际上是单步调用，非真正的并行 fan-out，但 state 里的 `parallelStepOutputs` 字段设计暗示了原本的并行意图，现在成了死代码。）

### 1.5 HITL 幂等性脆弱

LangGraph 的 `interrupt()` 在 resume 时重跑整个节点。当前代码中 executor 节点已修复（移除了 `interrupt()` 前的 `setRunAwaitingApproval` 调用），但这个陷阱并不明显，任何后续对 executor 节点的改动都可能重新引入该 bug。

---

## 2. 设计目标

1. **每个节点只做一件事**：节点函数签名直接表达职责
2. **数据流单向、不可混用**：工具原始输出 → state → finalizer，中间没有 LLM 改写
3. **简单任务直通**：`general` 意图的简单问答不走多步骤管道
4. **HITL 结构安全**：HITL 逻辑集中，不散落在业务节点里
5. **可测试性**：每个节点纯函数，可独立单测

---

## 3. 新图拓扑

### 3.1 整体结构

```
                       ┌──────────────────────────────────────────────────┐
                       │                  StateGraph                       │
                       │                                                  │
START → router ──── simple ──→ direct_agent ──────────────────────────→ END
             └── complex ──→ planner ──→ executor ──→ evaluator ─┐
                                 ↑                               │
                                 │ replan                        │ continue / retry
                                 │                               ↓
                                 └──────────────────────── (loop)
                                                                 │ complete
                                                                 ↓
                                                              finalizer ──→ END
```

### 3.2 节点职责重定义

| 节点 | 唯一职责 | 不做的事 |
|------|---------|---------|
| `router` | 分类意图 + 判断简单/复杂 | 不写 DB |
| `direct_agent` | 单次 ReAct LLM 调用（带工具），直接输出 artifact | 不走 plan/evaluate |
| `planner` | 生成计划，写 plan/step_run 记录 | 不执行 |
| `executor` | 执行单个步骤，返回 `lastStepOutput` | 不决策，不写 StepResult |
| `evaluator` | **纯决策**：读 lastStepOutput，返回 decision + reason | 不写 StepResult，不管数据管道 |
| `finalizer` | 汇总所有 `stepResults` 中的 `toolOutput`，生成 artifact | 不决策 |

### 3.3 数据流（重构后）

```
executor 返回:
  { lastStepOutput: string }      ← 仅原始输出，不含任何语义包装

evaluator 返回:
  { evaluation: EvaluationResult } ← 仅决策，不含 StepResult

agent.service.ts（图外层）负责：
  - 检测 __interrupt__（HITL）
  - 把 lastStepOutput 写成 StepResult，追加到 stepResults
  - 更新 step_run 终态 + 发事件

finalizer 读取:
  state.stepResults[i].toolOutput  ← 永远是真实工具输出
```

**关键变化：** StepResult 的创建和 step_run 的终态更新，从 `evaluator.applyDecision` 移到 `agent.service.ts` 中图调用后的后处理逻辑（或一个专用的 `step_committer` 辅助函数）。

---

## 4. 核心改动详情

### 4.1 router 节点：增加 complexity 分类

```typescript
// router 返回新增 complexity 字段
type RouterOutput = {
  taskIntent: TaskIntent;
  complexity: 'simple' | 'complex';
};

// 判断规则（基于意图 + 输入长度，不需要额外 LLM 调用）
function classifyComplexity(intent: TaskIntent, input: string): Complexity {
  const ALWAYS_COMPLEX = new Set(['research_report', 'competitive_analysis', 'code_generation']);
  if (ALWAYS_COMPLEX.has(intent)) return 'complex';
  if (intent === 'general' && input.length < 200) return 'simple';
  return 'complex';
}
```

条件边：
```typescript
.addConditionalEdges('router', (state) =>
  state.complexity === 'simple' ? 'direct_agent' : 'planner'
)
```

### 4.2 direct_agent 节点：简单任务直通

```typescript
// 不走 plan/execute/evaluate 循环
// 直接绑定工具，单次 ReAct 调用
export async function directAgentNode(
  state: AgentState,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<Partial<AgentState>> {
  const tools = toolRegistry.getReadOnlyTools(); // simple 任务只允许 read-only 工具
  const agent = createReactAgent({ llm, tools });
  const result = await agent.invoke({ messages: [{ role: 'user', content: state.revisionInput }] });
  const output = result.messages.at(-1)?.content ?? '';

  // 直接保存 artifact，跳过 finalizer 的多次 LLM 调用
  await callbacks.saveArtifact(state.runId, '直接回答', String(output), ArtifactType.MARKDOWN, {});
  return { shouldStop: false };
}
```

> **设计取舍**：`direct_agent` 不需要 finalizer 的两次 LLM 调用（markdown 生成 + JSON 结构化摘要）。对于简单问答，LLM 的直接输出就是产物。

### 4.3 evaluator 节点：纯决策，返回最小状态

**当前**（applyDecision 做 5 件事）：
```typescript
// applyDecision 里有：发事件、更新 DB、构建 StepResult、决定 state 字段
```

**目标**（evaluator 只返回决策）：
```typescript
export async function evaluatorNode(
  state: AgentState,
  // ...
): Promise<{ evaluation: EvaluationResult }> {  // 只返回 evaluation！
  // 1. cancel 检查
  // 2. token budget 检查
  // 3. 规则前置检查（preChecks）
  // 4. 确定性快通道
  // 5. LLM 评估
  return { evaluation: result };  // 仅此而已
}
```

**StepResult 写入移到 agent.service.ts**：
```typescript
// agent.service.ts，每轮 evaluator 决策后
async function commitStepResult(
  evaluation: EvaluationResult,
  state: AgentState,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<void> {
  const { lastStepRunId, lastStepOutput, currentStepIndex, currentPlan } = state;
  const currentStep = currentPlan?.steps[currentStepIndex];
  
  const isSuccess = !['retry', 'fail'].includes(evaluation.decision);
  await callbacks.updateStepRun(lastStepRunId, {
    status: isSuccess ? StepStatus.COMPLETED : StepStatus.FAILED,
    resultSummary: lastStepOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    errorMessage: isSuccess ? undefined : evaluation.reason,
    completedAt: new Date(),
  });

  const event = isSuccess ? TASK_EVENTS.STEP_COMPLETED : TASK_EVENTS.STEP_FAILED;
  eventPublisher.emit(event, { taskId: state.taskId, runId: state.runId, stepRunId: lastStepRunId });

  // 追加到 stepResults（由外层负责，evaluator 不负责）
  // 通过 Command(update) 或直接构建下一轮 state patch 传入
}
```

> **注意**：这个重构让 evaluatorNode 变成纯函数，但需要在 `agent.service.ts` 中的 HITL while 循环里增加一段后处理逻辑。**职责更清晰，代价是 agent.service.ts 稍重。** 可以把这段逻辑抽成 `step-committer.ts` 避免 agent.service.ts 膨胀。

### 4.4 stepResults 状态管理简化

**当前**：evaluator 的 applyDecision 根据 decision 类型，写不同的 stepResults patch。有 continue / retry / replan / complete 四条路径，逻辑分散。

**目标**：stepResults 只在一个地方追加，就是 `commitStepResult`，和决策无关。

```typescript
// agent.state.ts，StepResult 语义明确化
type StepResult = {
  stepRunId: string;
  description: string;
  toolOutput: string;       // 永远是原始工具/SubAgent 输出，不是 LLM 理由
  executionOrder: number;
};
// 移除 resultSummary 字段（已由 toolOutput 承担，两个字段混用是历史包袱）
```

### 4.5 HITL 结构安全化

当前 HITL 的问题在于：executor 节点内部必须"知道" LangGraph 的 resume 语义，才能避免幂等问题。这是泄漏的抽象。

**目标**：executor 节点本身不调用 `interrupt()`，由一个独立的 `approval_gate` 节点负责。

```
executor → approval_gate → evaluator
               ↓
           interrupt()  ← 只在这里发生
```

```typescript
// approval_gate.node.ts — 只负责 HITL，不做业务逻辑
export function approvalGateNode(state: AgentState): Partial<AgentState> {
  if (!shouldPause(state)) return {};  // 直通
  
  // interrupt() 前无副作用（DB 写入在外层 while 循环处理）
  const decision = interrupt({
    stepIndex: state.currentStepIndex,
    description: state.currentPlan?.steps[state.currentStepIndex]?.description,
    isSideEffect: true,
  });
  
  if (decision === 'rejected') {
    return { shouldStop: true, errorMessage: 'step_rejected' };
  }
  return {};  // approved，继续
}
```

这样 executor 节点完全不知道 HITL 的存在，幂等问题由结构保证，而不是靠注释提醒。

### 4.6 并行研究节点清理

**现状**：`parallelStepOutputs` 字段和 `buildResearchSubgraph` 是独立存在的，`web_research` skill 直接在 executor 节点内走 `researchSubgraph`，`parallelStepOutputs` 字段从未被用到（fan-out 逻辑已被移除但字段未清理）。

**修复**：
1. 删除 `AgentState` 中的 `parallelStepOutputs` 字段
2. `web_research` skill 的 subgraph 保持当前做法（executor 内直接调用），不引入新的 fan-out
3. 若未来需要真正的并行 web_research，再单独设计

---

## 5. 图拓扑变更前后对比

### 当前拓扑
```
START → router → planner → executor → evaluator
                    ↑          ↑         │ retry/continue
                    │ replan   └─────────┘
                    │           complete
                    └──────── finalizer → END
```

### 目标拓扑
```
START → router ──────── simple ──────────────────→ direct_agent → END
                └─── complex ──→ planner → executor → approval_gate → evaluator
                                    ↑                                    │
                                    │ replan              retry/continue │
                                    │                                    │
                                    └────────────────────────────────────┘
                                                         │ complete
                                                         ↓
                                                      finalizer → END
```

**变化点**：
- 新增 `direct_agent` 节点（简单任务直通）
- 新增 `approval_gate` 节点（HITL 结构隔离）
- `evaluator` 节点大幅瘦身（纯决策）
- `stepResults` 管理移到图外层

---

## 6. 不改动的部分

以下内容**保持不变**，减少重写风险：

| 组件 | 原因 |
|------|------|
| 数据模型（task/revision/run/plan/step_run/artifact） | 稳定，不推翻 |
| planner 节点核心逻辑 | 计划生成质量良好 |
| executor 节点的 tool-calling 逻辑 | 动态参数决议已工作 |
| SubAgentEventBridge | 本次 session 已修复 |
| system-limits.ts 常量体系 | 本次 session 已建立 |
| finalizer 节点的产物生成逻辑 | 核心路径正常，不动 |
| 事件系统（EventPublisher / TASK_EVENTS） | 不动 |
| WorkspaceService / ToolRegistry / SkillRegistry | 不动 |
| HITL while 循环（agent.service.ts）| 保留，微调后处理逻辑 |

---

## 7. 实施顺序

按依赖关系从小到大，逐步重构，每步可独立测试：

### 阶段 1：清理（低风险，不改行为）
1. `AgentState` 删除 `parallelStepOutputs`，确认无引用
2. `StepResult` 删除 `resultSummary`，统一使用 `toolOutput`（已修复的语义）
3. `evaluatorNode` 返回值中移除 `lastStepRunId` / `lastStepOutput` 的直接操作，只返回 `{ evaluation }`

### 阶段 2：evaluator 纯决策化（中等风险，行为不变）
1. 新建 `src/agent/step-committer.ts`，承接 applyDecision 中的 DB 写入和事件发送逻辑
2. `agent.service.ts` 在 evaluator 决策后调用 `stepCommitter.commit(evaluation, state)`
3. `evaluatorNode` 移除所有 DB/事件相关代码，变为纯决策函数
4. 单测：`evaluatorNode` 不再需要 mock `callbacks` 和 `eventPublisher`

### 阶段 3：approval_gate 节点（中等风险，改变 HITL 结构）
1. 新建 `src/agent/nodes/approval-gate.node.ts`
2. 从 `executor.node.ts` 中移除 `interrupt()` 相关逻辑
3. 在图中插入 `executor → approval_gate → evaluator`
4. 验证 HITL 在 resume 后 executor 节点不再双写

### 阶段 4：router + direct_agent（最大改动）
1. `router.node.ts` 增加 `complexity` 分类
2. 新建 `src/agent/nodes/direct-agent.node.ts`
3. 图中增加 `router → direct_agent → END` 分支
4. 用几个简单问题验证直通路径

---

## 8. 风险与取舍

| 风险 | 缓解措施 |
|------|---------|
| `stepCommitter` 被调用时序错误（evaluator 返回但尚未 commit） | 在 while 循环中 evaluator 决策后立即同步调用 commit，不异步分叉 |
| `direct_agent` 使用 `createReactAgent` 引入新依赖 | 也可以用 executor 节点的同款 tool-calling 逻辑，不新建 ReAct agent |
| `approval_gate` 节点增加图的节点数 | 可接受，职责清晰比节点数少更重要 |
| 阶段 2 改变了 evaluator 的 state 返回结构 | 条件边路由逻辑在 agent.service.ts 侧调整，不是 evaluator 侧 |
| `StepResult.resultSummary` 删除后某处仍在读取 | 全局 grep `resultSummary` 确认无遗漏引用 |

---

## 9. 验证方案

| 场景 | 验证方式 |
|------|---------|
| 简单问答走 direct_agent | 日志中无 planner/evaluator 调用 |
| 研究报告走 complex 路径 | 日志中有完整 5 节点调用链 |
| evaluator 单测不需要 DB mock | 单测文件中无 callbacks/eventPublisher mock |
| HITL resume 时 executor 不双写 | 审批日志中 `setRunAwaitingApproval` 只调用一次 |
| 产物中 sources 非空（原 bug 验证） | 调研任务完成后 JSON 摘要中 sources 有实际 URL |

---

## 10. 不在本次范围

- 替换 `MemorySaver` 为 `PostgresSaver`（生产级 HITL 持久化，后续单独做）
- Guardrails 体系调整（参考 2026-04-13 文档，不受本次影响）
- 浏览器自动化 / 沙箱执行（功能层，不是架构层问题）
- 前端变更（后端接口不变，前端无需改动）
