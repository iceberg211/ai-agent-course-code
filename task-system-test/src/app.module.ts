import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaskModule } from './task/task.module';
import { EventModule } from './event/event.module';
import { Task } from './task/entities/task.entity';
import { TaskPlan } from './task/entities/task-plan.entity';
import { TaskStepRun } from './task/entities/task-step-run.entity';
import { Artifact } from './task/entities/artifact.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql', // 真实系统使用 MySQL
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: '', // 替换为真实密码
      database: 'manus_test',
      entities: [Task, TaskPlan, TaskStepRun, Artifact],
      synchronize: true, // 仅开发环境开启
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
    }),
    TaskModule,
    EventModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
