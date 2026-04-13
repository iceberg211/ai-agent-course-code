# Mini-Manus：HITL + Guardrails 设计方案

**日期：** 2026-04-13  
**范围：** `mini-manus/backend` + `mini-manus/frontend`  
**状态：** 已审批，待实现

---

## 1. 目标

在现有单 Agent 系统上增加两项能力：

1. **Human-in-the-Loop（HITL）**：用户可按任务配置审批模式，Agent 在执行前暂停等待人工确认，支持审批/拒绝后继续或终止。
2. **Guardrails as RunnableSequence**：将现有分散的安全检查封装为 LangChain `RunnableSequence`，使 Guardrail 成为可组合、可测试的链节点。

两项改动均不推翻现有 `task → revision → run → plan → step_run → artifact` 数据模型，也不改变主图拓扑（planner → executor → evaluator → finalizer）。

---

## 2. HITL 设计

### 2.1 审批模式

新增枚举，跟随 run 全程：

```typescript
type ApprovalMode = 'none' | 'side_effects' | 'all_steps';
```

| 模式 | 触发时机 |
|------|---------|
| `none` | 不暂停，当前默认行为 |
| `side_effects` | 仅在 `side-effect` 类型步骤执行前暂停 |
| `all_steps` | 每个步骤执行前都暂停 |

### 2.2 数据模型变更

**`task_runs` 表新增两列：**

| 列名 | 类型 | 说明 |
|------|------|------|
| `approval_mode` | `varchar` | `'none'` / `'side_effects'` / `'all_steps'` |
| `pending_approval_step` | `jsonb` | 当前待审批步骤信息，审批后清空 |

**`RunStatus` 枚举新增：**

```typescript
AWAITING_APPROVAL = 'awaiting_approval'
```

### 2.3 图层变更

**checkpointer 注入：**

```typescript
// agent.service.ts
private readonly checkpointer = new MemorySaver();

const compiled = graph.compile({ checkpointer: this.checkpointer });
```

> ⚠️ `MemorySaver` 是进程内存存储，服务重启后暂停中的 run 无法恢复。重启时应将所有 `AWAITING_APPROVAL` 状态的 run 标记为 `FAILED`（errorMessage: `'server_restart'`）。生产环境可替换为 PostgreSQL checkpointer。

**`AgentState` 新增字段：**

```typescript
approvalMode: Annotation<ApprovalMode>({ reducer: (_, b) => b, default: () => 'none' })
```

**executor 节点插入 interrupt 判断：**

```typescript
// executor.node.ts，在 tool/skill 调用前
const isSideEffect = /* tool.type === 'side-effect' || skill.effect === 'side-effect' */;
const shouldPause =
  state.approvalMode === 'all_steps' ||
  (state.approvalMode === 'side_effects' && isSideEffect);

if (shouldPause) {
  interrupt({
    stepIndex: state.currentStepIndex,
    description: currentStep.description,
    isSideEffect,
    toolOrSkill: currentStep.toolHint ?? currentStep.skillName,
  });
  // 执行暂停；resume 时收到 'approved' | 'rejected'
}
```

`interrupt()` 的返回值（`'approved'` / `'rejected'`）在 resume 后由节点读取，若为 `'rejected'` 则直接返回 `{ shouldStop: true, errorMessage: 'step_rejected' }`。

### 2.4 executeRun 变为循环

```typescript
async executeRun(run: TaskRun, revision: TaskRevision): Promise<void> {
  const config = { configurable: { thread_id: run.id } };
  let input: AgentState | Command = buildInitialState(run, revision);

  while (true) {
    const result = await this.compiled.invoke(input, config);
    
    if (!result.__interrupt__?.length) break; // 正常完成或已终止

    const interruptValue = result.__interrupt__[0].value;
    await this.callbacks.setRunAwaitingApproval(run.id, interruptValue);
    this.eventPublisher.emit(TASK_EVENTS.RUN_AWAITING_APPROVAL, {
      taskId: run.taskId,
      runId: run.id,
      ...interruptValue,
    });

    const approved = await this.waitForApproval(run.id); // 阻塞等待
    input = new Command({ resume: approved ? 'approved' : 'rejected' });
  }
}
```

### 2.5 审批等待机制

`AgentService` 内维护一个 Promise map：

```typescript
private approvalMap = new Map<string, {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
}>();

private waitForApproval(runId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    this.approvalMap.set(runId, { resolve, reject });
    setTimeout(
      () => reject(new Error('approval_timeout')),
      this.approvalTimeoutMs,
    );
  });
}

resolveApproval(runId: string, approved: boolean): void {
  const entry = this.approvalMap.get(runId);
  if (!entry) throw new NotFoundException('没有待审批的步骤');
  this.approvalMap.delete(runId);
  entry.resolve(approved);
}
```

### 2.6 新增 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/tasks/:taskId/runs/:runId/approve` | 审批通过，继续执行 |
| `POST` | `/tasks/:taskId/runs/:runId/reject` | 拒绝，终止 run |

两个端点均受现有 `ApiKeyGuard` 保护。

**请求体（可选）：**

```typescript
class ApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string; // 用于记录审批原因
}
```

### 2.7 新增事件

| 事件名 | payload |
|--------|---------|
| `run.awaiting_approval` | `{ taskId, runId, stepIndex, description, isSideEffect, toolOrSkill }` |

### 2.8 服务重启恢复

`AgentModule.onModuleInit` 中，将所有 `AWAITING_APPROVAL` 状态的 run 标记为 `FAILED`：

```typescript
// 现有逻辑已处理 RUNNING → FAILED，同理扩展到 AWAITING_APPROVAL
await this.taskService.failStaleRuns(['running', 'awaiting_approval'], 'server_restart');
```

### 2.9 新增环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `APPROVAL_TIMEOUT_MS` | `600000` | 审批超时时间（ms），默认 10 分钟 |

### 2.10 前端变更

1. `CreateTaskDto` 暴露 `approvalMode` 字段，任务创建表单增加选择器（默认 `none`）
2. `RunStatus.AWAITING_APPROVAL` 处理：运行状态标记为"等待审批"
3. 时间线区域：收到 `run.awaiting_approval` 事件后，在当前步骤下方渲染审批面板：
   - 显示步骤描述、工具/Skill 名称、是否有副作用
   - **审批** / **拒绝** 两个按钮
   - 调用对应 API 后禁用按钮，等待下一个事件

---

## 3. Guardrails 设计

### 3.1 文件结构

```
agent/
  guardrails/
    guardrail.chain.ts      # 核心链定义
    guardrail-blocked.error.ts  # 错误类型
```

### 3.2 核心链

`inputGuardrail` 已移除：用户输入已在 HTTP 层（`task.service.ts`）完成注入检测，LLM 调用链内不重复处理。

```typescript
// guardrail.chain.ts
// 只保留输出 Guardrail，防止 LLM 在 plan 中写出被诱导的注入内容

export const outputGuardrail = RunnableLambda.from(
  (plan: { steps: Array<{ description?: string }> }) => {
    for (const step of plan.steps ?? []) {
      const risk = detectInjection(step.description ?? '');
      if (risk) throw new GuardrailBlockedError('plan_injection', risk);
    }
    return plan;
  }
).withConfig({ runName: 'OutputGuardrail' });

export const buildGuardedPlannerChain = (plannerLlmChain: Runnable) =>
  RunnableSequence.from([plannerLlmChain, outputGuardrail]);
```

### 3.3 错误类型

```typescript
// guardrail-blocked.error.ts
export class GuardrailBlockedError extends Error {
  constructor(
    public readonly reason: 'input_injection' | 'plan_injection',
    public readonly detail: string,
  ) {
    super(`Guardrail blocked: ${reason}`);
  }
}
```

### 3.4 planner.node.ts 改动

`planner.node.ts` 内部现有的 LLM 调用部分（`plannerPrompt.pipe(llm).withStructuredOutput(...)`）被替换为 `buildGuardedPlannerChain(plannerLlmChain)`。

语义校验器（`plan-semantic-validator.ts`）保持不变，仍在 Guardrail 链之后运行。

完整执行顺序：

```
inputGuardrail → plannerLLM → outputGuardrail → semanticValidator
```

`GuardrailBlockedError` 在 planner 节点中被捕获，直接将 run 标记为 `FAILED`（不走 retry/replan），并返回：

```typescript
{ shouldStop: true, errorMessage: `guardrail_blocked:${error.reason}` }
```

### 3.5 现有代码关系

| 现有文件 | 变化 |
|---------|------|
| `common/utils/prompt-safety.ts` | 不删除，Guardrail 链直接调用其函数 |
| `tool/utils/url-safety.ts` | 不变，工具层保持自己的 SSRF 防护 |
| `agent/plan-semantic-validator.ts` | 不变，结构校验保持在 Guardrail 链之后 |

---

## 4. 影响链路分析

| 链路 | 是否受影响 | 说明 |
|------|-----------|------|
| `task → revision → run` | 是 | `task_runs` 新增两列，`RunStatus` 新增枚举值 |
| `planner → executor → evaluator → finalizer` | 是 | executor 增加 interrupt 判断；planner 使用 GuardedPlannerChain |
| 实时事件 | 是 | 新增 `run.awaiting_approval` 事件 |
| artifact 展示 | 否 | 不影响 |
| 工具与 Skill 注册 | 否 | 不影响 |
| Workspace 清理 | 否 | 不影响 |

---

## 5. 风险点

1. **MemorySaver 进程内存**：服务重启丢失暂停状态，已通过 onModuleInit 恢复逻辑缓解。
2. **审批超时**：长时间无人审批会占用 `approvalMap` 内存，已通过 `APPROVAL_TIMEOUT_MS` 限制。
3. **并发 run 同一 task**：现有悲观锁已保护 `startRun`，HITL 不改变这一逻辑。
4. **interrupt 与 cancel 并发**：run 处于 `AWAITING_APPROVAL` 时用户也可以调用 cancel；cancel 应调用 `resolveApproval(runId, false)` 触发拒绝流程，而不是直接写 DB。
5. **GuardrailBlockedError 不走 retry**：injection 检测到意味着输入有问题，重试没有意义，直接 fail 是正确行为。

---

## 6. 验证方式

| 场景 | 验证方法 |
|------|---------|
| `approvalMode: 'none'` | 行为与现有完全一致，所有现有测试通过 |
| `approvalMode: 'side_effects'` | 创建含 `write_file` 步骤的任务，确认在执行前暂停并发出事件 |
| `approvalMode: 'all_steps'` | 确认每个步骤都暂停 |
| 审批通过 | 调用 `/approve`，run 继续执行 |
| 审批拒绝 | 调用 `/reject`，run 状态变为 `FAILED`，errorMessage 为 `step_rejected` |
| 审批超时 | 修改 `APPROVAL_TIMEOUT_MS=5000`，等待超时，run 变为 `FAILED` |
| cancel 覆盖 HITL | run 处于 `AWAITING_APPROVAL` 时调用 cancel，run 正确终止 |
| 输入注入 | 提交含 `Ignore previous instructions` 的任务，run 以 `guardrail_blocked:input_injection` 失败 |
| 计划注入 | mock LLM 返回含注入内容的计划描述，run 以 `guardrail_blocked:plan_injection` 失败 |

---

## 7. 不在本次范围内

- PostgreSQL checkpointer（MemorySaver 已足够课程演示）
- 节点级 Guardrail（evaluator/finalizer 暂不加 outputGuardrail）
- 浏览器交互工具的 HITL 集成（下一阶段）
- 审批历史记录表
