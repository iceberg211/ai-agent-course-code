import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './entities/task.entity';
import { TaskPlan } from './entities/task-plan.entity';
import { TaskStepRun, StepStatus } from './entities/task-step-run.entity';
import { Artifact } from './entities/artifact.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskPlan)
    private readonly taskPlanRepo: Repository<TaskPlan>,
    @InjectRepository(TaskStepRun)
    private readonly taskStepRunRepo: Repository<TaskStepRun>,
    @InjectRepository(Artifact)
    private readonly artifactRepo: Repository<Artifact>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createTask(title: string, userInput: string): Promise<Task> {
    const task = this.taskRepo.create({
      title,
      userInput,
      status: TaskStatus.PENDING,
    });
    const savedTask = await this.taskRepo.save(task);

    // 发出事件给流式接口
    this.eventEmitter.emit('task.created', { taskId: savedTask.id, task: savedTask });

    // TODO: 生产中这里会异步触发 LangGraph 执行，这里为了演示，可以不做
    return savedTask;
  }

  async getTask(taskId: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['plans', 'stepRuns', 'artifacts'],
    });
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
    return task;
  }

  async getAllTasks(): Promise<Task[]> {
    return this.taskRepo.find({ order: { createdAt: 'DESC' } });
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, errorMessage?: string): Promise<Task> {
    const task = await this.getTask(taskId);
    
    // 简单的状态流转验证
    if (task.status === TaskStatus.SUCCEEDED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException(`Task ${taskId} is already finished (${task.status})`);
    }

    task.status = status;
    if (errorMessage) {
      task.errorMessage = errorMessage;
    }
    
    const updatedTask = await this.taskRepo.save(task);
    
    if (status === TaskStatus.SUCCEEDED) {
      this.eventEmitter.emit('task.completed', { taskId: updatedTask.id, task: updatedTask });
    } else if (status === TaskStatus.FAILED) {
      this.eventEmitter.emit('task.failed', { taskId: updatedTask.id, error: errorMessage });
    }

    return updatedTask;
  }

  // ============== 下面是模拟 LangGraph 运行中操作数据的接口 ==============

  async savePlan(taskId: string, goal: string, stepsJson: any[]): Promise<TaskPlan> {
    const task = await this.getTask(taskId);
    const existingPlans = await this.taskPlanRepo.count({ where: { taskId } });
    
    const plan = this.taskPlanRepo.create({
      taskId,
      version: existingPlans + 1,
      goal,
      stepsJson,
    });
    const savedPlan = await this.taskPlanRepo.save(plan);

    this.eventEmitter.emit('task.planned', { taskId, plan: savedPlan });
    
    return savedPlan;
  }

  async startStep(taskId: string, planVersion: number, stepIndex: number, stepTitle: string): Promise<TaskStepRun> {
    const stepRun = this.taskStepRunRepo.create({
      taskId,
      planVersion,
      stepIndex,
      stepTitle,
      status: StepStatus.RUNNING,
    });
    const savedStep = await this.taskStepRunRepo.save(stepRun);
    
    this.eventEmitter.emit('step.started', { taskId, step: savedStep });
    return savedStep;
  }

  async finishStep(stepId: string, resultSummary: string, status: StepStatus = StepStatus.SUCCEEDED): Promise<TaskStepRun> {
    const step = await this.taskStepRunRepo.findOne({ where: { id: stepId } });
    if (!step) throw new NotFoundException(`Step ${stepId} not found`);

    step.resultSummary = resultSummary;
    step.status = status;
    step.finishedAt = new Date();

    const savedStep = await this.taskStepRunRepo.save(step);
    this.eventEmitter.emit('step.completed', { taskId: step.taskId, step: savedStep });
    return savedStep;
  }
}
