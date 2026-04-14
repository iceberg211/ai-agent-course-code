import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { InMemoryCache } from '@langchain/core/caches';
import { Command } from '@langchain/langgraph';
import type { ApprovalMode } from '@/common/enums';
import { RunStatus } from '@/common/enums';
import type { AgentState } from '@/agent/agent.state';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { NodeContext } from '@/agent/agent.context';
import { compileAgentGraph, type CompiledAgentGraph } from '@/agent/agent.graph';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { EventPublisher } from '@/event/event.publisher';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { SubAgentRegistry } from '@/agent/subagents/subagent.registry';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';
import { TokenBudgetGuard } from '@/agent/token-budget.guard';
import { TASK_EVENTS } from '@/common/events/task.events';
import type { PlanSemanticValidationOptions } from '@/agent/agent.context';

/** 主流模型价格表（USD / 1M tokens）。未收录的模型不估算成本。 */
const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
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

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readCleanString(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : defaultValue;
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly llm: ChatOpenAI;
  private readonly modelName: string;
  private readonly compiled: CompiledAgentGraph;
  private readonly approvalMap = new Map<
    string,
    { resolve: (approved: boolean) => void; reject: (err: Error) => void }
  >();
  private readonly approvalTimeoutMs: number;
  private readonly tokenBudget: number;
  private readonly sharedConfig: Omit<NodeContext, 'signal' | 'tokenTracker' | 'tokenBudgetGuard' | 'callbacks'>;

  /**
   * 结构化输出方式：
   * - 'functionCalling'  通用，兼容 Qwen / Ollama / Azure 等
   * - 'json_schema'      OpenAI 原生 Structured Outputs，更严格但仅 gpt-4o 支持完整
   * - 'jsonMode'         response_format=json_object，最宽松，适合不支持函数调用的模型
   *
   * 通过 STRUCTURED_OUTPUT_METHOD 环境变量覆盖，默认 functionCalling。
   */
  readonly structuredOutputMethod: 'functionCalling' | 'json_schema' | 'jsonMode';

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly workspace: WorkspaceService,
    private readonly eventPublisher: EventPublisher,
    private readonly browserSessions: BrowserSessionService,
    private readonly subAgentRegistry: SubAgentRegistry,
  ) {
    this.modelName = readCleanString(config.get<string>('MODEL_NAME'), 'gpt-4o-mini');
    this.llm = new ChatOpenAI({
      modelName: this.modelName,
      apiKey: readCleanString(config.get<string>('OPENAI_API_KEY'), ''),
      configuration: { baseURL: config.get<string>('OPENAI_BASE_URL')?.trim() },
      temperature: 0,
      cache: readBoolean(config.get<string>('LLM_CACHE_ENABLED'), true)
        ? new InMemoryCache()
        : undefined,
    });

    const raw = config.get<string>('STRUCTURED_OUTPUT_METHOD', 'functionCalling').trim();
    this.structuredOutputMethod = (
      ['functionCalling', 'json_schema', 'jsonMode'].includes(raw) ? raw : 'functionCalling'
    ) as typeof this.structuredOutputMethod;

    const planValidationOptions: PlanSemanticValidationOptions = {
      maxSteps: Math.min(
        config.get<number>('PLANNER_MAX_STEPS', 8),
        config.get<number>('MAX_STEPS', 20),
      ),
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

    this.tokenBudget = config.get<number>('TOKEN_BUDGET', 100_000);
    this.approvalTimeoutMs = config.get<number>('APPROVAL_TIMEOUT_MS', 600_000);

    this.sharedConfig = {
      llm: this.llm,
      toolRegistry,
      skillRegistry,
      workspace,
      eventPublisher,
      subAgentRegistry,
      soMethod: this.structuredOutputMethod,
      maxRetries: config.get<number>('MAX_RETRIES', 3),
      maxReplans: config.get<number>('MAX_REPLANS', 2),
      maxSteps: config.get<number>('MAX_STEPS', 20),
      stepTimeoutMs: config.get<number>('STEP_TIMEOUT_MS', 180_000),
      skillTimeoutMs: config.get<number>('SKILL_TIMEOUT_MS', 300_000),
      exportPdfEnabled: readBoolean(config.get<string>('EXPORT_PDF_ENABLED'), false),
      planValidationOptions,
    };

    // 设置工具可用性检查器，让 Planner 只看到实际可用的工具
    const tavilyKey = config.get<string>('TAVILY_API_KEY', '');
    const sandboxEnabled = readBoolean(config.get<string>('SANDBOX_ENABLED'), false);
    const browserEnabled = readBoolean(config.get<string>('BROWSER_AUTOMATION_ENABLED'), false);
    toolRegistry.setAvailabilityChecker((req) => {
      if (req === 'tavily_api') return !!tavilyKey;
      if (req === 'docker') return sandboxEnabled;
      if (req === 'playwright') return browserEnabled;
      return true;
    });

    // Compile graph once
    this.compiled = compileAgentGraph();
    this.logger.log(`Agent graph compiled. Model: ${this.modelName}, SO: ${this.structuredOutputMethod}`);
  }

  async executeRun(
    taskId: string,
    runId: string,
    revisionInput: string,
    callbacks: AgentCallbacks,
    signal: AbortSignal,
    approvalMode: ApprovalMode = 'none',
  ): Promise<void> {
    const tokenTracker = new TokenTrackerCallback();
    const tokenBudgetGuard = new TokenBudgetGuard(
      tokenTracker,
      this.tokenBudget,
      () => estimateCostUsd(this.modelName, tokenTracker.inputTokens, tokenTracker.outputTokens),
    );

    const ctx: NodeContext = { ...this.sharedConfig, signal, tokenTracker, tokenBudgetGuard, callbacks };

    const initialState: Partial<AgentState> = {
      taskId,
      runId,
      userInput: revisionInput,
      approvalMode,
      plan: null,
      stepIndex: 0,
      intent: 'general',
      stepResults: [],
      lastStepRunId: '',
      lastOutput: '',
      retryCount: 0,
      replanCount: 0,
      executionOrder: 0,
      error: null,
    };

    this.eventPublisher.emit(TASK_EVENTS.RUN_STARTED, { taskId, runId });
    await callbacks.setRunStatus(runId, RunStatus.RUNNING);

    try {
      // ─── HITL while 循环 ────────────────────────────────────────────────────
      // 每次 interrupt() 后暂停，等待外部 resume（approved/rejected），
      // 再以 Command 重新 invoke，直到图执行完成或终止
      let invokeInput: Partial<AgentState> | Command = initialState;
      const graphConfig = { configurable: { thread_id: runId, ctx }, callbacks: [tokenTracker] };

      while (true) {
        const result = await this.compiled.invoke(invokeInput as any, graphConfig);

        // 检查是否有 interrupt 待处理
        const interrupts = (result as Record<string, unknown>).__interrupt__ as
          Array<{ value: Record<string, unknown> }> | undefined;

        if (!interrupts?.length) {
          // 图已正常结束，result 是 finalState
          const finalState = result as AgentState;
          if (finalState.error === 'cancelled') {
            await callbacks.setRunStatus(runId, RunStatus.CANCELLED);
            this.eventPublisher.emit(TASK_EVENTS.RUN_CANCELLED, { taskId, runId });
          } else if (finalState.error) {
            await callbacks.setRunStatus(runId, RunStatus.FAILED, finalState.error);
            this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: finalState.error });
          } else {
            await callbacks.setRunStatus(runId, RunStatus.COMPLETED);
            this.eventPublisher.emit(TASK_EVENTS.RUN_COMPLETED, { taskId, runId });
          }
          break;
        }

        // ─── 有 interrupt：等待人工审批 ───────────────────────────────────
        const interruptValue = interrupts[0].value;

        // 必须先注册 approvalMap，再写 DB / emit 事件。
        // 原因：setRunAwaitingApproval 将 DB 状态改为 awaiting_approval 后，
        // 前端可能通过轮询立即看到该状态并发起 approve 请求；
        // 若此时 Map 尚未注册就会返回 404。
        const approvalPromise = this.waitForApproval(runId);

        await callbacks.setRunAwaitingApproval(runId, interruptValue);
        this.eventPublisher.emit(TASK_EVENTS.RUN_AWAITING_APPROVAL, {
          taskId,
          runId,
          ...interruptValue,
        });

        let approved: boolean;
        try {
          approved = await approvalPromise;
        } catch {
          // 超时或被 cancel 触发 reject
          await callbacks.setRunStatus(runId, RunStatus.FAILED, 'approval_timeout');
          this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: 'approval_timeout' });
          break;
        }

        invokeInput = new Command({ resume: approved ? 'approved' : 'rejected' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runId} failed with error: ${msg}`);
      await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
      this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: msg });
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
        this.eventPublisher.emit(TASK_EVENTS.RUN_TOKEN_USAGE, {
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
        this.logger.warn(`Failed to save token usage for run ${runId}: ${String(err)}`);
      }
      // 保存节点级 LLM 明细
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
      } catch {}
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
        this.approvalMap.delete(runId);
        reject(new Error('approval_timeout'));
      }, this.approvalTimeoutMs);
    });
  }
}
