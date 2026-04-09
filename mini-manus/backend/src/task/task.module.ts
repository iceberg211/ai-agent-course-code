import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskService } from '@/task/task.service';
import { TaskController } from '@/task/task.controller';
import { Task } from '@/task/entities/task.entity';
import { TaskRevision } from '@/task/entities/task-revision.entity';
import { TaskRun } from '@/task/entities/task-run.entity';
import { TaskPlan } from '@/task/entities/task-plan.entity';
import { PlanStep } from '@/task/entities/plan-step.entity';
import { StepRun } from '@/task/entities/step-run.entity';
import { Artifact } from '@/task/entities/artifact.entity';
import { AgentModule } from '@/agent/agent.module';
import { EventModule } from '@/event/event.module';
import { WorkspaceModule } from '@/workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskRevision,
      TaskRun,
      TaskPlan,
      PlanStep,
      StepRun,
      Artifact,
    ]),
    AgentModule,
    EventModule,
    WorkspaceModule,
  ],
  providers: [TaskService],
  controllers: [TaskController],
  exports: [TaskService],
})
export class TaskModule {}
