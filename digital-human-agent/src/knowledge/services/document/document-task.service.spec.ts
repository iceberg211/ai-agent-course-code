import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentTaskService } from './document-task.service';

function createRepoMock() {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  };
}

function createQueryBuilderMock() {
  const qb = {
    leftJoinAndSelect: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    andWhere: jest.fn(),
    getManyAndCount: jest.fn(),
  };
  for (const method of [
    'leftJoinAndSelect',
    'orderBy',
    'skip',
    'take',
    'andWhere',
  ] as const) {
    qb[method].mockReturnValue(qb);
  }
  return qb;
}

describe('DocumentTaskService', () => {
  let taskRepo: ReturnType<typeof createRepoMock>;
  let stepRepo: ReturnType<typeof createRepoMock>;
  let documentRepo: ReturnType<typeof createRepoMock>;
  let configService: { get: jest.Mock };
  let queueMock: { add: jest.Mock };
  let queueService: { getQueue: jest.Mock };
  let storageProvider: {
    putObject: jest.Mock;
    getObject: jest.Mock;
    deleteObject: jest.Mock;
    createPresignedGetUrl: jest.Mock;
  };
  let service: DocumentTaskService;

  beforeEach(() => {
    taskRepo = createRepoMock();
    stepRepo = createRepoMock();
    documentRepo = createRepoMock();

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'S3_BUCKET') return 'test-bucket';
        return undefined;
      }),
    };

    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    queueService = {
      getQueue: jest.fn().mockReturnValue(queueMock),
    };

    storageProvider = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn(),
      deleteObject: jest.fn(),
      createPresignedGetUrl: jest.fn(),
    };

    service = new DocumentTaskService(
      taskRepo as never,
      stepRepo as never,
      documentRepo as never,
      configService as never,
      queueService as never,
      storageProvider as never,
    );
  });

  it('创建上传任务后会上传原始文件至对象存储并发布至异步任务队列', async () => {
    taskRepo.create.mockImplementation((value) => ({
      id: 'task-1',
      ...value,
    }));
    taskRepo.save.mockImplementation(async (value) => ({
      id: 'task-1',
      ...value,
    }));
    taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      documentId: null,
      metadata: { upload: { ownerId: 'user-1' } },
    });
    stepRepo.find.mockResolvedValue([]);

    const result = await service.createUploadIngestTask(
      'kb-1',
      {
        originalname: 'demo.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# demo'),
        size: 6,
      },
      { ownerId: 'user-1', visibility: 'private' },
    );

    expect(result.id).toBe('task-1');
    expect(storageProvider.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        key: expect.stringContaining('demo.md'),
        body: expect.any(Buffer),
        contentType: 'text/markdown',
      }),
    );
    expect(stepRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ taskId: 'task-1', step: 'parse' }),
      expect.objectContaining({ taskId: 'task-1', step: 'index' }),
      expect.objectContaining({ taskId: 'task-1', step: 'graph_sync' }),
    ]);
    expect(queueService.getQueue).toHaveBeenCalledWith('document-processing');
    expect(queueMock.add).toHaveBeenCalledWith(
      'parse_and_index',
      expect.objectContaining({
        taskId: 'task-1',
        knowledgeBaseId: 'kb-1',
        filename: 'demo.md',
        mimetype: 'text/markdown',
        size: 6,
      }),
    );
  });

  it('队列发布失败时会把任务标记为 failed', async () => {
    taskRepo.create.mockImplementation((value) => ({
      id: 'task-1',
      ...value,
    }));
    taskRepo.save.mockImplementation(async (value) => ({
      id: 'task-1',
      ...value,
    }));
    queueMock.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.createUploadIngestTask(
        'kb-1',
        {
          originalname: 'demo.md',
          mimetype: 'text/markdown',
          buffer: Buffer.from('# demo'),
          size: 6,
        },
        { ownerId: 'user-1', visibility: 'private' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(taskRepo.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'failed',
        stage: 'failed',
        error: expect.stringContaining('redis down'),
      }),
    );
  });

  it('创建文档新版本任务时会继承版本组并递增版本号', async () => {
    documentRepo.findOne
      .mockResolvedValueOnce({
        id: 'doc-1',
        knowledgeBaseId: 'kb-1',
        ownerId: 'user-1',
        visibility: 'private',
        department: null,
        tags: ['制度'],
        businessCategory: 'finance',
        expiresAt: null,
        versionGroupId: 'group-1',
        versionNo: 2,
      })
      .mockResolvedValueOnce({ versionNo: 2 });
    taskRepo.create.mockImplementation((value) => ({
      id: 'task-1',
      ...value,
    }));
    taskRepo.save.mockImplementation(async (value) => ({
      id: 'task-1',
      ...value,
    }));
    taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      documentId: null,
      metadata: { upload: { ownerId: 'user-1' } },
    });
    stepRepo.find.mockResolvedValue([]);

    await service.createUploadVersionTask(
      'kb-1',
      'doc-1',
      {
        originalname: 'demo.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('demo'),
        size: 4,
      },
      { ownerId: 'user-1' },
      { ownerId: 'user-1', department: null, role: 'user' },
    );

    expect(queueMock.add).toHaveBeenCalledWith(
      'parse_and_index',
      expect.objectContaining({
        input: expect.objectContaining({
          baseDocumentId: 'doc-1',
          versionGroupId: 'group-1',
          versionNo: 3,
          isCurrentVersion: true,
          visibility: 'private',
          tags: ['制度'],
          businessCategory: 'finance',
        }),
      }),
    );
  });

  it('markTaskFailed 会同步更新任务和运行中的步骤', async () => {
    await service.markTaskFailed('task-1', 'boom');

    expect(taskRepo.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'failed',
        stage: 'failed',
        error: 'boom',
      }),
    );
    expect(stepRepo.update).toHaveBeenCalledWith(
      { taskId: 'task-1', status: 'running' },
      expect.objectContaining({
        status: 'failed',
        error: 'boom',
      }),
    );
  });

  it('任务没有绑定文档时，仅上传者本人可查看', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      documentId: null,
      metadata: { upload: { ownerId: 'user-1' } },
    });
    stepRepo.find.mockResolvedValue([]);

    const result = await service.getTaskDetail('task-1', {
      ownerId: 'user-1',
      department: null,
      role: 'user',
    });

    expect(result.id).toBe('task-1');
    expect(stepRepo.find).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      order: { createdAt: 'ASC' },
    });
  });

  it('任务没有绑定文档时，非上传者不可查看', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      documentId: null,
      metadata: { upload: { ownerId: 'user-1' } },
    });

    await expect(
      service.getTaskDetail('task-1', {
        ownerId: 'user-2',
        department: null,
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('任务绑定文档后，按文档可见范围校验', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      documentId: 'doc-1',
      metadata: null,
    });
    documentRepo.findOne.mockResolvedValue({
      id: 'doc-1',
      visibility: 'department',
      department: '财务部',
      ownerId: 'owner-1',
    });
    stepRepo.find.mockResolvedValue([]);

    await service.getTaskDetail('task-1', {
      ownerId: 'user-1',
      department: '财务部',
      role: 'user',
    });

    expect(documentRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
    });
  });

  it('分页查询任务时会批量加载任务步骤', async () => {
    const qb = createQueryBuilderMock();
    taskRepo.createQueryBuilder.mockReturnValue(qb);
    qb.getManyAndCount.mockResolvedValue([
      [
        { id: 'task-1', documentId: null },
        { id: 'task-2', documentId: 'doc-2' },
      ],
      2,
    ]);
    stepRepo.find.mockResolvedValue([
      { id: 'step-1', taskId: 'task-1', step: 'parse' },
      { id: 'step-2', taskId: 'task-2', step: 'index' },
    ]);

    const result = await service.listTasks({
      knowledgeBaseId: 'kb-1',
      status: 'running',
      page: 1,
      pageSize: 10,
      accessScope: {
        ownerId: 'user-1',
        department: '财务部',
        role: 'user',
      },
    });

    expect(taskRepo.createQueryBuilder).toHaveBeenCalledWith('task');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'task.document',
      'document',
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'task.knowledge_base_id = :knowledgeBaseId',
      { knowledgeBaseId: 'kb-1' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('task.status = :status', {
      status: 'running',
    });
    expect(stepRepo.find).toHaveBeenCalledWith({
      where: { taskId: expect.any(Object) },
      order: { createdAt: 'ASC' },
    });
    expect(result.total).toBe(2);
    expect(result.items[0].steps).toHaveLength(1);
    expect(result.items[1].steps).toHaveLength(1);
  });

  it('查询不存在的任务时抛出 NotFoundException', async () => {
    taskRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getTaskDetail('missing', {
        ownerId: 'user-1',
        department: null,
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
