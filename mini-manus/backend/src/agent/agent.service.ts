import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { InMemoryCache } from '@langchain/core/caches';
import {
  StateGraph,
  END,
  START,
  MemorySaver,
  Command,
  InMemoryStore,
} from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ApprovalMode } from '@/common/enums';
import { AgentStateAnnotation, AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { EventPublisher } from '@/event/event.publisher';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { routerNode } from '@/agent/nodes/router.node';
import { plannerNode } from '@/agent/nodes/planner.node';
import { executorNode } from '@/agent/nodes/executor.node';
import { evaluatorNode } from '@/agent/nodes/evaluator.node';
import { finalizerNode } from '@/agent/nodes/finalizer.node';
import { RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';
import { TokenBudgetGuard } from '@/agent/token-budget.guard';
import { PlanSemanticValidationOptions } from '@/agent/plan-semantic-validator';

/** 主流模型价格表（USD / 1M tokens）。未收录的模型不估算成本。 */
const MODEL_PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  'gpt-4o': { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
  'qwen-plus': { inputPerMillion: 0.4, outputPerMillion: 1.2 },
  'qwen-max': { inputPerMillion: 1.6, outputPerMillion: 4.8 },
  'qwen-turbo': { inputPerMillion: 0.05, outputPerMillion: 0.2 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

function estimateCostUsd(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

function readBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readCleanString(
  value: string | undefined,
  defaultValue: string,
): string {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : defaultValue;
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly llm: ChatOpenAI;
  private readonly modelName: string;
  private readonly maxRetries: number;
  private readonly maxReplans: number;
  private readonly maxSteps: number;
  private readonly stepTimeoutMs: number;
  private readonly skillTimeoutMs: number;
  private readonly tokenBudget: number;
  private readonly exportPdfEnabled: boolean;
  private readonly planValidationOptions: PlanSemanticValidationOptions;
  private readonly approvalTimeoutMs: number;
  // LangGraph checkpointer — 进程内存存储，重启后失效（生产可替换为 PostgreSQL checkpointer）
  private readonly checkpointer = new MemorySaver();
  // LangGraph Store — 跨 Run 持久化 key-value 存储（生产可替换为 PostgresStore）
  private readonly store = new InMemoryStore();
  // 待审批的 promise resolvers，key = runId
  private readonly approvalMap = new Map<
    string,
    { resolve: (approved: boolean) => void; reject: (err: Error) => void }
  >();
  /**
   * 结构化输出方式：
   * - 'functionCalling'  通用，兼容 Qwen / Ollama / Azure 等
   * - 'json_schema'      OpenAI 原生 Structured Outputs，更严格但仅 gpt-4o 支持完整
   * - 'jsonMode'         response_format=json_object，最宽松，适合不支持函数调用的模型
   *
   * 通过 STRUCTURED_OUTPUT_METHOD 环境变量覆盖，默认 functionCalling。
   */
  readonly structuredOutputMethod:
    | 'functionCalling'
    | 'json_schema'
    | 'jsonMode';

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly workspace: WorkspaceService,
    private readonly eventPublisher: EventPublisher,
    private readonly browserSessions: BrowserSessionService,
  ) {
    const llmCacheEnabled = readBoolean(
      config.get<string>('LLM_CACHE_ENABLED'),
      true,
    );
    this.modelName = readCleanString(
      config.get<string>('MODEL_NAME'),
      'gpt-4o-mini',
    );
    this.llm = new ChatOpenAI({
      modelName: this.modelName,
      apiKey: readCleanString(config.get<string>('OPENAI_API_KEY'), ''),
      configuration: {
        baseURL: config.get<string>('OPENAI_BASE_URL')?.trim(),
      },
      temperature: 0,
      cache: llmCacheEnabled ? new InMemoryCache() : undefined,
    });
    this.maxRetries = config.get<number>('MAX_RETRIES', 3);
    this.maxReplans = config.get<number>('MAX_REPLANS', 2);
    this.maxSteps = config.get<number>('MAX_STEPS', 20);
    this.tokenBudget = config.get<number>('TOKEN_BUDGET', 100_000);
    const plannerMaxSteps = config.get<number>('PLANNER_MAX_STEPS', 8);
    this.planValidationOptions = {
      maxSteps: Math.min(plannerMaxSteps, this.maxSteps),
      allowedSideEffectTools: readCsv(
        config.get<string>(
          'PLANNER_ALLOWED_SIDE_EFFECT_TOOLS',
          'write_file,download_file,export_pdf,browser_screenshot,browser_click,browser_type,sandbox_run_node,sandbox_run_python',
        ),
      ),
      allowedSideEffectSkills: readCsv(
        config.get<string>(
          'PLANNER_ALLOWED_SIDE_EFFECT_SKILLS',
          'document_writing,report_packaging,code_project_generation',
        ),
      ),
    };
    this.stepTimeoutMs = config.get<number>('STEP_TIMEOUT_MS', 180_000);
    // Skill 超时独立配置：skill 包含多次网络调用 + LLM 综合，需要更长时间
    this.skillTimeoutMs = config.get<number>('SKILL_TIMEOUT_MS', 300_000);
    this.exportPdfEnabled = readBoolean(
      config.get<string>('EXPORT_PDF_ENABLED'),
      false,
    );

    const raw = config
      .get<string>('STRUCTURED_OUTPUT_METHOD', 'functionCalling')
      .trim();
    this.structuredOutputMethod = (
      ['functionCalling', 'json_schema', 'jsonMode'].includes(raw)
        ? raw
        : 'functionCalling'
    ) as this['structuredOutputMethod'];

    this.approvalTimeoutMs = config.get<number>('APPROVAL_TIMEOUT_MS', 600_000);
    this.logger.log(`Structured output method: ${this.structuredOutputMethod}`);

    // 设置工具可用性检查器，让 Planner 只看到实际可用的工具
    const tavilyKey = config.get<string>('TAVILY_API_KEY', '');
    const sandboxEnabled = readBoolean(
      config.get<string>('SANDBOX_ENABLED'),
      false,
    );
    const browserEnabled = readBoolean(
      config.get<string>('BROWSER_AUTOMATION_ENABLED'),
      false,
    );
    toolRegistry.setAvailabilityChecker((req) => {
      if (req === 'tavily_api') return !!tavilyKey;
      if (req === 'docker') return sandboxEnabled;
      if (req === 'playwright') return browserEnabled;
      return true;
    });
  }

  async executeRun(
    taskId: string,
    runId: string,
    revisionInput: string,
    callbacks: AgentCallbacks,
    signal: AbortSignal,
    approvalMode: ApprovalMode = 'none',
  ): Promise<void> {
    const llm = this.llm;
    const toolRegistry = this.toolRegistry;
    const skillRegistry = this.skillRegistry;
    const workspace = this.workspace;
    const eventPublisher = this.eventPublisher;
    const soMethod = this.structuredOutputMethod;
    const tokenTracker = new TokenTrackerCallback();
    const tokenBudgetGuard = new TokenBudgetGuard(
      tokenTracker,
      this.tokenBudget,
      () =>
        estimateCostUsd(
          this.modelName,
          tokenTracker.inputTokens,
          tokenTracker.outputTokens,
        ),
    );

    // Build StateGraph
    // P24：每个节点调用前/后通过 tokenTracker 标记节点名，
    // handleLLMEnd 会把 token 用量记入对应节点的 nodeUsages。
    const trackNode = async <T>(
      nodeName: string,
      runNode: () => Promise<T>,
    ): Promise<T> => {
      tokenTracker.setCurrentNode(nodeName);
      try {
        return await runNode();
      } finally {
        tokenTracker.clearCurrentNode();
      }
    };

    const graph = new StateGraph(AgentStateAnnotation)
      .addNode('router', async (state: AgentState, config: RunnableConfig) => {
        return trackNode('router', () =>
          routerNode(state, llm, eventPublisher, soMethod),
        );
      })
      .addNode('planner', async (state: AgentState, config: RunnableConfig) => {
        // 注入最新的 token 用量，让 planner 感知剩余预算
        const stateWithBudget = {
          ...state,
          usedTokens: tokenTracker.totalTokens,
          tokenBudget: this.tokenBudget,
        };
        return trackNode('planner', () =>
          plannerNode(
            stateWithBudget,
            config,
            llm,
            skillRegistry,
            toolRegistry,
            callbacks,
            eventPublisher,
            soMethod,
            this.planValidationOptions,
          ),
        );
      })
      .addNode('executor', async (state: AgentState, config: RunnableConfig) => {
        // executor 内部 Tool Calling 用 'executor:tool_calling' 标签
        return trackNode('executor:tool_calling', () =>
          executorNode(
            state,
            llm,
            toolRegistry,
            skillRegistry,
            workspace,
            callbacks,
            eventPublisher,
            signal,
            this.stepTimeoutMs,
            this.skillTimeoutMs,
            soMethod,
          ),
        );
      })
      .addNode('evaluator', async (state: AgentState, config: RunnableConfig) => {
        return trackNode('evaluator', () =>
          evaluatorNode(
            state,
            llm,
            callbacks,
            eventPublisher,
            soMethod,
            this.maxRetries,
            this.maxReplans,
            tokenBudgetGuard,
          ),
        );
      })
      .addNode('finalizer', async (state: AgentState, config: RunnableConfig) => {
        return trackNode('finalizer', () =>
          finalizerNode(
            state,
            config,
            llm,
            callbacks,
            eventPublisher,
            this.exportPdfEnabled,
            soMethod,
            tokenBudgetGuard,
          ),
        );
      })
      .addEdge(START, 'router')
      .addEdge('router', 'planner')
      .addEdge('planner', 'executor')
      .addEdge('executor', 'evaluator')
      .addConditionalEdges('evaluator', (state: AgentState) => {
        if (state.shouldStop) return END;
        const eval_ = state.evaluation;
        if (!eval_) return 'executor';

        if (eval_.decision === 'complete') return 'finalizer';
        if (eval_.decision === 'fail') return END;

        if (eval_.decision === 'retry') {
          if (state.retryCount >= this.maxRetries) return END;
          return 'executor';
        }
        if (eval_.decision === 'replan') {
          if (state.replanCount >= this.maxReplans) return END;
          return 'planner';
        }
        // continue: evaluator 已经把 currentStepIndex +1 写回 state，
        // 这里直接判断是否越界，不再二次 +1
        const totalSteps = state.currentPlan?.steps.length ?? 0;
        if (
          state.currentStepIndex >= totalSteps ||
          state.executionOrder >= this.maxSteps
        )
          return 'finalizer';
        return 'executor';
      })
      .addEdge('finalizer', END);

    // MemorySaver checkpointer 支持 HITL interrupt/resume
    // InMemoryStore 支持跨 Run 记忆持久化（生产可替换为 PostgresStore）
    const compiled = graph.compile({
      checkpointer: this.checkpointer,
      store: this.store,
    });
    const graphConfig = {
      configurable: { thread_id: runId },
    };

    const initialState: Partial<AgentState> = {
      taskId,
      runId,
      revisionInput,
      approvalMode,
      currentPlan: null,
      currentStepIndex: 0,
      stepResults: [],
      replanCount: 0,
      retryCount: 0,
      evaluation: null,
      executionOrder: 0,
      shouldStop: false,
      errorMessage: null,
    };

    eventPublisher.emit(TASK_EVENTS.RUN_STARTED, { taskId, runId });
    await callbacks.setRunStatus(runId, RunStatus.RUNNING);

    try {
      // ─── HITL while 循环 ────────────────────────────────────────────────────
      // 每次 interrupt() 后暂停，等待外部 resume（approved/rejected），
      // 再以 Command 重新 invoke，直到图执行完成或终止
      let invokeInput: Partial<AgentState> | Command = initialState;

      while (true) {
        const result = await compiled.invoke(invokeInput as any, {
          ...graphConfig,
          callbacks: [tokenTracker],
        });

        // 检查是否有 interrupt 待处理
        const interrupts = (result as Record<string, unknown>)[
          '__interrupt__'
        ] as Array<{ value: Record<string, unknown> }> | undefined;

        if (!interrupts?.length) {
          // 图已正常结束，result 是 finalState
          const finalState = result;

          // 检测因重试/重规划/fail 耗尽而退出的情况：
          const decision = finalState.evaluation?.decision;
          const isExhausted =
            decision === 'fail' ||
            (decision === 'retry' &&
              finalState.retryCount >= this.maxRetries) ||
            (decision === 'replan' &&
              finalState.replanCount >= this.maxReplans);

          if (
            finalState.shouldStop ||
            finalState.errorMessage === 'cancelled'
          ) {
            await callbacks.setRunStatus(runId, RunStatus.CANCELLED);
            eventPublisher.emit(TASK_EVENTS.RUN_CANCELLED, { taskId, runId });
          } else if (finalState.errorMessage || isExhausted) {
            const msg =
              finalState.errorMessage ??
              finalState.evaluation?.reason ??
              (decision === 'retry'
                ? `重试次数已耗尽（上限 ${this.maxRetries}）`
                : decision === 'replan'
                  ? `重规划次数已耗尽（上限 ${this.maxReplans}）`
                  : '任务执行失败');
            await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
            eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
              taskId,
              runId,
              error: msg,
              errorCode: finalState.evaluation?.errorCode ?? null,
              metadata: finalState.evaluation?.metadata ?? null,
            });
          } else {
            await callbacks.setRunStatus(runId, RunStatus.COMPLETED);
            eventPublisher.emit(TASK_EVENTS.RUN_COMPLETED, { taskId, runId });
          }
          break; // while 循环正常结束
        }

        // ─── 有 interrupt：等待人工审批 ───────────────────────────────────
        const interruptValue = interrupts[0].value;
        await callbacks.setRunAwaitingApproval(runId, interruptValue);
        eventPublisher.emit(TASK_EVENTS.RUN_AWAITING_APPROVAL, {
          taskId,
          runId,
          ...interruptValue,
        });

        let approved: boolean;
        try {
          approved = await this.waitForApproval(runId);
        } catch {
          // 超时或被 cancel 触发 reject
          await callbacks.setRunStatus(
            runId,
            RunStatus.FAILED,
            'approval_timeout',
          );
          eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
            taskId,
            runId,
            error: 'approval_timeout',
          });
          break;
        }

        invokeInput = new Command({
          resume: approved ? 'approved' : 'rejected',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runId} failed with error: ${msg}`);
      await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
      eventPublisher.emit(TASK_EVENTS.RUN_FAILED, {
        taskId,
        runId,
        error: msg,
      });
    } finally {
      // 持久化 token 统计 + 推送实时事件
      const estimatedCostUsd = estimateCostUsd(
        this.modelName,
        tokenTracker.inputTokens,
        tokenTracker.outputTokens,
      );
      if (tokenTracker.totalTokens > 0) {
        this.logger.log(
          `Run ${runId} token usage — in: ${tokenTracker.inputTokens}, out: ${tokenTracker.outputTokens}, total: ${tokenTracker.totalTokens}${estimatedCostUsd != null ? `, cost: $${estimatedCostUsd.toFixed(6)}` : ''}`,
        );
        eventPublisher.emit(TASK_EVENTS.RUN_TOKEN_USAGE, {
          taskId,
          runId,
          inputTokens: tokenTracker.inputTokens,
          outputTokens: tokenTracker.outputTokens,
          totalTokens: tokenTracker.totalTokens,
          estimatedCostUsd,
          modelName: this.modelName,
        });
      }
      // 持久化到 task_runs（失败不阻塞 finalize）。即便 token 为 0，也记录 model_name。
      try {
        await callbacks.saveTokenUsage(runId, {
          inputTokens: tokenTracker.inputTokens,
          outputTokens: tokenTracker.outputTokens,
          totalTokens: tokenTracker.totalTokens,
          estimatedCostUsd,
          modelName: this.modelName,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to save token usage for run ${runId}: ${String(err)}`,
        );
      }
      // P24：保存节点级 LLM 明细
      if (tokenTracker.nodeUsages.length > 0) {
        try {
          await callbacks.saveLlmCallLogs(
            runId,
            this.modelName,
            tokenTracker.nodeUsages.map((u) => ({
              ...u,
              estimatedCostUsd: estimateCostUsd(this.modelName, u.inputTokens, u.outputTokens),
            })),
          );
        } catch (err) {
          this.logger.warn(`Failed to save llm_call_logs for run ${runId}: ${String(err)}`);
        }
      }
      try {
        await this.browserSessions.closeRun(runId);
      } catch (err) {
        this.logger.warn(
          `Failed to close browser sessions for run ${runId}: ${String(err)}`,
        );
      }
      await callbacks.finalize(taskId);
    }
  }

  /**
   * 审批通过或拒绝。由 TaskController 的 /approve 和 /reject 端点调用。
   * cancel 时也应调用此方法（approved=false），避免 approvalMap 泄漏。
   */
  resolveApproval(runId: string, approved: boolean): void {
    const entry = this.approvalMap.get(runId);
    if (!entry) throw new NotFoundException(`运行 ${runId} 没有待审批的步骤`);
    this.approvalMap.delete(runId);
    entry.resolve(approved);
  }

  private waitForApproval(runId: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.approvalMap.set(runId, { resolve, reject });
      setTimeout(() => {
        this.approvalMap.delete(runId); // 防止 entry 泄漏
        reject(new Error('approval_timeout'));
      }, this.approvalTimeoutMs);
    });
  }
}
