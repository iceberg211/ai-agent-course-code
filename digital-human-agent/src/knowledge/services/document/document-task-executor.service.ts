import { Injectable } from '@nestjs/common';
import { DocumentTaskRunnerService } from './document-task-runner.service';
import type { UploadTaskExecutionInput } from './document-task.types';

@Injectable()
export class InProcessDocumentTaskExecutor {
  constructor(private readonly runner: DocumentTaskRunnerService) {}

  enqueueUploadIngest(input: UploadTaskExecutionInput): void {
    setImmediate(() => {
      void this.runner.runUploadIngestTask(input);
    });
  }
}
