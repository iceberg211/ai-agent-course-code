import { Injectable } from '@nestjs/common';
import { QueueService } from '@/queue/queue.service';

export const ACL_INDEX_REFRESH_QUEUE = 'acl-index-refresh';
export const ACL_INDEX_REFRESH_JOB = 'refresh_acl_index';

export interface AclIndexRefreshJobData {
  documentId: string;
  reason?: string;
}

@Injectable()
export class AclIndexQueueService {
  constructor(private readonly queueService: QueueService) {}

  async enqueueDocumentRefresh(
    documentId: string,
    reason = 'manual',
  ): Promise<{ queued: true; documentId: string }> {
    const queue = this.queueService.getQueue(ACL_INDEX_REFRESH_QUEUE);
    await queue.add(
      ACL_INDEX_REFRESH_JOB,
      { documentId, reason } satisfies AclIndexRefreshJobData,
      {
        removeOnComplete: 1000,
        removeOnFail: 2000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
    return { queued: true, documentId };
  }
}
