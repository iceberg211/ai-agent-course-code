import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { Task } from './entities/task.entity';
import { TaskRevision } from './entities/task-revision.entity';
import { TaskRun } from './entities/task-run.entity';
import { TaskPlan } from './entities/task-plan.entity';
import { PlanStep } from './entities/plan-step.entity';
import { StepRun } from './entities/step-run.entity';
import { Artifact } from './entities/artifact.entity';
import { AgentModule } from '../agent/agent.module';
import { EventModule } from '../event/event.module';

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
  ],
  providers: [TaskService],
  controllers: [TaskController],
  exports: [TaskService],
})
export class TaskModule {}
