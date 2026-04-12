import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Task } from '@/task/entities/task.entity';
import { TaskRevision } from '@/task/entities/task-revision.entity';
import { TaskRun } from '@/task/entities/task-run.entity';
import { TaskPlan } from '@/task/entities/task-plan.entity';
import { PlanStep } from '@/task/entities/plan-step.entity';
import { StepRun } from '@/task/entities/step-run.entity';
import { Artifact } from '@/task/entities/artifact.entity';
import {
  TaskStatus,
  RunStatus,
  StepStatus,
  ArtifactType,
} from '@/common/enums';
import { AgentService } from '@/agent/agent.service';
import { EventPublisher } from '@/event/event.publisher';
import { TASK_EVENTS } from '@/common/events/task.events';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { detectInjection, sanitizeInput } from '@/common/utils/prompt-safety';
import { WorkspaceService } from '@/workspace/workspace.service';

@Injectable()
export class TaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskService.name);
  // Active AbortControllers keyed by runId
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskRevision)
    private readonly revisionRepo: Repository<TaskRevision>,
    @InjectRepository(TaskRun) private readonly runRepo: Repository<TaskRun>,
    @InjectRepository(TaskPlan) private readonly planRepo: Repository<TaskPlan>,
    @InjectRepository(PlanStep)
    private readonly planStepRepo: Repository<PlanStep>,
    @InjectRepository(StepRun)
    private readonly stepRunRepo: Repository<StepRun>,
    @InjectRepository(Artifact)
    private readonly artifactRepo: Repository<Artifact>,
    private readonly dataSource: DataSource,
    private readonly agentService: AgentService,
    private readonly eventPublisher: EventPublisher,
    private readonly workspace: WorkspaceService,
  ) {}

  // ─── Zombie run recovery ────────────────────────────────────────────────
  async onModuleInit() {
    const zombieRuns = await this.runRepo.find({
      where: { status: RunStatus.RUNNING },
    });
    if (zombieRuns.length > 0) {
      this.logger.warn(
        `Found ${zombieRuns.length} zombie run(s), marking as failed`,
      );
      for (const run of zombieRuns) {
        await this.runRepo.update(run.id, {
          status: RunStatus.FAILED,
          errorMessage: '系统意外中止',
          completedAt: new Date(),
        });
        // Update task status if this was the current run
        await this.taskRepo
          .createQueryBuilder()
          .update(Task)
          .set({ status: TaskStatus.FAILED })
          .where('id = :taskId AND current_run_id = :runId', {
            taskId: run.taskId,
            runId: run.id,
          })
          .execute();
      }
    }
  }

  // ─── Graceful shutdown ─────────────────────────────────────────────────
  onModuleDestroy() {
    // SIGTERM 时中止所有正在执行的 run，避免进程退出后留下僵尸状态
    if (this.abortControllers.size > 0) {
      this.logger.warn(
        `Aborting ${this.abortControllers.size} running run(s) on shutdown`,
      );
      for (const [, controller] of this.abortControllers) {
        controller.abort();
      }
      this.abortControllers.clear();
    }
  }

  // ─── Create task + revision + run ───────────────────────────────────────
  async createTask(input: string): Promise<Task> {
    const cleaned = sanitizeInput(input);
    if (detectInjection(cleaned)) {
      throw new BadRequestException('任务描述包含不允许的内容，请修改后重试');
    }
    const title = cleaned.slice(0, 100) + (cleaned.length > 100 ? '...' : '');

    // 事件和 startRun 必须在事务提交后再触发，避免前端在数据未落库时读到空数据
    const { task, revision } = await this.dataSource.transaction(async (em) => {
      const task = em.create(Task, { title, status: TaskStatus.PENDING });
      await em.save(task);

      const revision = em.create(TaskRevision, {
        taskId: task.id,
        version: 1,
        input: cleaned,
      });
      await em.save(revision);

      task.currentRevisionId = revision.id;
      await em.save(task);

      return { task, revision };
    });

    this.eventPublisher.emit(TASK_EVENTS.TASK_CREATED, {
      taskId: task.id,
      title,
    });
    this.eventPublisher.emit(TASK_EVENTS.REVISION_CREATED, {
      taskId: task.id,
      revisionId: revision.id,
      version: 1,
      input: cleaned,
    });
    setImmediate(() => void this.startRun(task.id, revision.id, cleaned));

    return task;
  }

  // ─── Start a new run ────────────────────────────────────────────────────
  async startRun(
    taskId: string,
    revisionId: string,
    revisionInput: string,
  ): Promise<void> {
    const run = await this.dataSource.transaction(async (em) => {
      // 悲观锁：同一 task 的并发 startRun 调用序列化，防止 run_number 冲突
      const task = await em.findOneOrFail(Task, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });

      // Count existing runs under this revision for run_number
      const count = await em.count(TaskRun, { where: { revisionId } });

      const newRun = em.create(TaskRun, {
        taskId,
        revisionId,
        runNumber: count + 1,
        status: RunStatus.PENDING,
        cancelRequested: false,
      });
      await em.save(newRun);

      // Check if a run is already active
      const activeRun = await em.findOne(TaskRun, {
        where: { taskId, status: RunStatus.RUNNING },
      });

      if (!activeRun) {
        // No active run → activate immediately
        newRun.status = RunStatus.RUNNING;
        newRun.startedAt = new Date();
        await em.save(newRun);
        task.status = TaskStatus.RUNNING;
        task.currentRunId = newRun.id;
        await em.save(task);
      }
      // else: stays pending, will be activated by finalize_run

      return newRun;
    });

    if (run.status === RunStatus.RUNNING) {
      void this.executeRun(run.id, taskId, revisionInput);
    }
  }

  private async executeRun(
    runId: string,
    taskId: string,
    revisionInput: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);

    const callbacks: AgentCallbacks = {
      savePlan: async (rId, steps) => {
        const count = await this.planRepo.count({ where: { runId: rId } });
        const plan = this.planRepo.create({ runId: rId, version: count + 1 });
        await this.planRepo.save(plan);
        const planSteps = steps.map((s) =>
          this.planStepRepo.create({
            planId: plan.id,
            stepIndex: s.stepIndex,
            description: s.description,
            skillName: s.skillName ?? null,
            skillInput: s.skillInput ?? null,
            toolHint: s.toolHint ?? null,
            toolInput: s.toolInput ?? null,
          }),
        );
        await this.planStepRepo.save(planSteps);
        plan.steps = planSteps;
        return plan;
      },

      createStepRun: async (rId, planStepRef, executionOrder) => {
        // planStepRef is "planId:stepIndex"
        const [planId, stepIndexStr] = planStepRef.split(':');
        const planStep = await this.planStepRepo.findOneOrFail({
          where: { planId, stepIndex: parseInt(stepIndexStr) },
        });
        const sr = this.stepRunRepo.create({
          runId: rId,
          planStepId: planStep.id,
          executionOrder,
          status: StepStatus.RUNNING,
          startedAt: new Date(),
        });
        return this.stepRunRepo.save(sr);
      },

      updateStepRun: async (srId, updates) => {
        const stepRun = await this.stepRunRepo.findOneOrFail({
          where: { id: srId },
        });
        Object.assign(stepRun, updates);
        await this.stepRunRepo.save(stepRun);
      },

      readCancelFlag: async (rId) => {
        const run = await this.runRepo.findOne({ where: { id: rId } });
        return run?.cancelRequested ?? false;
      },

      setRunStatus: async (rId, status, errorMessage) => {
        const updates: Partial<TaskRun> = { status };
        if (errorMessage) updates.errorMessage = errorMessage;
        if (status !== RunStatus.PENDING && status !== RunStatus.RUNNING) {
          updates.completedAt = new Date();
        }
        const run = await this.runRepo.findOneOrFail({
          where: { id: rId },
        });
        Object.assign(run, updates);
        await this.runRepo.save(run);

        // Update task status only if this is the current run
        const taskStatusMap: Record<string, TaskStatus> = {
          [RunStatus.COMPLETED]: TaskStatus.COMPLETED,
          [RunStatus.FAILED]: TaskStatus.FAILED,
          [RunStatus.CANCELLED]: TaskStatus.CANCELLED,
          [RunStatus.RUNNING]: TaskStatus.RUNNING,
        };
        if (taskStatusMap[status]) {
          await this.taskRepo
            .createQueryBuilder()
            .update(Task)
            .set({ status: taskStatusMap[status] })
            .where('id = :taskId AND current_run_id = :runId', {
              taskId,
              runId: rId,
            })
            .execute();
        }
      },

      saveArtifact: async (rId, title, content, type, metadata) => {
        const artifact = this.artifactRepo.create({
          runId: rId,
          type: type ?? ArtifactType.MARKDOWN,
          title,
          content,
          metadata: metadata ?? null,
        });
        return this.artifactRepo.save(artifact);
      },

      getRecentMemory: async (tId) => {
        // 读取最近 3 次已完成 run 的 JSON 摘要 artifact，供 Planner 参考
        const completedRuns = await this.runRepo.find({
          where: { taskId: tId, status: RunStatus.COMPLETED },
          order: { completedAt: 'DESC' },
          take: 3,
          select: ['id'],
        });
        if (completedRuns.length === 0) return '';

        const runIds = completedRuns.map((r) => r.id);
        const summaries = await this.artifactRepo.find({
          where: { runId: In(runIds), type: ArtifactType.JSON },
          order: { createdAt: 'DESC' },
          take: 3,
          select: ['content', 'createdAt', 'runId'],
        });
        if (summaries.length === 0) return '';

        return summaries
          .map((s, i) => {
            try {
              const json = JSON.parse(s.content) as {
                summary?: string;
                key_points?: string[];
              };
              const date = s.createdAt.toLocaleDateString('zh-CN');
              const keyPoints = (json.key_points ?? []).slice(0, 3).join('、');
              return `历史 Run ${i + 1}（${date}）：${json.summary ?? '无摘要'}${keyPoints ? `\n要点：${keyPoints}` : ''}`;
            } catch {
              return '';
            }
          })
          .filter(Boolean)
          .join('\n\n');
      },

      saveTokenUsage: async (rId, stats) => {
        await this.runRepo.update(rId, {
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.totalTokens,
          estimatedCostUsd: stats.estimatedCostUsd,
        });
      },

      finalize: async (tId) => {
        await this.finalizeRun(tId);
      },
    };

    try {
      await this.agentService.executeRun(
        taskId,
        runId,
        revisionInput,
        callbacks,
        controller.signal,
      );
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  // ─── finalize_run: activate next pending run ─────────────────────────────
  private async finalizeRun(taskId: string): Promise<void> {
    // 事务 + task 行锁，串行化“激活 run”流程，避免并发激活多个 RUNNING
    const next = await this.dataSource.transaction(async (em) => {
      await em.findOneOrFail(Task, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });

      // 并发 retry/startRun 可能已经激活了新的 RUNNING run，这里需要二次校验
      const activeRun = await em.findOne(TaskRun, {
        where: { taskId, status: RunStatus.RUNNING },
      });
      if (activeRun) return null;

      const pendingRuns = await em.find(TaskRun, {
        where: { taskId, status: RunStatus.PENDING },
        order: { createdAt: 'DESC' },
      });

      if (pendingRuns.length === 0) return null;

      const [latest, ...older] = pendingRuns;

      // 取消过期的 pending run（同一 task 下只保留最新）
      for (const r of older) {
        await em.update(TaskRun, r.id, {
          status: RunStatus.CANCELLED,
          errorMessage: '被更新的修订取代',
          completedAt: new Date(),
        });
      }

      await em.update(TaskRun, latest.id, {
        status: RunStatus.RUNNING,
        startedAt: new Date(),
      });

      const revision = await em.findOneOrFail(TaskRevision, {
        where: { id: latest.revisionId },
      });

      await em.update(Task, taskId, {
        status: TaskStatus.RUNNING,
        currentRunId: latest.id,
      });

      return { runId: latest.id, revisionInput: revision.input };
    });

    // 事务提交后再启动执行，避免执行过程中读到未提交数据
    if (next) {
      void this.executeRun(next.runId, taskId, next.revisionInput);
    }
  }

  // ─── Cancel run ─────────────────────────────────────────────────────────
  async cancelRun(taskId: string): Promise<void> {
    const run = await this.runRepo.findOne({
      where: { taskId, status: RunStatus.RUNNING },
    });
    if (!run) return;
    await this.runRepo.update(run.id, { cancelRequested: true });
    // Also abort the AbortController if it exists
    this.abortControllers.get(run.id)?.abort();
  }

  // ─── Retry ──────────────────────────────────────────────────────────────
  async retryTask(taskId: string): Promise<void> {
    const task = await this.taskRepo.findOneOrFail({
      where: { id: taskId },
      relations: ['revisions'],
    });
    const revision = await this.revisionRepo.findOneOrFail({
      where: { id: task.currentRevisionId ?? '' },
    });
    await this.startRun(taskId, revision.id, revision.input);
  }

  // ─── Edit task (new revision) ─────────────────────────────────────────
  async editTask(taskId: string, newInput: string): Promise<TaskRevision> {
    const cleaned = sanitizeInput(newInput);
    if (detectInjection(cleaned)) {
      throw new BadRequestException('任务描述包含不允许的内容，请修改后重试');
    }

    // Cancel current running run
    await this.cancelRun(taskId);

    const count = await this.revisionRepo.count({ where: { taskId } });
    const revision = this.revisionRepo.create({
      taskId,
      version: count + 1,
      input: cleaned,
    });
    await this.revisionRepo.save(revision);
    await this.taskRepo.update(taskId, { currentRevisionId: revision.id });

    this.eventPublisher.emit(TASK_EVENTS.REVISION_CREATED, {
      taskId,
      revisionId: revision.id,
      version: revision.version,
      input: cleaned,
    });

    // Queue new run (will start after old run finishes or immediately if no running run)
    void this.startRun(taskId, revision.id, cleaned);
    return revision;
  }

  // ─── Delete task ──────────────────────────────────────────────────────────
  async deleteTask(taskId: string): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');

    // 先中止后台执行（设置 cancel_requested + 触发 AbortController）
    await this.cancelRun(taskId);

    // 用事务做级联删除，防止部分删除留下孤儿数据
    await this.dataSource.transaction(async (em) => {
      const runs = await em.find(TaskRun, {
        where: { taskId },
        select: ['id'],
      });
      const runIds = runs.map((r) => r.id);

      if (runIds.length > 0) {
        const plans = await em.find(TaskPlan, {
          where: { runId: In(runIds) },
          select: ['id'],
        });
        const planIds = plans.map((p) => p.id);

        if (planIds.length > 0) {
          await em.delete(PlanStep, { planId: In(planIds) });
        }
        await em.delete(Artifact, { runId: In(runIds) });
        await em.delete(StepRun, { runId: In(runIds) });
        await em.delete(TaskPlan, { runId: In(runIds) });
      }

      await em.delete(TaskRun, { taskId });
      await em.delete(TaskRevision, { taskId });
      await em.delete(Task, taskId);
    });

    this.logger.log(`Task ${taskId} deleted`);

    // 文件删除在事务提交后执行，文件系统操作不可回滚，不放进事务
    await this.workspace.cleanTaskDir(taskId);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────
  async listTasks(take = 50, skip = 0): Promise<Task[]> {
    return this.taskRepo.find({
      order: { createdAt: 'DESC' },
      take,
      skip,
      // 列表只需要摘要字段，不加载大字段
      select: [
        'id',
        'title',
        'status',
        'createdAt',
        'currentRunId',
        'currentRevisionId',
      ],
    });
  }

  async getTask(taskId: string): Promise<Task> {
    return this.taskRepo.findOneOrFail({ where: { id: taskId } });
  }

  async getTaskDetail(taskId: string) {
    const task = await this.taskRepo.findOneOrFail({
      where: { id: taskId },
    });

    const revisions = await this.revisionRepo.find({
      where: { taskId },
      order: { version: 'DESC' },
    });

    const runs = await this.runRepo.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
      take: 20, // 只取最近 20 条，避免长期任务历史过大
      select: [
        'id',
        'revisionId',
        'runNumber',
        'status',
        'createdAt',
        'startedAt',
        'completedAt',
        'errorMessage',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'estimatedCostUsd',
      ],
    });

    const currentRun = task.currentRunId
      ? await this.runRepo.findOne({
          where: { id: task.currentRunId },
          relations: ['plans', 'plans.steps', 'stepRuns', 'artifacts'],
        })
      : null;

    return {
      task,
      revisions,
      runs: runs.map((run) => ({
        id: run.id,
        revisionId: run.revisionId,
        runNumber: run.runNumber,
        status: run.status,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        totalTokens: run.totalTokens,
        estimatedCostUsd: run.estimatedCostUsd,
      })),
      currentRun,
    };
  }

  async getRunDetail(taskId: string, runId: string) {
    // taskId validation: ensures the run belongs to this task
    return this.runRepo.findOneOrFail({
      where: { id: runId, taskId },
      relations: ['plans', 'plans.steps', 'stepRuns', 'artifacts'],
    });
  }
}
