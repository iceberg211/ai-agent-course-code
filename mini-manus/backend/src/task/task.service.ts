import {
  Injectable,
  Logger,
  NotFoundException,
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

@Injectable()
export class TaskService implements OnModuleInit {
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

  // ─── Create task + revision + run ───────────────────────────────────────
  async createTask(input: string): Promise<Task> {
    const title = input.slice(0, 100) + (input.length > 100 ? '...' : '');

    return this.dataSource.transaction(async (em) => {
      const task = em.create(Task, { title, status: TaskStatus.PENDING });
      await em.save(task);

      const revision = em.create(TaskRevision, {
        taskId: task.id,
        version: 1,
        input,
      });
      await em.save(revision);

      task.currentRevisionId = revision.id;
      await em.save(task);

      this.eventPublisher.emit(TASK_EVENTS.TASK_CREATED, {
        taskId: task.id,
        title,
      });
      this.eventPublisher.emit(TASK_EVENTS.REVISION_CREATED, {
        taskId: task.id,
        revisionId: revision.id,
        version: 1,
        input,
      });

      // Start execution immediately
      setImmediate(() => void this.startRun(task.id, revision.id, input));

      return task;
    });
  }

  // ─── Start a new run ────────────────────────────────────────────────────
  async startRun(
    taskId: string,
    revisionId: string,
    revisionInput: string,
  ): Promise<void> {
    const run = await this.dataSource.transaction(async (em) => {
      const task = await em.findOneOrFail(Task, { where: { id: taskId } });

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
    const pendingRuns = await this.runRepo.find({
      where: { taskId, status: RunStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    if (pendingRuns.length === 0) return;

    const [latest, ...older] = pendingRuns;

    // Cancel stale pending runs
    for (const r of older) {
      await this.runRepo.update(r.id, {
        status: RunStatus.CANCELLED,
        errorMessage: '被更新的修订取代',
        completedAt: new Date(),
      });
    }

    // Activate the latest pending run
    await this.runRepo.update(latest.id, {
      status: RunStatus.RUNNING,
      startedAt: new Date(),
    });
    const revision = await this.revisionRepo.findOneOrFail({
      where: { id: latest.revisionId },
    });
    await this.taskRepo.update(taskId, {
      status: TaskStatus.RUNNING,
      currentRunId: latest.id,
    });

    void this.executeRun(latest.id, taskId, revision.input);
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
    // Cancel current running run
    await this.cancelRun(taskId);

    const count = await this.revisionRepo.count({ where: { taskId } });
    const revision = this.revisionRepo.create({
      taskId,
      version: count + 1,
      input: newInput,
    });
    await this.revisionRepo.save(revision);
    await this.taskRepo.update(taskId, { currentRevisionId: revision.id });

    this.eventPublisher.emit(TASK_EVENTS.REVISION_CREATED, {
      taskId,
      revisionId: revision.id,
      version: revision.version,
      input: newInput,
    });

    // Queue new run (will start after old run finishes or immediately if no running run)
    void this.startRun(taskId, revision.id, newInput);
    return revision;
  }

  // ─── Delete task ──────────────────────────────────────────────────────────
  async deleteTask(taskId: string): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');

    // Cancel any running execution first
    await this.cancelRun(taskId);

    // Delete in reverse dependency order (no ON DELETE CASCADE in schema)
    const runs = await this.runRepo.find({ where: { taskId }, select: ['id'] });
    const runIds = runs.map((r) => r.id);

    if (runIds.length > 0) {
      const plans = await this.planRepo.find({
        where: { runId: In(runIds) },
        select: ['id'],
      });
      const planIds = plans.map((p) => p.id);

      if (planIds.length > 0) {
        await this.planStepRepo.delete({ planId: In(planIds) });
      }
      await this.artifactRepo.delete({ runId: In(runIds) });
      await this.stepRunRepo.delete({ runId: In(runIds) });
      await this.planRepo.delete({ runId: In(runIds) });
    }

    await this.runRepo.delete({ taskId });
    await this.revisionRepo.delete({ taskId });
    await this.taskRepo.delete(taskId);

    this.logger.log(`Task ${taskId} deleted`);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────
  async listTasks(): Promise<Task[]> {
    return this.taskRepo.find({ order: { createdAt: 'DESC' } });
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
