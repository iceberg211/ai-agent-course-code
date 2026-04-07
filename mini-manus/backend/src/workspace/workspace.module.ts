import { Module } from '@nestjs/common';
import { WorkspaceService } from '@/workspace/workspace.service';

@Module({
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
