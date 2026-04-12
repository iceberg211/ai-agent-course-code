import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '@/task/entities/task.entity';
import { WorkspaceCleanupService } from '@/workspace/workspace-cleanup.service';
import { WorkspaceService } from '@/workspace/workspace.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task])],
  providers: [WorkspaceService, WorkspaceCleanupService],
  exports: [WorkspaceService, WorkspaceCleanupService],
})
export class WorkspaceModule { }
